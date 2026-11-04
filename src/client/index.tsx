/**
 * Browser half: mounts the page's Remote contribution, then adds the sidebar
 * entry under Automation tasks and its page to the main panel.
 */
import { NAMESPACE, PANEL_ID, buildContribution } from '../remote.js'
import { createApi } from './api.js'
import { NS, en, zh } from './locale.js'
import { LoreMemoryPage } from './page.js'

interface SlotRegistration {
  readonly name: string
  readonly id?: string
  readonly key?: string
  readonly order?: number
  readonly locale?: string
  readonly label?: () => string
  readonly inject?: () => Record<string, unknown>
}

interface ClientContext {
  readonly remote: { $mount(contribution: unknown): Promise<() => Promise<void>> }
  readonly locale: {
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
    bind(namespace: string): (key: string) => string
  }
  readonly slots: {
    inject(name: string, callback: () => unknown): () => void
    register(options: SlotRegistration, component: unknown): unknown
  }
  effect(execute: () => () => void, label?: string): () => void
  get(name: string): unknown
}

export const inject = ['slots', 'locale', 'remote']

/** The book glyph the sidebar shows; the row owns the accessible label. */
export function LoreMemoryIcon({ size }: { size?: number }) {
  const edge = size ?? 16
  return (
    <svg
      width={edge}
      height={edge}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3.25A1.5 1.5 0 0 1 4.5 1.75H11a1.5 1.5 0 0 1 1.5 1.5v10.25H4.5A1.5 1.5 0 0 1 3 12z" />
      <path d="M3 12a1.5 1.5 0 0 1 1.5-1.5H12.5" />
      <path d="M5.75 4.75h3.5M5.75 7h2.25" />
    </svg>
  )
}

export async function apply(context: unknown): Promise<() => Promise<void>> {
  const ctx = context as ClientContext
  const disposeRemote = await ctx.remote.$mount(buildContribution())
  const disposeLocale = ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'lore-memory: page dictionary')
  const t = ctx.locale.bind(NS)
  const api = createApi(() => ctx.get(`remote.${NAMESPACE}`))
  const injectProps = (): Record<string, unknown> => ({ api, t })
  const disposePage = ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: injectProps }, LoreMemoryPage),
  )
  const disposeIcon = ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: () => t('panel') },
      LoreMemoryIcon,
    ),
  )
  return async () => {
    disposePage()
    disposeIcon()
    disposeLocale()
    await disposeRemote()
  }
}
