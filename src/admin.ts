/**
 * The management operations behind the Web page.
 *
 * The page addresses an entry by its owning scope path, so the user can fix a
 * rule anywhere, including a parent folder that a session can only read. The
 * agent's tools keep their workspace rules; this surface is the user's.
 */
import { StoreError, errorMessage } from './errors.js'
import {
  NAMESPACE,
  type CreateRequest,
  type EntriesRequest,
  type EntriesResult,
  type EntryResult,
  type Overview,
  type RemoveRequest,
  type UpdateRequest,
} from './remote.js'
import type { LoreMemoryStore } from './store.js'

/** A failure the gateway forwards to the browser with its code intact. */
export class AdminError extends Error {
  override readonly name = 'RemoteError'
  readonly isDSHRemoteError = true

  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
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
    const report = { state: status.state, ...(status.reason === undefined ? {} : { reason: status.reason }), dbPath: status.dbPath }
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

  /** The entries of one type at and below `prefix`. */
  async entries(request: EntriesRequest): Promise<EntriesResult> {
    const store = await this.store
    return { entries: await attempt(() => store.listUnderAsync(request.type, request.prefix)) }
  }

  /** Add one entry to `scope`. */
  async create(request: CreateRequest): Promise<EntryResult> {
    const store = await this.store
    const entry = await attempt(() =>
      store.add(request.type, request.scope, request.text, request.kind ?? null, { author: 'user' }),
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
  async remove(request: RemoveRequest): Promise<EntryResult> {
    const store = await this.store
    return { entry: await attempt(() => store.remove(request.type, request.scope, request.id)) }
  }
}

export interface RemoteService {
  overview(): Promise<Overview>
  entries(request: EntriesRequest): Promise<EntriesResult>
  create(request: CreateRequest): Promise<EntryResult>
  update(request: UpdateRequest): Promise<EntryResult>
  remove(request: RemoveRequest): Promise<EntryResult>
  readonly typertRemote: { readonly service: RemoteService; readonly serviceKey: string; readonly namespace: string }
}

/** The Service object `ctx.provide(NAMESPACE, …)` installs, with its Remote binding. */
export function createRemoteService(admin: LoreMemoryAdmin): RemoteService {
  const service = {
    overview: () => admin.overview(),
    entries: (request: EntriesRequest) => admin.entries(request),
    create: (request: CreateRequest) => admin.create(request),
    update: (request: UpdateRequest) => admin.update(request),
    remove: (request: RemoveRequest) => admin.remove(request),
  } as unknown as RemoteService
  Object.defineProperty(service, 'typertRemote', {
    value: Object.freeze({ service, serviceKey: NAMESPACE, namespace: NAMESPACE }),
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return service
}
