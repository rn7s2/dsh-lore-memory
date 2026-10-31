import { mkdtempSync, realpathSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentLike, MessageLike, SessionEventLike, SessionLike } from '../src/host.js'

export const FAST_RETRY = { budgetMs: 300, initialDelayMs: 5, maxDelayMs: 40 }

/** A fresh real (symlink-free) temporary directory. */
export function tempDir(prefix = 'lore-memory-'): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)))
}

/** `/root/work`, `/root/work/acme`, `/root/work/acme-other`, all real folders. */
export function workspaces(root: string): { work: string; acme: string; other: string } {
  const work = join(root, 'work')
  const acme = join(work, 'acme')
  const other = join(work, 'acme-other')
  for (const dir of [work, acme, other]) mkdirSync(dir, { recursive: true })
  return { work, acme, other }
}

let nextId = 0

/** An in-memory session log with the surface semantics the plugin reads. */
export class FakeSession implements SessionLike {
  readonly id: string
  readonly events: SessionEventLike[] = []
  readonly surface: { nodes: number[] } = { nodes: [] }
  constructor(readonly header: { cwd?: string; parentSession?: string }) {
    this.id = `session-${++nextId}`
  }
  get seq(): number {
    return this.events.length
  }
  eventAt(seq: number): SessionEventLike | undefined {
    return this.events[seq]
  }
  append(type: string, data: unknown, surface = false): number {
    this.events.push({ type, data })
    const seq = this.events.length - 1
    if (surface) this.surface.nodes.push(seq)
    return seq
  }
  /** Compaction: drop every surface node except the system prompt. */
  compact(): void {
    this.surface.nodes = this.surface.nodes.filter((seq) => this.events[seq]?.type === 'system/message')
  }
}

export class FakeAgent implements AgentLike {
  readonly id: string
  readonly followups: MessageLike[] = []
  constructor(readonly session: FakeSession) {
    this.id = session.id
  }
  followup(message: MessageLike): void {
    this.followups.push(message)
  }
}

type Listener = (...args: any[]) => any

/** The slice of a Cordis Host context the plugin uses, with a driver for the agent loop. */
export class FakeHost {
  readonly listeners = new Map<string, Listener[]>()
  readonly tools = new Map<string, any>()
  readonly commands = new Map<string, any>()
  readonly sections: { name: string; order: number; interpolate?: boolean; text: (c: { agent?: AgentLike }) => string }[] = []
  readonly services = new Map<string, unknown>()
  readonly disposers: (() => void)[] = []
  readonly warnings: string[] = []
  readonly approvals: { reason?: string; displayReason?: unknown }[] = []
  /** What the user answers in the approval prompt. */
  approvalAnswer: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable' = 'rejected'
  /** The session's approval policy and sandbox mode (Full Access is `never` + `danger-full-access`). */
  approvalPolicy: 'ask' | 'never' = 'ask'
  sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access' = 'workspace-write'
  readonly sessions = new Map<string, FakeSession>()
  private callSeq = 0

  readonly ctx = {
    tools: { register: (definition: any) => (this.tools.set(definition.name, definition), () => this.tools.delete(definition.name)) },
    systemPrompt: { section: (section: any) => (this.sections.push(section), () => undefined) },
    get: (name: string) => this.services.get(name),
    on: (event: string, listener: Listener) => {
      const list = this.listeners.get(event) ?? []
      list.push(listener)
      this.listeners.set(event, list)
      return () => undefined
    },
    effect: (execute: () => () => void) => {
      this.disposers.push(execute())
    },
    inject: (_deps: string[], callback: (ctx: any) => void) => {
      callback({ commands: { register: (definition: any) => (this.commands.set(definition.name, definition), () => undefined) } })
    },
    logger: { warn: (message: string) => void this.warnings.push(message) },
  }

  constructor() {
    this.services.set('sessions', { get: (id: string) => this.sessions.get(id) })
    const host = this
    this.services.set('approval', {
      effectivePolicy: () => host.approvalPolicy,
      request: async (req: { reason?: string; displayReason?: unknown }) => {
        // Like the real service: `never` rejects before any prompt is shown.
        if (host.approvalPolicy === 'never') return 'rejected'
        this.approvals.push({ reason: req.reason, displayReason: req.displayReason })
        return this.approvalAnswer
      },
    })
    this.services.set('sandboxPolicy', { resolve: () => ({ mode: host.sandboxMode }) })
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose()
  }

