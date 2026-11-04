/**
 * Value shapes shared by the store, the tools, the commands, and the Web page.
 *
 * This module is deliberately free of Node.js imports: the browser bundle
 * reads these constants too, and must not pull `node:sqlite` in with them.
 */

export type EntryType = 'lore' | 'memory'

/** The kinds a memory entry can have; lore entries have none. */
export const MEMORY_KINDS = ['constraint', 'convention', 'decision', 'procedure', 'fact'] as const

export type MemoryKind = (typeof MEMORY_KINDS)[number]

export type Author = 'user' | 'agent'

export interface Entry {
  readonly id: number
  readonly type: EntryType
  readonly scope: string
  readonly kind: MemoryKind | null
  readonly text: string
  readonly createdAt: string
  readonly updatedAt: string
}

export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === 'string' && (MEMORY_KINDS as readonly string[]).includes(value)
}
