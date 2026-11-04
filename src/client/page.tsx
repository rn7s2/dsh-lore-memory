/**
 * The management page: a breadcrumb over path prefixes, then the Lore and
 * Memory tabs for everything at and below the selected prefix.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { MEMORY_KINDS, type Entry, type EntryType, type MemoryKind } from '../types.js'
import { ENTRY_PAGE_SIZE, type CreateRequest, type Overview, type ScopeSummary } from '../remote.js'
import { messageOf, type LoreMemoryApi } from './api.js'
import { PAGE_CSS } from './page.css.js'
import { childrenOf, crumbsOf, isScopePath, isUnder, lastSegment, normalizeScope, totalsOf } from './paths.js'

export type Translate = (key: string, params?: Record<string, string | number>) => string

export interface PageProps {
  readonly api: LoreMemoryApi
  readonly t?: Translate
}

const EMPTY_SCOPES: readonly ScopeSummary[] = []

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date)
}

interface KindFieldProps {
  readonly value: MemoryKind
  readonly disabled: boolean
  readonly t: Translate
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
  const t: Translate = props.t ?? ((key: string): string => key)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [prefix, setPrefix] = useState('/')
  const [tab, setTab] = useState<EntryType>('lore')
  const [entries, setEntries] = useState<readonly Entry[] | null>(null)
  const [entriesError, setEntriesError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
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
  const [searchDraft, setSearchDraft] = useState('')
  const [query, setQuery] = useState('')
  const scopeInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    setOverviewError(null)
    void api.overview().then(
      (next) => {
        if (live) setOverview(next)
      },
      (error: unknown) => {
        if (!live) return
        setOverviewError(messageOf(error))
        setOverview(null)
        setEntries(null)
        setTruncated(false)
      },
    )
    return () => {
      live = false
    }
  }, [api, reload])

  const overviewState = overview?.status.state
  useEffect(() => {
    if (overviewState === undefined) return
    if (overviewState === 'unavailable') {
      setEntries(null)
      setEntriesError(null)
      setTruncated(false)
      return
    }
    let live = true
    setEntries(null)
    setEntriesError(null)
    setTruncated(false)
    void api.entries({ type: tab, prefix, ...(query === '' ? {} : { query }) }).then(
      (result) => {
        if (!live) return
        setEntries(result.entries)
        setTruncated(result.truncated)
      },
      (error: unknown) => {
        if (live) setEntriesError(messageOf(error))
      },
    )
    return () => {
      live = false
    }
  }, [api, tab, prefix, query, overviewState, reload])

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchDraft.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [searchDraft])

  const clearSearch = (): void => {
    setSearchDraft('')
    setQuery('')
  }

  useEffect(() => {
    if (!composing) return
    const input = scopeInputRef.current
    if (input === null) return
    input.focus()
    input.select()
  }, [composing])

  useEffect(() => {
    if (entries === null) return
    if (editingId !== null && !entries.some((entry) => entry.id === editingId)) {
      setEditingId(null)
      setActionError(null)
    }
    if (confirmId !== null && !entries.some((entry) => entry.id === confirmId)) setConfirmId(null)
  }, [entries, editingId, confirmId])

  const scopes = overview?.scopes ?? EMPTY_SCOPES
  const known = useMemo(() => scopes.map((scope) => scope.path), [scopes])
  const totals = useMemo(() => totalsOf(scopes, prefix), [scopes, prefix])
  const folders = useMemo(() => childrenOf(scopes, prefix), [scopes, prefix])
  const crumbs = useMemo(() => crumbsOf(prefix), [prefix])
  // Suggestions for the scope field: every known folder at the root, and the
  // current prefix plus its descendants elsewhere. The field also accepts a
  // typed absolute path, so a fresh profile can add its first entry.
  const scopeOptions = useMemo(
    () => (prefix === '/' ? known : [prefix, ...known.filter((path) => path !== prefix && isUnder(path, prefix))]),
    [known, prefix],
  )
  const readOnly = overview === null || overview.status.state !== 'ready'
  const canAdd = overview !== null && overview.status.state === 'ready'

  const resetList = (): void => {
    setEntries(null)
    setEntriesError(null)
    setTruncated(false)
  }

  const go = (next: string): void => {
    setPrefix(next)
    setComposing(false)
    setEditingId(null)
    setConfirmId(null)
    setActionError(null)
    resetList()
  }

  const switchTab = (next: EntryType): void => {
    setTab(next)
    setComposing(false)
    setEditingId(null)
    setConfirmId(null)
    setActionError(null)
    resetList()
  }

  const startCompose = (): void => {
    setComposing(true)
    setEditingId(null)
    setConfirmId(null)
    setActionError(null)
    setDraftText('')
    setDraftKind('fact')
    setDraftScope(prefix === '/' ? '' : prefix)
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
    if (busy || !isScopePath(draftScope) || draftText.trim() === '') return
    setBusy(true)
    setActionError(null)
    const request: CreateRequest = {
      type: tab,
      scope: normalizeScope(draftScope),
      text: draftText,
      ...(tab === 'memory' ? { kind: draftKind } : {}),
    }
    void api.create(request).then(
      (result) => {
        setComposing(false)
        setDraftText('')
        // Show the folder the entry landed in, which may differ from the
        // prefix the form opened on.
        setPrefix(result.entry.scope)
        clearSearch()
        resetList()
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
    const nextText = editText.trim()
    if (nextText !== entry.text) change.text = nextText
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

  const deleteEntry = (entry: Entry): void => {
    if (busy) return
    setBusy(true)
    setActionError(null)
    void api.delete({ type: entry.type, scope: entry.scope, id: entry.id }).then(
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
          <div className="lm-heading">
            <h1>{t('title')}</h1>
            <p className="lm-sub">{t('subtitle')}</p>
          </div>
          <div className="lm-headActions">
            <button type="button" className="lm-button" disabled={busy} onClick={() => setReload((value) => value + 1)}>
              {t('refresh')}
            </button>
            {canAdd && !composing ? (
              <button type="button" className="lm-button lm-primary" onClick={startCompose} disabled={busy}>
                {t(tab === 'lore' ? 'new.lore' : 'new.memory')}
              </button>
            ) : null}
          </div>
        </header>

        {overviewError !== null ? (
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

        <div className="lm-toolbar">
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
        </div>
        <div className="lm-search">
          <SearchGlyph />
          <input
            className="lm-searchInput"
            type="search"
            value={searchDraft}
            placeholder={t(tab === 'lore' ? 'search.lore' : 'search.memory')}
            aria-label={t(tab === 'lore' ? 'search.lore' : 'search.memory')}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || searchDraft === '') return
              event.preventDefault()
              event.stopPropagation()
              clearSearch()
            }}
          />
          {searchDraft === '' ? null : (
            <button type="button" className="lm-searchClear" aria-label={t('search.clear')} onClick={clearSearch}>
              <CloseGlyph />
            </button>
          )}
        </div>
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
              <div className="lm-formRow">
                <label className="lm-field">
                  <span className="lm-fieldLabel">{t('scope.pick')}</span>
                  <input
                    ref={scopeInputRef}
                    className="lm-input"
                    list="lm-scope-options"
                    value={draftScope}
                    disabled={busy}
                    placeholder={t('scope.placeholder')}
                    onChange={(event) => setDraftScope(event.target.value)}
                  />
                  <datalist id="lm-scope-options">
                    {scopeOptions.map((path) => (
                      <option key={path} value={path} />
                    ))}
                  </datalist>
                </label>
                {tab === 'memory' ? <KindField value={draftKind} disabled={busy} t={t} onChange={setDraftKind} /> : null}
              </div>
              {draftScope !== '' && !isScopePath(draftScope) ? <p className="lm-error">{t('scope.invalid')}</p> : null}
              <label className="lm-field">
                <span className="lm-fieldLabel">{t(tab === 'lore' ? 'tabs.lore' : 'tabs.memory')}</span>
                <textarea
                  className="lm-textarea"
                  rows={3}
                  value={draftText}
                  disabled={busy}
                  placeholder={t(tab === 'lore' ? 'add.placeholder.lore' : 'add.placeholder.memory')}
                  onChange={(event) => setDraftText(event.target.value)}
                />
              </label>
              <p className="lm-hint">{t('scope.hint')}</p>
              {actionError !== null ? <p className="lm-error">{actionError}</p> : null}
              <div className="lm-formActions">
                <button type="submit" className="lm-button lm-primary" disabled={busy || draftText.trim() === '' || !isScopePath(draftScope)}>
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
          {truncated ? (
            <p className="lm-note">
              {ENTRY_PAGE_SIZE} {t('list.truncated')}
            </p>
          ) : null}
          {query !== '' && entries !== null && entries.length > 0 ? (
            <p className="lm-searchMeta" role="status">
              {t('search.results', { count: entries.length })}
            </p>
          ) : null}

          {overview !== null && overview.status.state === 'unavailable' ? (
            <p className="lm-note">{t('status.hint')}</p>
          ) : entriesError !== null ? (
            <div className="lm-empty" role="alert">
              <p className="lm-emptyTitle">{t('list.error')}</p>
              <p>{entriesError}</p>
              <div className="lm-emptyActions">
                <button type="button" className="lm-button" onClick={() => setReload((value) => value + 1)}>
                  {t('retry')}
                </button>
              </div>
            </div>
          ) : entries === null ? (
            <p className="lm-note">{query !== '' ? t('search.searching') : t('list.loading')}</p>
          ) : entries.length === 0 ? (
            query !== '' ? (
              <div className="lm-empty">
                <p className="lm-emptyTitle">{t('search.empty', { query })}</p>
              </div>
            ) : (
              <div className="lm-empty">
                <p className="lm-emptyTitle">{t(tab === 'lore' ? 'list.empty.lore' : 'list.empty.memory')}</p>
                {overview !== null && overview.total.lore + overview.total.memory === 0 ? (
                  <p>{t('empty.body')}</p>
                ) : (
                  <p>{t(tab === 'lore' ? 'empty.loreHint' : 'empty.memoryHint')}</p>
                )}
              </div>
            )
          ) : (
            <ul className="lm-list">
              {entries.map((entry) => (
                <li key={entry.id} className="lm-entry">
                  <div className="lm-entryHead">
                    <button type="button" className="lm-scope" title={entry.scope} onClick={() => go(entry.scope)}>
                      <FolderGlyph />
                      <span className="lm-scopePath">{entry.scope}</span>
                    </button>
                    {entry.kind === null ? null : <span className="lm-badge">{t(`kind.${entry.kind}`)}</span>}
                    <div className="lm-entryMeta">
                      {confirmId === entry.id ? (
                        <div className="lm-inlineConfirm" role="alert">
                          <span title={t('confirm.hint')}>{t('confirm.delete')}</span>
                          <button
                            type="button"
                            className="lm-button lm-danger lm-buttonSm"
                            disabled={busy}
                            onClick={() => deleteEntry(entry)}
                          >
                            {t('confirm.yes')}
                          </button>
                          <button type="button" className="lm-button lm-buttonSm" disabled={busy} onClick={() => setConfirmId(null)}>
                            {t('cancel')}
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="lm-updated">
                            {t('updated')} {formatTime(entry.updatedAt)}
                          </span>
                          {editingId === entry.id ? null : (
                            <div className="lm-entryActions">
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
                    </div>
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
                      <div className="lm-formActions">
                        <button
                          type="button"
                          className="lm-button lm-primary"
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
                    <EntryText text={entry.text} t={t} />
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

/** Clamp a long entry to three lines, with a toggle only when it overflows. */
function EntryText({ text, t }: { text: string; t: Translate }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const measure = (): void => setOverflowing(element.scrollHeight > element.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text, expanded])

  return (
    <>
      <p ref={ref} className={expanded ? 'lm-text' : 'lm-text lm-textClamped'}>
        {text}
      </p>
      {overflowing || expanded ? (
        <button
          type="button"
          className="lm-textToggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {t(expanded ? 'entry.collapse' : 'entry.expand')}
        </button>
      ) : null}
    </>
  )
}

/** Decorative search glyph for the list filter. */
function SearchGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="6.75" cy="6.75" r="4.25" />
      <path d="m10.2 10.2 3.3 3.3" />
    </svg>
  )
}

/** Decorative close glyph for clearing the search. */
function CloseGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
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