  async newAgent(cwd: string, parent?: FakeAgent): Promise<FakeAgent> {
    const session = new FakeSession(parent === undefined ? { cwd } : { cwd, parentSession: parent.session.id })
    this.sessions.set(session.id, session)
    const agent = new FakeAgent(session)
    for (const listener of this.listeners.get('agent/created') ?? []) await listener({ agent, source: 'new' })
    return agent
  }

  /** Resume: a fresh agent object (no plugin memory) over an existing session log. */
  async resumeAgent(session: FakeSession): Promise<FakeAgent> {
    const agent = new FakeAgent(session)
    for (const listener of this.listeners.get('agent/created') ?? []) await listener({ agent, source: 'resume' })
    return agent
  }

  systemPrompt(agent: AgentLike): string {
    return this.sections
      .toSorted((a, b) => a.order - b.order)
      .map((section) => section.text({ agent }))
      .filter((text) => text.length > 0)
      .join('\n\n')
  }

  /**
   * Run one turn like the agent loop: build the system prompt (appending a
   * system message only when it changed), run the pre-step waterfall over the
   * new input, and append what enters. Returns the entering messages.
   */
  async turn(agent: FakeAgent, input: string): Promise<MessageLike[]> {
    const session = agent.session
    const rendered = this.systemPrompt(agent)
    const latest = session.surface.nodes
      .map((seq) => session.eventAt(seq))
      .filter((event) => event?.type === 'system/message')
      .at(-1)
    const latestText = (latest?.data as { message?: MessageLike } | undefined)?.message?.content[0]?.text
    if (latestText !== rendered) session.append('system/message', { message: { role: 'system', content: [{ type: 'text', text: rendered }], source: { kind: 'system-prompt' } } }, true)
    const claimed: MessageLike = { id: `m${this.callSeq++}`, role: 'user', content: [{ type: 'text', text: input }], source: { kind: 'user' } }
    const listeners = this.listeners.get('agent/pre-step') ?? []
    const signal = new AbortController().signal
    const run = (index: number): Promise<any> => {
      const listener = listeners[index]
      if (listener === undefined) return Promise.resolve({ kind: 'enter', messages: [claimed] })
      return listener({ agent, messages: [claimed], turn: 1, step: 1, signal }, () => run(index + 1))
    }
    const decision = await run(0)
    for (const message of decision.messages) session.append('user/message', message, true)
    return decision.messages
  }

  /** Execute a tool through the pre-execute gate (with approval) like the tools runtime. */
  async callTool(agent: AgentLike, name: string, args: unknown): Promise<{ ok: true; value: any; text: string } | { ok: false; error: string }> {
    const token = Symbol('exec')
    const exec = { callId: `call-${this.callSeq++}`, name, arguments: args, agent, token, signal: new AbortController().signal }
    const listeners = this.listeners.get('tools/pre-execute') ?? []
    const run = (index: number): Promise<any> => {
      const listener = listeners[index]
      if (listener === undefined) return Promise.resolve({ kind: 'allow' })
      return listener(exec, () => run(index + 1))
    }
    let decision = await run(0)
    if (decision.kind === 'ask') {
      const outcome = await (this.services.get('approval') as any).request({ agent, toolName: name, callId: exec.callId, reason: decision.reason, displayReason: decision.displayReason, signal: exec.signal })
      decision = outcome === 'allowed-once' ? { kind: 'allow' } : { kind: 'deny', reason: `the user rejected tool "${name}"` }
    }
    let result: { ok: true; value: any; text: string } | { ok: false; error: string }
    if (decision.kind !== 'allow') result = { ok: false, error: decision.reason }
    else {
      try {
        const value = await this.tools.get(name).execute(args, exec)
        result = { ok: true, value, text: this.tools.get(name).output.render(args, value)[0].text }
      } catch (error) {
        result = { ok: false, error: (error as Error).message }
      }
    }
    for (const listener of this.listeners.get('tools/result') ?? []) listener(exec, result)
    return result
  }

  /** Call a tool's `execute` directly, skipping the pre-execute gate. */
  async callToolUngated(agent: AgentLike, name: string, args: unknown): Promise<any> {
    const exec = { callId: `call-${this.callSeq++}`, name, arguments: args, agent, token: Symbol('exec'), signal: new AbortController().signal }
    return this.tools.get(name).execute(args, exec)
  }

  async command(agent: AgentLike, name: string, rawInput: string): Promise<{ kind: string; text?: string }> {
    return this.commands.get(name).handler({ agent, rawInput, attachments: [] })
  }
}
