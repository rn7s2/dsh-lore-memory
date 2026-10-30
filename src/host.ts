/**
 * The minimal Harness shapes this plugin relies on. They mirror the Host
 * contracts reported by `cordis_inspect_query` (Agent, Session, events) and
 * keep the plugin free of build-time dependencies on Harness packages.
 */
import { randomUUID } from 'node:crypto'

export interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

export interface MessageLike {
  readonly id: string
  readonly role: string
  readonly content: readonly { readonly type: string; readonly text?: string }[]
  readonly source: { readonly kind: string; readonly [key: string]: unknown }
}

export interface SessionEventLike {
  readonly type: string
  readonly data: unknown
}

export interface SessionHeaderLike {
  readonly cwd?: string
  readonly parentSession?: string
}

export interface SessionLike {
  readonly id: string
  readonly header: SessionHeaderLike
  readonly seq: number
  readonly surface: { readonly nodes: readonly number[] }
  eventAt(seq: number): SessionEventLike | undefined
}

export interface AgentLike {
  readonly id: string
  readonly session: SessionLike
  followup?(message: MessageLike): void
}

/** An immutable, identified user-role message (the Harness's `createUserMessage` shape). */
export function userMessage(text: string, source: MessageLike['source']): MessageLike {
  return deepFreeze({ role: 'user', content: [{ type: 'text', text }], source: structuredClone(source), id: randomUUID() })
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** The text of a single-text-block message, or of all its text blocks joined. */
export function messageText(message: unknown): string {
  const content = (message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) return ''
  return content
    .map((block: unknown) => {
      const text = (block as { type?: unknown; text?: unknown }).type === 'text' ? (block as { text?: unknown }).text : undefined
      return typeof text === 'string' ? text : ''
    })
    .join('')
}
