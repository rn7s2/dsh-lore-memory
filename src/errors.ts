/** Failures the store and tools report to the agent and the user. */
export type StoreErrorCode =
  /** The database could not be opened or used. */
  | 'UNAVAILABLE'
  /** The tokenizer is unavailable: listing works, search and writes do not. */
  | 'READ_ONLY'
  /** Another process held the write lock for too long. */
  | 'BUSY'
  /** No such entry is visible from the session's workspace. */
  | 'NOT_FOUND'
  /** The entry belongs to a parent workspace, which is read-only from below. */
  | 'PARENT_SCOPE'
  /** The request itself is invalid. */
  | 'INVALID'
  /** The user did not approve a lore change. */
  | 'NOT_APPROVED'

export class StoreError extends Error {
  override readonly name = 'StoreError'
  constructor(
    readonly code: StoreErrorCode,
    message: string,
  ) {
    super(message)
  }
}

/** SQLite primary result codes for a held lock. */
const SQLITE_BUSY = 5
const SQLITE_LOCKED = 6

/** Whether a node:sqlite error means the database is locked by another connection. */
export function isBusyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const errcode = (error as { errcode?: unknown }).errcode
  if (typeof errcode === 'number') {
    const primary = errcode & 0xff
    return primary === SQLITE_BUSY || primary === SQLITE_LOCKED
  }
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && /database (?:table )?is locked|database is busy/i.test(message)
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
