/**
 * The lore/memory store: one SQLite database per machine holding every entry
 * and a full-text index kept in step with it on every write.
 *
 * Every operation that may meet another process's write lock retries without
 * blocking the event loop (the connection's own busy timeout is zero) and
 * gives up with a `BUSY` error after the retry budget, about 5 seconds.
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { setTimeout as sleep } from 'node:timers/promises'

import { StoreError, errorMessage, isBusyError } from './errors.js'
import { visibleScopes } from './scope.js'
import { type Tokenizer, verifyTokenizer } from './tokenizer.js'

export type EntryType = 'lore' | 'memory'
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

export interface StoreStatus {
  /** `ready`: everything works; `read-only`: listing works, search and writes fail; `unavailable`: nothing works. */
  readonly state: 'ready' | 'read-only' | 'unavailable'
  readonly reason?: string
  readonly dbPath: string
}

export interface RetryPolicy {
  /** Total time to keep retrying a locked database. */
  readonly budgetMs: number
  /** First pause between attempts; doubles up to `maxDelayMs`. */
  readonly initialDelayMs: number
  readonly maxDelayMs: number
}

export const DEFAULT_RETRY: RetryPolicy = Object.freeze({ budgetMs: 5000, initialDelayMs: 10, maxDelayMs: 200 })

export interface OpenOptions {
  readonly dbPath: string
  /** The `native/simple/` directory; defaults to the package's own. */
  readonly nativeRoot?: string
  readonly retry?: RetryPolicy
}

export interface WriteMeta {
  readonly author: Author
  readonly sessionId?: string
}

/** Schema version stored in `PRAGMA user_version`. */
const SCHEMA_VERSION = 1

const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('lore', 'memory')),
  scope TEXT NOT NULL,
  kind TEXT CHECK (kind IN ('constraint', 'convention', 'decision', 'procedure', 'fact')),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author TEXT NOT NULL CHECK (author IN ('user', 'agent')),
  session_id TEXT,
  CHECK ((type = 'lore') = (kind IS NULL))
);
CREATE INDEX IF NOT EXISTS entries_by_scope ON entries (type, scope, id);
`

const INDEX_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(text, content = 'entries', content_rowid = 'id', tokenize = 'simple');
CREATE TRIGGER IF NOT EXISTS entries_fts_insert AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts (rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS entries_fts_delete AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts (entries_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS entries_fts_update AFTER UPDATE OF text ON entries BEGIN
  INSERT INTO entries_fts (entries_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO entries_fts (rowid, text) VALUES (new.id, new.text);
END;
`

interface EntryRow {
  id: number | bigint
  type: string
  scope: string
  kind: string | null
  text: string
  created_at: string
  updated_at: string
}

