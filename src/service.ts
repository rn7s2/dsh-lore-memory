/**
 * Per-agent behaviour: which workspace a session belongs to, the memory
 * snapshot frozen into its system prompt, and the lore copy for each turn.
 */
import { StoreError } from './errors.js'
import { type AgentLike, type MessageLike, type SessionLike, messageText, userMessage } from './host.js'
import { extractMemory, renderLore, renderMemory } from './render.js'
import { canonicalWorkspace } from './scope.js'
import type { LoreMemoryStore } from './store.js'

/** `source.kind` of every message this plugin adds to a session. */
export const SOURCE_KIND = 'lore-memory'

export interface ServiceOptions {
  /** The store, once opened (it never rejects; failures are in its status). */
  readonly store: Promise<LoreMemoryStore>
  /** A live session by id, for following a subagent to its parent. */
  readonly sessionById: (id: string) => SessionLike | undefined
  /** Directory for sessions that recorded none. */
  readonly defaultDirectory: () => string | undefined
  readonly warn: (message: string, error?: unknown) => void
}

interface AgentState {
  workspace?: Promise<string>
  /** The memory block frozen at the first system-prompt build; `''` when there was none. */
  memory?: string
}

export class LoreMemoryService {
  private readonly agents = new Map<string, AgentState>()

  constructor(private readonly options: ServiceOptions) {}

  store(): Promise<LoreMemoryStore> {
    return this.options.store
  }

  private state(agent: AgentLike): AgentState {
    let state = this.agents.get(agent.id)
    if (state === undefined) {
      state = {}
      this.agents.set(agent.id, state)
    }
    return state
  }

  forget(agent: AgentLike): void {
    this.agents.delete(agent.id)
  }

  /**
   * The workspace an agent reads and writes: its root session's original
   * folder, so a subagent uses its parent's workspace wherever it runs.
   */
  workspaceOf(agent: AgentLike): Promise<string> {
    const state = this.state(agent)
    state.workspace ??= this.resolveWorkspace(agent.session).catch((error: unknown) => {
      state.workspace = undefined
      throw error
    })
    return state.workspace
  }

  private async resolveWorkspace(start: SessionLike): Promise<string> {
    let session = start
    const seen = new Set<string>([session.id])
    while (session.header.parentSession !== undefined && !seen.has(session.header.parentSession)) {
      const parent = this.options.sessionById(session.header.parentSession)
      if (parent === undefined) break
      seen.add(parent.id)
      session = parent
    }
    const cwd = session.header.cwd ?? start.header.cwd ?? this.options.defaultDirectory()
    if (cwd === undefined) throw new StoreError('UNAVAILABLE', 'this session has no workspace folder')
    return canonicalWorkspace(cwd)
  }

  /**
   * Freeze the agent's memory snapshot before its first model step. A session
   * whose system prompt was already built keeps the memory it was built with,
   * read back from its log, so resume and compaction never change it.
   */
  async prepare(agent: AgentLike): Promise<void> {
    const state = this.state(agent)
    if (state.memory !== undefined) return
    const logged = memoryFromLog(agent.session)
    if (logged !== undefined) {
      state.memory = logged
      return
    }
    try {
      const workspace = await this.workspaceOf(agent)
      const store = await this.options.store
      if (store.status().state === 'unavailable') {
        state.memory ??= ''
        return
      }
      const entries = await store.listAsync('memory', workspace)
      state.memory ??= renderMemory(entries, workspace)
    } catch (error) {
      this.options.warn(`memory snapshot for ${agent.id} failed; this agent starts without memory`, error)
      state.memory ??= ''
    }
  }

  /** The system-prompt memory block for an agent (synchronous; prepared in advance). */
  memorySection(agent: AgentLike | undefined): string {
    if (agent === undefined) return ''
    const state = this.state(agent)
    if (state.memory === undefined) {
      // Not prepared (the plugin loaded after this agent started): never invent
      // memory for a prompt that may already exist.
      state.memory = memoryFromLog(agent.session) ?? ''
    }
    return state.memory
  }

  /** The lore copy for the start of a turn, or `undefined` when there is nothing to say. */
  async loreMessage(agent: AgentLike): Promise<MessageLike | undefined> {
    const workspace = await this.workspaceOf(agent)
    const store = await this.options.store
    if (store.status().state === 'unavailable') return undefined
    const entries = await store.listAsync('lore', workspace)
    if (entries.length === 0 && !hasVisibleLore(agent.session)) return undefined
    return userMessage(renderLore(entries, workspace), { kind: SOURCE_KIND, form: 'lore', entries: entries.length })
  }
}

function eventMessageText(event: { type: string; data: unknown } | undefined): string | undefined {
  if (event?.type !== 'system/message') return undefined
  return messageText((event.data as { message?: unknown } | undefined)?.message)
}

/**
 * The memory block of the newest non-empty system prompt in the log:
 * `undefined` when no system prompt was built yet, `''` when it had no memory.
 */
export function memoryFromLog(session: SessionLike): string | undefined {
  let built = false
  const nodes = session.surface.nodes
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const text = eventMessageText(session.eventAt(nodes[index]!))
    if (text === undefined) continue
    built = true
    if (text !== '') return extractMemory(text) ?? ''
  }
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    const text = eventMessageText(session.eventAt(seq))
    if (text === undefined) continue
    built = true
    if (text !== '') return extractMemory(text) ?? ''
  }
  return built ? '' : undefined
}

/** Whether the model still sees a lore copy that listed rules (so their withdrawal must be announced). */
export function hasVisibleLore(session: SessionLike): boolean {
  const nodes = session.surface.nodes
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const event = session.eventAt(nodes[index]!)
    if (event?.type !== 'user/message') continue
    const source = (event.data as { source?: { kind?: unknown; entries?: unknown } } | undefined)?.source
    if (source?.kind === SOURCE_KIND) return typeof source.entries === 'number' && source.entries > 0
  }
  return false
}
