/**
 * The management page: a breadcrumb over path prefixes, then the Lore and
 * Memory tabs for everything at and below the selected prefix.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'

import { MEMORY_KINDS, type Entry, type EntryType, type MemoryKind } from '../types.js'
import type { CreateRequest, Overview, ScopeSummary } from '../remote.js'
import { messageOf, type LoreMemoryApi } from './api.js'
import { PAGE_CSS } from './page.css.js'
import { childrenOf, crumbsOf, isUnder, lastSegment, totalsOf } from './paths.js'

export interface PageProps {
  readonly api: LoreMemoryApi
  readonly t?: (key: string) => string
}

const EMPTY_SCOPES: readonly ScopeSummary[] = []

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date)
}

function metaOf(entry: Entry, t: (key: string) => string): string {
  const parts: string[] = []
  if (entry.kind !== null) parts.push(t(`kind.${entry.kind}`))
  const time = formatTime(entry.updatedAt)
  if (time !== '') parts.push(`${t('updated')} ${time}`)
  return parts.join(' · ')
}

interface KindFieldProps {
  readonly value: MemoryKind
  readonly disabled: boolean
  readonly t: (key: string) => string
  readonly onChange: (kind: MemoryKind) => void
}

function KindField({ value, disabled, t, onChange }: KindFieldProps) {
  return (
    <label className="lm-field">
      <span className="lm-fieldLabel">{t('kind.label')}</span>
      <select
        className="lm-select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as MemoryKind)}
      >
        {MEMORY_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {t(`kind.${kind}`)}
          </option>
        ))}
      </select>
    </label>
  )
}

export function LoreMemoryPage(props: PageProps) {
  const api = props.api
  const t = props.t ?? ((key: string): string => key)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [prefix, setPrefix] = useState('/')
  const [tab, setTab] = useState<EntryType>('lore')
  const [entries, setEntries] = useState<readonly Entry[] | null>(null)
  const [entriesError, setEntriesError] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [draftKind, setDraftKind] = useState<MemoryKind>('fact')
  const [draftScope, setDraftScope] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [editKind, setEditKind] = useState<MemoryKind>('fact')
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setOverviewError(null)
    void api.overview().then(
      (next) => {
        if (live) setOverview(next)
      },
      (error: unknown) => {
        if (live) setOverviewError(messageOf(error))
      },
    )
    return () => {
      live = false
    }
  }, [api, reload])

  useEffect(() => {
    if (overview === null || overview.status.state === 'unavailable') return
    let live = true
    setEntries(null)
    setEntriesError(null)
    void api.entries({ type: tab, prefix }).then(
      (result) => {
        if (live) setEntries(result.entries)
      },
      (error: unknown) => {
        if (live) setEntriesError(messageOf(error))
      },
    )
    return () => {
      live = false
    }
  }, [api, tab, prefix, overview, reload])

  const scopes = overview?.scopes ?? EMPTY_SCOPES
  const known = useMemo(() => scopes.map((scope) => scope.path), [scopes])
  const totals = useMemo(() => totalsOf(scopes, prefix), [scopes, prefix])
  const folders = useMemo(() => childrenOf(scopes, prefix), [scopes, prefix])
  const crumbs = useMemo(() => crumbsOf(prefix), [prefix])
  // A write always lands in exactly one folder; the current prefix is the
  // default, and scopes below it stay reachable without leaving the view.
  const scopeOptions = useMemo(
    () => (prefix === '/' ? [] : [prefix, ...known.filter((path) => path !== prefix && isUnder(path, prefix))]),
    [known, prefix],
  )
  const readOnly = overview === null || overview.status.state !== 'ready'
  const canAdd = overview !== null && overview.status.state === 'ready' && scopeOptions.length > 0

  const go = (next: string): void => {
    setPrefix(next)
    setComposing(false)
    setEditingId(null)
    setConfirmId(null)
    setActionError(null)
  }

  const switchTab = (next: EntryType): void => {
    setTab(next)
    setComposing(false)
    setEditingId(null)
    setConfirmId(null)
    setActionError(null)
  }

  const startCompose = (): void => {
    setComposing(true)
    setEditingId(null)
    setConfirmId(null)
    setActionError(null)
    setDraftText('')
    setDraftKind('fact')
    setDraftScope(scopeOptions[0] ?? '')
  }

  const startEdit = (entry: Entry): void => {
    setEditingId(entry.id)
    setComposing(false)
    setConfirmId(null)
    setActionError(null)
    setEditText(entry.text)
    setEditKind(entry.kind ?? 'fact')
  }

  const closeEditors = (): void => {
    setComposing(false)
    setEditingId(null)
    setConfirmId(null)
    setActionError(null)
  }

  const saveNew = (): void => {
    if (busy || draftScope === '' || draftText.trim() === '') return
    setBusy(true)
    setActionError(null)
    const request: CreateRequest = {
      type: tab,
      scope: draftScope,
      text: draftText,
      ...(tab === 'memory' ? { kind: draftKind } : {}),
    }
    void api.create(request).then(
      () => {
        setComposing(false)
        setDraftText('')
        setReload((value) => value + 1)
      },
      (error: unknown) => setActionError(messageOf(error)),
    ).finally(() => setBusy(false))
  }

  const saveEdit = (entry: Entry): void => {
    if (busy) return
    const change: { type: EntryType; scope: string; id: number; text?: string; kind?: MemoryKind } = {
      type: entry.type,
      scope: entry.scope,
      id: entry.id,
    }
    if (editText.trim() !== entry.text) change.text = editText
    if (entry.type === 'memory' && editKind !== entry.kind) change.kind = editKind
    if (change.text === undefined && change.kind === undefined) {
      setEditingId(null)
      return
    }
    setBusy(true)
    setActionError(null)
    void api.update(change).then(
      () => {
        setEditingId(null)
        setReload((value) => value + 1)
      },
      (error: unknown) => setActionError(messageOf(error)),
    ).finally(() => setBusy(false))
  }

  const removeEntry = (entry: Entry): void => {
    if (busy) return
    setBusy(true)
    setActionError(null)
    void api.remove({ type: entry.type, scope: entry.scope, id: entry.id }).then(
      () => {
        setConfirmId(null)
        setReload((value) => value + 1)
      },
      (error: unknown) => setActionError(messageOf(error)),
    ).finally(() => setBusy(false))
  }

  const pageError = actionError !== null && !composing && editingId === null

  return (
    <div
      className="lm-page"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !(composing || editingId !== null || confirmId !== null)) return
        event.preventDefault()
        closeEditors()
      }}
    >
      <style>{PAGE_CSS}</style>
      <div className="lm-content">
        <header className="lm-head">
          <div>
            <h1>{t('title')}</h1>
            <p className="lm-sub">{t('subtitle')}</p>
          </div>
          <div className="lm-actions">
            <button type="button" className="lm-button" disabled={busy} onClick={() => setReload((value) => value + 1)}>
              {t('refresh')}
            </button>
          </div>
        </header>

        {overviewError !== null && overview === null ? (
          <div className="lm-banner" role="status">
            <span className="lm-bannerTitle">{t('overview.error')}</span>
            <span>{overviewError}</span>
            <button type="button" className="lm-link" onClick={() => setReload((value) => value + 1)}>
              {t('retry')}
            </button>
          </div>
        ) : null}

        {overview !== null && overview.status.state !== 'ready' ? (
          <div className="lm-banner" role="status">
            <span className="lm-bannerTitle">
              {t(overview.status.state === 'read-only' ? 'status.readOnly' : 'status.unavailable')}
            </span>
            <span>{overview.status.reason ?? t('status.hint')}</span>
          </div>
        ) : null}

        <nav className="lm-crumbs" aria-label={t('nav.label')}>
          <button
            type="button"
            className="lm-crumb"
            aria-current={prefix === '/' ? 'page' : undefined}
            onClick={() => go('/')}
          >
            {t('nav.all')}
          </button>
          {crumbs.map((crumb) => (
            <Fragment key={crumb.path}>
              <span className="lm-sep" aria-hidden="true">
                /
              </span>
              <button
                type="button"
                className="lm-crumb"
                aria-current={crumb.path === prefix ? 'page' : undefined}
                onClick={() => go(crumb.path)}
              >
                {crumb.label}
              </button>
            </Fragment>
          ))}
        </nav>

        <p className="lm-summary">
          {totals.lore} {t('unit.lore')} · {totals.memory} {t('unit.memory')}
        </p>

        {folders.length > 0 ? (
          <div className="lm-folders">
            {folders.map((folder) => (
              <button key={folder.path} type="button" className="lm-folder" title={folder.path} onClick={() => go(folder.path)}>
                <FolderGlyph />
                <span className="lm-folderName">{lastSegment(folder.path)}</span>
                <span className="lm-folderCount">
                  {folder.lore} {t('unit.lore')} · {folder.memory} {t('unit.memory')}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div
          className="lm-tabs"
          role="tablist"
          aria-label={t('tabs.label')}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
            event.preventDefault()
            const next: EntryType = tab === 'lore' ? 'memory' : 'lore'
            switchTab(next)
            const target = event.currentTarget.ownerDocument.getElementById(`lm-tab-${next}`)
            target?.focus()
          }}
        >
          <button
            type="button"
            id="lm-tab-lore"
            role="tab"
            className="lm-tab"
            aria-selected={tab === 'lore'}
            aria-controls="lm-panel"
            tabIndex={tab === 'lore' ? 0 : -1}
            onClick={() => switchTab('lore')}
          >
            {t('tabs.lore')}
            <span className="lm-count">{totals.lore}</span>
          </button>
          <button
            type="button"
            id="lm-tab-memory"
            role="tab"
            className="lm-tab"
            aria-selected={tab === 'memory'}
            aria-controls="lm-panel"
            tabIndex={tab === 'memory' ? 0 : -1}
            onClick={() => switchTab('memory')}
          >
            {t('tabs.memory')}
            <span className="lm-count">{totals.memory}</span>
          </button>
          <span className="lm-tabSpacer" />
          {canAdd ? (
            <button type="button" className="lm-button lm-accent" onClick={startCompose} disabled={busy || composing}>
              {t(tab === 'lore' ? 'new.lore' : 'new.memory')}
            </button>
          ) : null}
        </div>

        <div className="lm-panel" id="lm-panel" role="tabpanel" aria-labelledby={tab === 'lore' ? 'lm-tab-lore' : 'lm-tab-memory'}>
          {composing ? (
            <form
              className="lm-compose"
              aria-label={t(tab === 'lore' ? 'new.lore' : 'new.memory')}
              onSubmit={(event) => {
                event.preventDefault()
                saveNew()
              }}
            >
              <label className="lm-field">
                <span className="lm-fieldLabel">{t('scope.pick')}</span>
                <select className="lm-select" value={draftScope} disabled={busy} onChange={(event) => setDraftScope(event.target.value)}>
                  {scopeOptions.map((path) => (
                    <option key={path} value={path}>
                      {path}
                    </option>
                  ))}
                </select>
              </label>
              {tab === 'memory' ? (
                <KindField value={draftKind} disabled={busy} t={t} onChange={setDraftKind} />
              ) : null}
              <label className="lm-field">
                <span className="lm-fieldLabel">{t(tab === 'lore' ? 'new.lore' : 'new.memory')}</span>
                <textarea
                  className="lm-textarea"
                  autoFocus
                  rows={3}
                  value={draftText}
                  disabled={busy}
                  placeholder={t(tab === 'lore' ? 'add.placeholder.lore' : 'add.placeholder.memory')}
                  onChange={(event) => setDraftText(event.target.value)}
                />
              </label>
              <p className="lm-hint">{t('scope.hint')}</p>
              {actionError !== null ? <p className="lm-error">{actionError}</p> : null}
              <div className="lm-actions">
                <button type="submit" className="lm-button lm-accent" disabled={busy || draftText.trim() === '' || draftScope === ''}>
                  {busy ? t('saving') : t('save')}
                </button>
                <button type="button" className="lm-button" disabled={busy} onClick={closeEditors}>
                  {t('cancel')}
                </button>
              </div>
            </form>
          ) : null}

          {pageError ? <p className="lm-error lm-pageError">{actionError}</p> : null}

          {tab === 'memory' ? <p className="lm-hint lm-tabHint">{t('memory.note')}</p> : null}

          {overviewError !== null && overview === null ? null : overview !== null && overview.status.state === 'unavailable' ? (
            <p className="lm-note">{t('status.hint')}</p>
          ) : entriesError !== null ? (
            <div className="lm-empty" role="alert">
              <p className="lm-emptyTitle">{t('list.error')}</p>
              <p>{entriesError}</p>
              <div className="lm-actions" style={{ justifyContent: 'center', marginTop: '12px' }}>
                <button type="button" className="lm-button" onClick={() => setReload((value) => value + 1)}>
                  {t('retry')}
                </button>
              </div>
            </div>
          ) : entries === null ? (
            <p className="lm-note">{t('list.loading')}</p>
          ) : entries.length === 0 ? (
            <div className="lm-empty">
              <p className="lm-emptyTitle">{t(tab === 'lore' ? 'list.empty.lore' : 'list.empty.memory')}</p>
              {overview !== null && overview.total.lore + overview.total.memory === 0 ? <p>{t('empty.body')}</p> : null}
              {canAdd ? (
                <div className="lm-actions" style={{ justifyContent: 'center', marginTop: '16px' }}>
                  <button type="button" className="lm-button lm-accent" onClick={startCompose}>
                    {t(tab === 'lore' ? 'new.lore' : 'new.memory')}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <ul className="lm-list">
              {entries.map((entry) => (
                <li key={entry.id} className="lm-entry">
                  <div className="lm-entryTop">
                    <button type="button" className="lm-scope" title={entry.scope} onClick={() => go(entry.scope)}>
                      {entry.scope}
                    </button>
                    <span className="lm-meta">{metaOf(entry, t)}</span>
                  </div>
                  {editingId === entry.id ? (
                    <div className="lm-editor">
                      <textarea
                        className="lm-textarea"
                        autoFocus
                        rows={3}
                        value={editText}
                        disabled={busy}
                        aria-label={t('edit')}
                        onChange={(event) => setEditText(event.target.value)}
                      />
                      {entry.type === 'memory' ? <KindField value={editKind} disabled={busy} t={t} onChange={setEditKind} /> : null}
                      {actionError !== null ? <p className="lm-error">{actionError}</p> : null}
                      <div className="lm-actions">
                        <button
                          type="button"
                          className="lm-button lm-accent"
                          disabled={busy || editText.trim() === ''}
                          onClick={() => saveEdit(entry)}
                        >
                          {busy ? t('saving') : t('save')}
                        </button>
                        <button type="button" className="lm-button" disabled={busy} onClick={closeEditors}>
                          {t('cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="lm-text">{entry.text}</p>
                      {confirmId === entry.id ? (
                        <div className="lm-confirm" role="alert">
                          <p>
                            {t('confirm.delete')} <span>{t('confirm.hint')}</span>
                          </p>
                          <div className="lm-actions">
                            <button type="button" className="lm-button lm-danger" disabled={busy} onClick={() => removeEntry(entry)}>
                              {t('confirm.yes')}
                            </button>
                            <button type="button" className="lm-button" disabled={busy} onClick={() => setConfirmId(null)}>
                              {t('cancel')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="lm-actions">
                          <button type="button" className="lm-link" disabled={busy || readOnly} onClick={() => startEdit(entry)}>
                            {t('edit')}
                          </button>
                          <button
                            type="button"
                            className="lm-link lm-linkDanger"
                            disabled={busy || readOnly}
                            onClick={() => {
                              setConfirmId(entry.id)
                              setEditingId(null)
                              setActionError(null)
                            }}
                          >
                            {t('delete')}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/** Decorative folder glyph for a child-scope chip. */
function FolderGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.75 4.25A1.5 1.5 0 0 1 3.25 2.75h2.6l1.5 1.5h5.4a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 12.75 13.25h-9.5a1.5 1.5 0 0 1-1.5-1.5z" />
    </svg>
  )
}
