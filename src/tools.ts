/**
 * The `lore` and `memory` agent tools.
 *
 * Every lore change the agent makes needs the user's approval through the
 * host's approval prompt: a `tools/pre-execute` gate asks before dispatch, and
 * the tool asks the approval service itself if that gate was bypassed. A
 * rejected or unavailable approval writes nothing.
 */
import { StoreError } from './errors.js'
import type { AgentLike } from './host.js'
import { renderChange, renderResults } from './render.js'
import type { LoreMemoryService } from './service.js'
import { type Entry, type EntryType, MEMORY_KINDS, type MemoryKind, isMemoryKind } from './store.js'

type JsonSchema = Record<string, unknown>

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

export interface ApprovalLike {
  request(req: {
    agent: AgentLike
    toolName: string
    callId?: string
    reason?: string
    displayReason?: { en: string; [locale: string]: string }
    signal: AbortSignal
  }): Promise<ApprovalOutcome>
}

export interface ToolExecLike {
  readonly callId: string
  readonly name: string
  readonly arguments: unknown
  readonly agent?: AgentLike
  readonly token?: unknown
  readonly signal: AbortSignal
}

export interface ToolDefinitionLike {
  name: string
  description: string
  parameters: JsonSchema
  output: { schema: JsonSchema; render(args: unknown, value: unknown): { type: 'text'; text: string }[] }
  execute(args: unknown, exec: ToolExecLike): Promise<unknown>
  isConcurrencySafe?(args: unknown): boolean
  presentCall?(args: unknown): unknown
}

export const LORE_ACTIONS = ['query', 'add', 'edit', 'remove'] as const
export const MEMORY_ACTIONS = ['query', 'add', 'update', 'remove'] as const

interface ParsedArgs {
  action: string
  query?: string
  text?: string
  id?: number
  kind?: MemoryKind
  limit?: number
}

function parseArgs(raw: unknown, actions: readonly string[], allowKind: boolean): ParsedArgs {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new StoreError('INVALID', 'arguments must be an object')
  const args = raw as Record<string, unknown>
  const allowed = new Set(['action', 'query', 'text', 'id', 'limit', ...(allowKind ? ['kind'] : [])])
  for (const key of Object.keys(args)) if (!allowed.has(key)) throw new StoreError('INVALID', `unknown argument "${key}"`)
  const { action, query, text, id, kind, limit } = args
  if (typeof action !== 'string' || !actions.includes(action)) throw new StoreError('INVALID', `action must be one of ${actions.join(', ')}`)
  const parsed: ParsedArgs = { action }
  if (query !== undefined) {
    if (typeof query !== 'string') throw new StoreError('INVALID', 'query must be a string')
    if (query.trim() !== '') parsed.query = query.trim()
  }
  if (text !== undefined) {
    if (typeof text !== 'string') throw new StoreError('INVALID', 'text must be a string')
    parsed.text = text
  }
  if (id !== undefined) {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new StoreError('INVALID', 'id must be a positive integer')
    parsed.id = id
  }
  if (kind !== undefined) {
    if (!isMemoryKind(kind)) throw new StoreError('INVALID', `kind must be one of ${MEMORY_KINDS.join(', ')}`)
    parsed.kind = kind
  }
  if (limit !== undefined) {
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new StoreError('INVALID', 'limit must be an integer from 1 to 100')
    parsed.limit = limit
  }
  return parsed
}

function need<T>(value: T | undefined, name: string, action: string): T {
  if (value === undefined) throw new StoreError('INVALID', `${action} needs ${name}`)
  return value
}

function requireAgent(exec: ToolExecLike): AgentLike {
  if (exec.agent === undefined) throw new StoreError('INVALID', `${exec.name} must be called by an agent session`)
  return exec.agent
}

interface ResultValue {
  message: string
  entries: { id: number; scope: string; kind?: string; text: string }[]
}

function value(message: string, entries: readonly Entry[]): ResultValue {
  return {
    message,
    entries: entries.map((entry) => ({ id: entry.id, scope: entry.scope, ...(entry.kind === null ? {} : { kind: entry.kind }), text: entry.text })),
  }
}

const OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'entries'],
  properties: {
    message: { type: 'string' },
    entries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'scope', 'text'],
        properties: {
          id: { type: 'integer' },
          scope: { type: 'string' },
          kind: { type: 'string', enum: [...MEMORY_KINDS] },
          text: { type: 'string' },
        },
      },
    },
  },
}

