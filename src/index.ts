/**
 * dsh-lore-memory: per-workspace lore and memory for DeepSeek Harness.
 *
 * - Memory enters each agent's system prompt once, when that prompt is first
 *   built, and stays unchanged for the session (resume and compaction keep it).
 * - Lore enters every turn as a fresh copy placed just before the turn's new
 *   input; earlier copies stay where they are, so the prompt cache holds.
 * - `lore` and `memory` tools; agent lore changes need the user's approval.
 * - `/lore` and `/memory` commands.
 */
import { type LoreMemoryConfig, resolveConfig } from './config.js'
import { errorMessage } from './errors.js'
import type { AgentLike, MessageLike, SessionLike } from './host.js'
import { LoreMemoryService } from './service.js'
import { LoreMemoryStore } from './store.js'
import { loreCommand, memoryCommand, type CommandDefinitionLike } from './commands.js'
import { type ApprovalLike, type ToolDefinitionLike, type ToolExecLike, loreTool, memoryTool, planLoreChange } from './tools.js'

export { Config } from './config.js'

export const name = 'lore-memory'
export const inject = ['tools', 'systemPrompt']

/** System-prompt placement: after the tool sections, before deliverable references. */
export const MEMORY_SECTION = { name: 'lore-memory:memory', order: 8500 } as const

type Disposer = () => void

type PreStepDecision = { kind: 'reject' } | { kind: 'enter'; messages: MessageLike[]; startsRequestSeries?: true }
type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'cancel' }
  | { kind: 'ask'; reason?: string; displayReason?: { en: string; [locale: string]: string } }

interface HostContext {
  tools: { register(definition: ToolDefinitionLike): Disposer }
  systemPrompt: {
    section(section: { name: string; order: number; interpolate?: boolean; text: (context: { agent?: AgentLike }) => string }): Disposer
  }
  get(name: string): unknown
  on(event: string, listener: (...args: any[]) => unknown, options?: { prepend?: boolean }): Disposer
  effect(execute: () => Disposer, label?: string): unknown
  inject(deps: string[], callback: (ctx: { commands: { register(definition: CommandDefinitionLike): Disposer } }) => void): unknown
  logger?: { warn(message: string): void; info?(message: string): void }
}

/** Test seams; never set through the plugin config. */
export interface ApplyOptions {
  readonly nativeRoot?: string
  readonly retry?: { budgetMs: number; initialDelayMs: number; maxDelayMs: number }
}

export function apply(context: unknown, config: LoreMemoryConfig = {}): void {
  activate(context, config)
}

/** The activation body; exported for tests, which pass {@link ApplyOptions}. */
export function activate(context: unknown, config: LoreMemoryConfig = {}, options: ApplyOptions = {}): { service: LoreMemoryService; store: Promise<LoreMemoryStore> } {
  const ctx = context as HostContext
  const resolved = resolveConfig(config)
  const warn = (message: string, error?: unknown): void => {
    const text = `dsh-lore-memory: ${message}${error === undefined ? '' : `: ${errorMessage(error)}`}`
    if (ctx.logger !== undefined) ctx.logger.warn(text)
    else console.warn(text)
  }

  const store = LoreMemoryStore.open({
    dbPath: resolved.dbPath,
    ...(options.nativeRoot === undefined ? {} : { nativeRoot: options.nativeRoot }),
    ...(options.retry === undefined ? {} : { retry: options.retry }),
  })
  void store.then((opened) => {
    const status = opened.status()
    if (status.state !== 'ready') warn(`store is ${status.state}: ${status.reason ?? 'unknown reason'}`)
  })
  ctx.effect(() => () => void store.then((opened) => opened.close()), 'lore-memory: close database')

  const service = new LoreMemoryService({
    store,
    sessionById: (id) => {
      const sessions = ctx.get('sessions') as { get(id: string): SessionLike | undefined } | undefined
      const agents = ctx.get('agents') as { get(id: string): AgentLike | undefined } | undefined
      return sessions?.get(id) ?? agents?.get(id)?.session
    },
    defaultDirectory: () => (ctx.get('workingDirectory') as { defaultDirectory?: string } | undefined)?.defaultDirectory,
    warn,
  })

  // Memory: one snapshot per agent, frozen before its first model step.
  ctx.systemPrompt.section({ name: MEMORY_SECTION.name, order: MEMORY_SECTION.order, interpolate: false, text: (assemble) => service.memorySection(assemble.agent) })
  ctx.on('agent/created', async ({ agent }: { agent: AgentLike }) => {
    await service.prepare(agent)
  })
  ctx.on('agent/disposed', ({ agent }: { agent: AgentLike }) => {
    service.forget(agent)
  })

  // Lore: a fresh copy at the start of every turn, just before its new input.
  ctx.on(
    'agent/pre-step',
    async (
      { agent, messages, step, signal }: { agent: AgentLike; messages: MessageLike[]; step: number; signal: AbortSignal },
      next: () => Promise<PreStepDecision>,
    ) => {
      const decision = await next()
      if (decision.kind !== 'enter' || step !== 1 || messages.length === 0 || signal.aborted) return decision
      const claimedAt = decision.messages.findIndex((message) => messages.includes(message))
      if (claimedAt < 0) return decision
      let lore: MessageLike | undefined
      try {
        lore = await service.loreMessage(agent)
      } catch (error) {
        warn(`lore for ${agent.id} could not be read; this turn carries no lore copy`, error)
        return decision
      }
      signal.throwIfAborted()
      if (lore === undefined) return decision
      return { ...decision, messages: decision.messages.toSpliced(claimedAt, 0, lore) }
    },
  )

  // Agent lore changes: ask the user through the host's approval prompt.
  const approved = new Set<unknown>()
  ctx.on('tools/pre-execute', async (exec: ToolExecLike, next: () => Promise<PreToolDecision>) => {
    const decision = await next()
    if (exec.name !== 'lore' || decision.kind !== 'allow' || exec.agent === undefined) return decision
    let plan
    try {
      plan = await planLoreChange(service, exec.agent, exec.arguments)
    } catch {
      return decision // the tool reports why the change cannot happen; nothing to approve
    }
    if (plan === undefined) return decision
    if (exec.token !== undefined) approved.add(exec.token)
    return { kind: 'ask', reason: plan.reason, displayReason: plan.displayReason }
  })
  ctx.on('tools/result', (exec: ToolExecLike) => {
    if (exec.token !== undefined) approved.delete(exec.token)
  })

  const deps = {
    service,
    searchLimitDefault: resolved.searchLimitDefault,
    approval: () => ctx.get('approval') as ApprovalLike | undefined,
    approved,
  }
  ctx.tools.register(loreTool(deps))
  ctx.tools.register(memoryTool(deps))

  ctx.inject(['commands'], (child) => {
    child.commands.register(loreCommand(service))
    child.commands.register(memoryCommand(service))
  })

  return { service, store }
}