function toEntry(row: EntryRow): Entry {
  return {
    id: Number(row.id),
    type: row.type as EntryType,
    scope: row.scope,
    kind: row.kind as MemoryKind | null,
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const ENTRY_COLUMNS = 'e.id, e.type, e.scope, e.kind, e.text, e.created_at, e.updated_at'

export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === 'string' && (MEMORY_KINDS as readonly string[]).includes(value)
}

function cleanText(text: unknown): string {
  if (typeof text !== 'string' || text.trim().length === 0) throw new StoreError('INVALID', 'text must be a non-empty string')
  return text.trim()
}

/**
 * Build an any-term FTS5 query: jieba segments the text and expands each
 * term into its prefix and pinyin forms; the terms are then OR-ed so an entry
 * matching any of them is returned and `bm25` ranks entries matching more,
 * and rarer, terms first. Terms made only of punctuation are dropped.
 */
function anyTermQuery(db: DatabaseSync, query: string): string {
  const row = db.prepare('SELECT jieba_query(?) AS q').get(query) as { q: string | null } | undefined
  const terms = (row?.q ?? '')
    .split(' AND ')
    .map((term) => term.trim())
    // A bare punctuation term (`"-"`, `":"`) would match nearly everything.
    .filter((term) => term !== '' && !/^"[^\p{L}\p{N}]*"$/u.test(term))
  return terms.join(' OR ')
}

export class LoreMemoryStore {
  private db: DatabaseSync | null = null
  private tokenizer: Tokenizer | null = null
  private status_: StoreStatus
  private readonly retry: RetryPolicy

  private constructor(private readonly options: OpenOptions) {
    this.retry = options.retry ?? DEFAULT_RETRY
    this.status_ = { state: 'unavailable', reason: 'the database has not been opened yet', dbPath: options.dbPath }
  }

  /** Open the store. Never rejects: inspect {@link status} for failures. */
  static async open(options: OpenOptions): Promise<LoreMemoryStore> {
    const store = new LoreMemoryStore(options)
    await store.start()
    return store
  }

  status(): StoreStatus {
    return this.status_
  }

  close(): void {
    try {
      this.db?.close()
    } catch {
      // already closed
    }
    this.db = null
    this.status_ = { state: 'unavailable', reason: 'the database is closed', dbPath: this.options.dbPath }
  }

  private async start(): Promise<void> {
    const { dbPath } = this.options
    const check = verifyTokenizer(this.options.nativeRoot)
    let db: DatabaseSync
    try {
      mkdirSync(dirname(dbPath), { recursive: true })
      db = new DatabaseSync(dbPath, { allowExtension: true, timeout: 0 })
    } catch (error) {
      this.status_ = { state: 'unavailable', reason: `cannot open the database at ${dbPath}: ${errorMessage(error)}`, dbPath }
      return
    }
    let readOnlyReason: string | undefined
    try {
      if (check.ok) {
        try {
          db.loadExtension(check.tokenizer.library)
          db.prepare('SELECT jieba_dict(?)').get(check.tokenizer.dictDir)
          this.tokenizer = check.tokenizer
        } catch (error) {
          readOnlyReason = `the search tokenizer could not be loaded: ${errorMessage(error)}`
        }
      } else {
        readOnlyReason = check.reason
      }
      db.enableLoadExtension(false)
      this.db = db
      await this.withRetry(() => this.migrate(db))
    } catch (error) {
      this.db = null
      this.tokenizer = null
      try {
        db.close()
      } catch {
        // ignore
      }
      const reason = error instanceof StoreError && error.code === 'BUSY' ? 'the database stayed busy while opening' : errorMessage(error)
      this.status_ = { state: 'unavailable', reason: `cannot use the database at ${dbPath}: ${reason}`, dbPath }
      return
    }
    if (this.status_.state === 'read-only') return // set by migrate (newer schema)
    this.status_ =
      readOnlyReason === undefined ? { state: 'ready', dbPath } : { state: 'read-only', reason: readOnlyReason, dbPath }
  }

  /** Create or upgrade the schema. Runs inside the busy retry. */
  private migrate(db: DatabaseSync): void {
    const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
    if (version > SCHEMA_VERSION) {
      this.tokenizer = null
      this.status_ = {
        state: 'read-only',
        reason: `the database was written by a newer version of dsh-lore-memory (schema ${version}); update the plugin`,
        dbPath: this.options.dbPath,
      }
      return
    }
    const mode = (db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode
    if (mode.toLowerCase() !== 'wal') db.exec('PRAGMA journal_mode = WAL')
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(BASE_SCHEMA)
      if (this.tokenizer !== null) {
        const hadIndex = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'entries_fts'").get() !== undefined
        db.exec(INDEX_SCHEMA)
        if (!hadIndex) db.exec("INSERT INTO entries_fts (entries_fts) VALUES ('rebuild')")
      }
      if (version < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
      db.exec('COMMIT')
    } catch (error) {
      rollback(db)
      throw error
    }
  }

  private requireDb(): DatabaseSync {
    if (this.db === null) throw new StoreError('UNAVAILABLE', `lore and memory are unavailable: ${this.status_.reason ?? 'the database is not open'}`)
    return this.db
  }

  private requireWritable(): DatabaseSync {
    const db = this.requireDb()
    if (this.status_.state !== 'ready') {
      throw new StoreError('READ_ONLY', `lore and memory are read-only: ${this.status_.reason ?? 'the search tokenizer is unavailable'}`)
    }
    return db
  }

  /** Run `operation`, retrying while the database is locked, without blocking the event loop. */
  private async withRetry<T>(operation: () => T): Promise<T> {
    const started = Date.now()
    let delay = this.retry.initialDelayMs
    while (true) {
      try {
        return operation()
      } catch (error) {
        if (!isBusyError(error)) throw error
        const elapsed = Date.now() - started
        if (elapsed >= this.retry.budgetMs) {
          throw new StoreError('BUSY', 'the lore/memory database is busy (another process is writing); try again')
        }
        await sleep(Math.min(delay, this.retry.budgetMs - elapsed))
        delay = Math.min(delay * 2, this.retry.maxDelayMs)
      }
    }
  }

  /** One write transaction, taken with an immediate lock so a busy database is detected before any change. */
  private write<T>(body: (db: DatabaseSync) => T): Promise<T> {
    const db = this.requireWritable()
    return this.withRetry(() => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = body(db)
        db.exec('COMMIT')
        return result
      } catch (error) {
        rollback(db)
        throw error
      }
    })
  }

  /** Every visible entry of `type`, nearest scope first, then oldest first. */
  list(type: EntryType, workspace: string, kind?: MemoryKind): Entry[] {
    const db = this.requireDb()
    const params: SQLInputValue[] = [type, JSON.stringify(visibleScopes(workspace))]
    let filter = ''
    if (kind !== undefined) {
      filter = ' AND e.kind = ?'
      params.push(kind)
    }
    const rows = db
      .prepare(
        `SELECT ${ENTRY_COLUMNS} FROM entries e WHERE e.type = ? AND e.scope IN (SELECT value FROM json_each(?))${filter} ORDER BY length(e.scope) DESC, e.id ASC`,
      )
      .all(...params) as unknown as EntryRow[]
    return rows.map(toEntry)
  }

  /** {@link list} with the busy retry, for callers that can wait. */
  async listAsync(type: EntryType, workspace: string, kind?: MemoryKind): Promise<Entry[]> {
    this.requireDb()
    return await this.withRetry(() => this.list(type, workspace, kind))
  }

  /** Visible entries matching any term of `query`, best first. */
  async search(type: EntryType, workspace: string, query: string, limit: number, kind?: MemoryKind): Promise<Entry[]> {
    const db = this.requireDb()
    if (this.tokenizer === null) {
      throw new StoreError('READ_ONLY', `search is unavailable: ${this.status_.reason ?? 'the search tokenizer is unavailable'}`)
    }
    return await this.withRetry(() => {
      const match = anyTermQuery(db, query)
      if (match === '') return []
      const params: SQLInputValue[] = [match, type, JSON.stringify(visibleScopes(workspace))]
      let filter = ''
      if (kind !== undefined) {
        filter = ' AND e.kind = ?'
        params.push(kind)
      }
      params.push(limit)
      const rows = db
        .prepare(
          `SELECT ${ENTRY_COLUMNS} FROM entries_fts JOIN entries e ON e.id = entries_fts.rowid
           WHERE entries_fts MATCH ? AND e.type = ? AND e.scope IN (SELECT value FROM json_each(?))${filter}
           ORDER BY bm25(entries_fts), length(e.scope) DESC, e.id ASC LIMIT ?`,
        )
        .all(...params) as unknown as EntryRow[]
      return rows.map(toEntry)
    })
  }

  /** One entry by id, if it exists with this type and is visible from `workspace`. */
  get(type: EntryType, workspace: string, id: number): Entry | undefined {
    const db = this.requireDb()
    return this.visible(db, type, workspace, id)
  }

  private visible(db: DatabaseSync, type: EntryType, workspace: string, id: number): Entry | undefined {
    const row = db
      .prepare(`SELECT ${ENTRY_COLUMNS} FROM entries e WHERE e.id = ? AND e.type = ? AND e.scope IN (SELECT value FROM json_each(?))`)
      .get(id, type, JSON.stringify(visibleScopes(workspace))) as EntryRow | undefined
    return row === undefined ? undefined : toEntry(row)
  }

  /** The entry `id` if `workspace` owns it; otherwise the reason it cannot be changed from there. */
  private owned(db: DatabaseSync, type: EntryType, workspace: string, id: number): Entry {
    if (!Number.isSafeInteger(id) || id <= 0) throw new StoreError('INVALID', 'id must be a positive integer')
    const entry = this.visible(db, type, workspace, id)
    if (entry === undefined) throw new StoreError('NOT_FOUND', `no ${type} entry #${id} is visible from ${workspace}`)
    if (entry.scope !== workspace) {
      throw new StoreError(
        'PARENT_SCOPE',
        `${type} entry #${id} belongs to the parent workspace ${entry.scope} and is read-only from ${workspace}; open a session in ${entry.scope} to change it`,
      )
    }
    return entry
  }

  /** Throw the reason writes are refused, if they are. */
  checkWritable(): void {
    this.requireWritable()
  }

  /** Check that `id` could be changed from `workspace` right now, without changing it. */
  checkOwned(type: EntryType, workspace: string, id: number): Entry {
    const db = this.requireWritable()
    return this.owned(db, type, workspace, id)
  }

  /** Add an entry in `workspace`. */
  async add(type: EntryType, workspace: string, text: string, kind: MemoryKind | null, meta: WriteMeta): Promise<Entry> {
    const body = cleanText(text)
    if (type === 'memory' && !isMemoryKind(kind)) throw new StoreError('INVALID', `kind must be one of ${MEMORY_KINDS.join(', ')}`)
    const entryKind = type === 'memory' ? kind : null
    return await this.write((db) => {
      const now = new Date().toISOString()
      const row = db
        .prepare(
          `INSERT INTO entries (type, scope, kind, text, created_at, updated_at, author, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id, type, scope, kind, text, created_at, updated_at`,
        )
        .get(type, workspace, entryKind, body, now, now, meta.author, meta.sessionId ?? null) as unknown as EntryRow
      return toEntry(row)
    })
  }

  /** Change the text and/or kind of an entry owned by `workspace`. */
  async update(type: EntryType, workspace: string, id: number, change: { text?: string; kind?: MemoryKind }, meta: WriteMeta): Promise<Entry> {
    const text = change.text === undefined ? undefined : cleanText(change.text)
    if (change.kind !== undefined && (type !== 'memory' || !isMemoryKind(change.kind))) {
      throw new StoreError('INVALID', type === 'memory' ? `kind must be one of ${MEMORY_KINDS.join(', ')}` : 'lore entries have no kind')
    }
    if (text === undefined && change.kind === undefined) throw new StoreError('INVALID', 'nothing to change: give text or kind')
    return await this.write((db) => {
      const current = this.owned(db, type, workspace, id)
      const row = db
        .prepare(
          `UPDATE entries SET text = ?, kind = ?, updated_at = ?, author = ?, session_id = ? WHERE id = ?
           RETURNING id, type, scope, kind, text, created_at, updated_at`,
        )
        .get(
          text ?? current.text,
          change.kind ?? current.kind,
          new Date().toISOString(),
          meta.author,
          meta.sessionId ?? null,
          id,
        ) as unknown as EntryRow
      return toEntry(row)
    })
  }

  /** Remove an entry owned by `workspace`. */
  async remove(type: EntryType, workspace: string, id: number): Promise<Entry> {
    return await this.write((db) => {
      const current = this.owned(db, type, workspace, id)
      db.prepare('DELETE FROM entries WHERE id = ?').run(id)
      return current
    })
  }
}

function rollback(db: DatabaseSync): void {
  try {
    if (db.isTransaction) db.exec('ROLLBACK')
  } catch {
    // the transaction is already gone
  }
}
