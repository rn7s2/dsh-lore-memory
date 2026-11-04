/**
 * The management operations behind the Web page.
 *
 * The page addresses an entry by its owning scope path, so the user can fix a
 * rule anywhere, including a parent folder that a session can only read. The
 * agent's tools keep their workspace rules; this surface is the user's.
 */
import { stat } from 'node:fs/promises'

import { StoreError, errorMessage } from './errors.js'
import {
  ENTRY_PAGE_SIZE,
  NAMESPACE,
  type CreateRequest,
  type EntriesRequest,
  type EntriesResult,
  type EntryResult,
  type Overview,
  type DeleteRequest,
  type UpdateRequest,
} from './remote.js'
import { canonicalWorkspace } from './scope.js'
import type { LoreMemoryStore } from './store.js'

/** A failure the gateway forwards to the browser with its code intact. */
class AdminError extends Error {
  override readonly name = 'RemoteError'
  readonly isDSHRemoteError = true

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const ERROR_CODES: Readonly<Record<StoreError['code'], string>> = {
  UNAVAILABLE: 'lore-memory/unavailable',
  READ_ONLY: 'lore-memory/read-only',
  BUSY: 'lore-memory/busy',
  NOT_FOUND: 'lore-memory/not-found',
  PARENT_SCOPE: 'lore-memory/parent-scope',
  INVALID: 'lore-memory/invalid',
  NOT_APPROVED: 'lore-memory/not-approved',
}

/** Run one store operation, reporting its failure as a Remote error with the reason. */
async function attempt<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof StoreError) throw new AdminError(ERROR_CODES[error.code], error.message)
    throw new AdminError('lore-memory/failed', errorMessage(error))
  }
}

/** The methods exposed on `loreMemory`; the browser calls them through Typert Remote. */
export class LoreMemoryAdmin {
  constructor(private readonly store: Promise<LoreMemoryStore>) {}

  /** Every scope with its counts, plus the store status so the page can explain a degraded store. */
  async overview(): Promise<Overview> {
    const store = await this.store
    const status = store.status()
    const report = { state: status.state, ...(status.reason === undefined ? {} : { reason: status.reason }) }
    if (status.state === 'unavailable') return { status: report, scopes: [], total: { lore: 0, memory: 0 } }
    const counts = await attempt(() => store.scopeCountsAsync())
    const scopes = counts.map((count) => ({ path: count.scope, lore: count.lore, memory: count.memory }))
    return {
      status: report,
      scopes,
      total: {
        lore: scopes.reduce((sum, scope) => sum + scope.lore, 0),
        memory: scopes.reduce((sum, scope) => sum + scope.memory, 0),
      },
    }
  }

  /** The entries of one type at and below `prefix`, bounded by one page. */
  async entries(request: EntriesRequest): Promise<EntriesResult> {
    const store = await this.store
    const rows = await attempt(() => store.listUnderAsync(request.type, request.prefix, ENTRY_PAGE_SIZE + 1))
    return { entries: rows.slice(0, ENTRY_PAGE_SIZE), truncated: rows.length > ENTRY_PAGE_SIZE }
  }

  /**
   * Add one entry to `scope`. The folder must exist: a typo in the page's
   * scope field would otherwise confirm a write that no session can ever read.
   * Updates and deletes keep working for folders that have since disappeared.
   */
  async create(request: CreateRequest): Promise<EntryResult> {
    const store = await this.store
    const scope = await canonicalWorkspace(request.scope)
    const folder = await stat(scope).catch(() => undefined)
    if (folder === undefined || !folder.isDirectory()) {
      throw new AdminError('lore-memory/invalid-scope', `${request.scope} is not an existing folder; nothing was changed`)
    }
    const entry = await attempt(() =>
      store.add(request.type, scope, request.text, request.kind ?? null, { author: 'user' }),
    )
    return { entry }
  }

  /** Change one entry owned by `scope`. */
  async update(request: UpdateRequest): Promise<EntryResult> {
    const store = await this.store
    const entry = await attempt(() =>
      store.update(request.type, request.scope, request.id, { text: request.text, kind: request.kind }, { author: 'user' }),
    )
    return { entry }
  }

  /** Delete one entry owned by `scope`. */
  async remove(request: DeleteRequest): Promise<EntryResult> {
    const store = await this.store
    return { entry: await attempt(() => store.remove(request.type, request.scope, request.id)) }
  }
}

interface RemoteService {
  overview(): Promise<Overview>
  entries(request: EntriesRequest): Promise<EntriesResult>
  create(request: CreateRequest): Promise<EntryResult>
  update(request: UpdateRequest): Promise<EntryResult>
  delete(request: DeleteRequest): Promise<EntryResult>
  readonly typertRemote: { readonly service: RemoteService; readonly serviceKey: string; readonly namespace: string }
}

/** The Service object `ctx.provide(NAMESPACE, …)` installs, with its Remote binding. */
export function createRemoteService(admin: LoreMemoryAdmin): RemoteService {
  const service = {
    overview: () => admin.overview(),
    entries: (request: EntriesRequest) => admin.entries(request),
    create: (request: CreateRequest) => admin.create(request),
    update: (request: UpdateRequest) => admin.update(request),
    delete: (request: DeleteRequest) => admin.remove(request),
  } as unknown as RemoteService
  Object.defineProperty(service, 'typertRemote', {
    value: Object.freeze({ service, serviceKey: NAMESPACE, namespace: NAMESPACE }),
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return service
}
