import { homedir } from 'node:os'
import { isAbsolute, join, normalize } from 'node:path'

import z from '@deepseek-ai/schemastery'

/** Shared by every DSH profile on this machine unless a profile overrides it. */
export const DEFAULT_DB_PATH = '~/.dsh/lore-memory.db'
export const DEFAULT_SEARCH_LIMIT = 8
export const MAX_SEARCH_LIMIT = 100

export interface LoreMemoryConfig {
  dbPath?: string
  searchLimitDefault?: number
}

export const Config = z.object({
  dbPath: z
    .string()
    .default(DEFAULT_DB_PATH)
    .description('SQLite database holding lore and memory. The default is shared by all DSH profiles on this machine; `~/` expands to the home folder.'),
  searchLimitDefault: z
    .natural()
    .min(1)
    .max(MAX_SEARCH_LIMIT)
    .default(DEFAULT_SEARCH_LIMIT)
    .description('Number of results a lore or memory query returns when it gives no limit.'),
})

export interface ResolvedConfig {
  readonly dbPath: string
  readonly searchLimitDefault: number
}

export function resolveConfig(config: LoreMemoryConfig = {}): ResolvedConfig {
  const raw = typeof config.dbPath === 'string' && config.dbPath.trim() !== '' ? config.dbPath.trim() : DEFAULT_DB_PATH
  let dbPath: string
  if (raw === '~' || raw.startsWith('~/')) dbPath = normalize(join(homedir(), raw.slice(1)))
  else if (isAbsolute(raw)) dbPath = normalize(raw)
  else throw new Error(`dsh-lore-memory: dbPath must be absolute or start with ~/ (got ${JSON.stringify(raw)})`)
  const limit = config.searchLimitDefault ?? DEFAULT_SEARCH_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
    throw new Error(`dsh-lore-memory: searchLimitDefault must be an integer from 1 to ${MAX_SEARCH_LIMIT} (got ${String(limit)})`)
  }
  return { dbPath, searchLimitDefault: limit }
}