const render = (_args: unknown, result: unknown): { type: 'text'; text: string }[] => [{ type: 'text', text: (result as ResultValue).message }]

async function query(service: LoreMemoryService, type: EntryType, agent: AgentLike, args: ParsedArgs, defaultLimit: number): Promise<ResultValue> {
  const workspace = await service.workspaceOf(agent)
  const store = await service.store()
  const entries =
    args.query === undefined
      ? await store.listAsync(type, workspace, args.kind)
      : await store.search(type, workspace, args.query, args.limit ?? defaultLimit, args.kind)
  return value(renderResults(type, entries, workspace, args.query), entries)
}

/** A one-line, user-facing account of a lore change, for the approval prompt. */
export interface LoreChangePlan {
  readonly reason: string
  readonly displayReason: { en: string; zh: string }
}

const clip = (text: string, max = 600): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

/**
 * Validate a lore change and describe it for approval. Throws the error the
 * tool would report, so nothing is asked for a change that cannot happen.
 */
export async function planLoreChange(service: LoreMemoryService, agent: AgentLike, rawArgs: unknown): Promise<LoreChangePlan | undefined> {
  const args = parseArgs(rawArgs, LORE_ACTIONS, false)
  if (args.action === 'query') return undefined
  const workspace = await service.workspaceOf(agent)
  const store = await service.store()
  if (args.action === 'add') {
    const text = need(args.text, 'text', 'add').trim()
    if (text === '') throw new StoreError('INVALID', 'text must be a non-empty string')
    store.checkWritable()
    return {
      reason: `Add lore to ${workspace}: ${clip(text)}`,
      displayReason: { en: `Add this rule to the lore of ${workspace}:\n${clip(text)}`, zh: `将此规则加入 ${workspace} 的 lore：\n${clip(text)}` },
    }
  }
  const id = need(args.id, 'id', args.action)
  const current = store.checkOwned('lore', workspace, id)
  if (args.action === 'edit') {
    const text = need(args.text, 'text', 'edit').trim()
    if (text === '') throw new StoreError('INVALID', 'text must be a non-empty string')
    return {
      reason: `Edit lore #${id} in ${workspace}: ${clip(current.text, 300)} -> ${clip(text)}`,
      displayReason: {
        en: `Change lore #${id} of ${workspace}\nfrom: ${clip(current.text, 300)}\nto: ${clip(text)}`,
        zh: `修改 ${workspace} 的 lore #${id}\n原文：${clip(current.text, 300)}\n改为：${clip(text)}`,
      },
    }
  }
  return {
    reason: `Remove lore #${id} from ${workspace}: ${clip(current.text)}`,
    displayReason: { en: `Remove lore #${id} from ${workspace}:\n${clip(current.text)}`, zh: `删除 ${workspace} 的 lore #${id}：\n${clip(current.text)}` },
  }
}

export interface ToolDeps {
  readonly service: LoreMemoryService
  readonly searchLimitDefault: number
  readonly approval: () => ApprovalLike | undefined
  /** Executions whose approval the pre-execute gate already obtained. */
  readonly approved: { has(token: unknown): boolean; delete(token: unknown): boolean }
}

export function loreTool(deps: ToolDeps): ToolDefinitionLike {
  const { service } = deps
  return {
    name: 'lore',
    description:
      "Lore: rules the user set for a workspace; the current lore is shown to you at the start of every turn. query searches the lore visible here (this workspace and its parent workspaces). add, edit, and remove change this workspace's lore and each needs the user's approval; lore of parent workspaces is read-only here.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: [...LORE_ACTIONS] },
        query: {
          type: 'string',
          description: 'For query: search terms. Entries matching any term are returned, best match first; Chinese, English, and pinyin all work. Omit to list all visible lore.',
        },
        text: { type: 'string', description: 'For add and edit: the complete rule.' },
        id: { type: 'integer', description: 'For edit and remove: the entry id (#id).' },
        limit: { type: 'integer', description: `For query with terms: maximum results, 1-100; default ${deps.searchLimitDefault}.` },
      },
    },
    output: { schema: OUTPUT_SCHEMA, render },
    isConcurrencySafe: (args) => (args as { action?: unknown } | undefined)?.action === 'query',
    presentCall: (args) => ({ card: 'generic', title: `Lore: ${String((args as { action?: unknown }).action ?? '')}`, kind: (args as { action?: unknown }).action === 'query' ? 'search' : 'edit', rawInput: args }),
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = parseArgs(rawArgs, LORE_ACTIONS, false)
      if (args.action === 'query') return await query(service, 'lore', agent, args, deps.searchLimitDefault)
      const plan = await planLoreChange(service, agent, rawArgs)
      const gated = exec.token !== undefined && deps.approved.delete(exec.token)
      if (!gated) {
        const approval = deps.approval()
        if (approval === undefined) throw new StoreError('NOT_APPROVED', 'lore changes need the user\'s approval, and no approval service is available; nothing was changed')
        const outcome = await approval.request({ agent, toolName: exec.name, callId: exec.callId, reason: plan!.reason, displayReason: plan!.displayReason, signal: exec.signal })
        if (outcome !== 'allowed-once') throw new StoreError('NOT_APPROVED', `the lore change was not approved (${outcome}); nothing was changed`)
      }
      const workspace = await service.workspaceOf(agent)
      const store = await service.store()
      const meta = { author: 'agent' as const, sessionId: agent.session.id }
      let entry: Entry
      if (args.action === 'add') entry = await store.add('lore', workspace, args.text!, null, meta)
      else if (args.action === 'edit') entry = await store.update('lore', workspace, args.id!, { text: args.text! }, meta)
      else entry = await store.remove('lore', workspace, args.id!)
      const verb = args.action === 'add' ? 'Added' : args.action === 'edit' ? 'Updated' : 'Removed'
      return value(`${renderChange(verb, entry)} The user approved it; it takes effect from the next turn's lore copy.`, [entry])
    },
  }
}

export function memoryTool(deps: ToolDeps): ToolDefinitionLike {
  const { service } = deps
  return {
    name: 'memory',
    description:
      'Your memory: knowledge you keep for yourself across sessions, per workspace. The memory visible here (this workspace and its parent workspaces) was loaded into your system prompt when this session started; query finds newer entries. Record durable, reusable knowledge rather than task progress, and keep it current: update entries that changed and remove wrong ones. Changes apply to this workspace only.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: [...MEMORY_ACTIONS] },
        query: {
          type: 'string',
          description: 'For query: search terms. Entries matching any term are returned, best match first; Chinese, English, and pinyin all work. Omit to list all visible memory.',
        },
        kind: {
          type: 'string',
          enum: [...MEMORY_KINDS],
          description: 'Required for add; optional for update. For query: return only this kind.',
        },
        text: { type: 'string', description: 'For add and update: the complete entry.' },
        id: { type: 'integer', description: 'For update and remove: the entry id (#id).' },
        limit: { type: 'integer', description: `For query with terms: maximum results, 1-100; default ${deps.searchLimitDefault}.` },
      },
    },
    output: { schema: OUTPUT_SCHEMA, render },
    isConcurrencySafe: (args) => (args as { action?: unknown } | undefined)?.action === 'query',
    presentCall: (args) => ({ card: 'generic', title: `Memory: ${String((args as { action?: unknown }).action ?? '')}`, kind: (args as { action?: unknown }).action === 'query' ? 'search' : 'edit', rawInput: args }),
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = parseArgs(rawArgs, MEMORY_ACTIONS, true)
      if (args.action === 'query') return await query(service, 'memory', agent, args, deps.searchLimitDefault)
      const workspace = await service.workspaceOf(agent)
      const store = await service.store()
      const meta = { author: 'agent' as const, sessionId: agent.session.id }
      if (args.action === 'add') {
        const entry = await store.add('memory', workspace, need(args.text, 'text', 'add'), need(args.kind, 'kind', 'add'), meta)
        return value(renderChange('Added', entry), [entry])
      }
      const id = need(args.id, 'id', args.action)
      if (args.action === 'update') {
        const entry = await store.update('memory', workspace, id, { ...(args.text === undefined ? {} : { text: args.text }), ...(args.kind === undefined ? {} : { kind: args.kind }) }, meta)
        return value(renderChange('Updated', entry), [entry])
      }
      const entry = await store.remove('memory', workspace, id)
      return value(renderChange('Removed', entry), [entry])
    },
  }
}
