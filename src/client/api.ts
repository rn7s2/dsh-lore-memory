/**
 * The browser's view of the management Remote: unwraps `RemoteResult` and
 * throws a plain `Error` carrying the Host's message, so every caller can show
 * the reason without knowing the transport.
 */
import type {
  CreateRequest,
  EntriesRequest,
  EntriesResult,
  EntryResult,
  Overview,
  DeleteRequest,
  UpdateRequest,
} from '../remote.js'

interface RemoteResult<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: { readonly message?: string }
}

interface Namespace {
  overview(): Promise<RemoteResult<Overview>>
  entries(request: EntriesRequest): Promise<RemoteResult<EntriesResult>>
  create(request: CreateRequest): Promise<RemoteResult<EntryResult>>
  update(request: UpdateRequest): Promise<RemoteResult<EntryResult>>
  delete(request: DeleteRequest): Promise<RemoteResult<EntryResult>>
}

export interface LoreMemoryApi {
  overview(): Promise<Overview>
  entries(request: EntriesRequest): Promise<EntriesResult>
  create(request: CreateRequest): Promise<EntryResult>
  update(request: UpdateRequest): Promise<EntryResult>
  delete(request: DeleteRequest): Promise<EntryResult>
}

/** A human-readable message for any thrown value. */
export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  if (typeof error === 'string' && error.length > 0) return error
  return 'The request failed.'
}

export function createApi(getService: () => unknown): LoreMemoryApi {
  const call = async <T>(method: keyof Namespace, ...args: unknown[]): Promise<T> => {
    const service = getService() as Namespace | undefined
    if (service === undefined) throw new Error('The lore and memory service is not mounted.')
    const invoke = service[method] as ((...parameters: unknown[]) => Promise<RemoteResult<T>>) | undefined
    if (typeof invoke !== 'function') throw new Error(`The lore and memory service has no ${method} method.`)
    const result = await invoke.apply(service, args)
    if (result.ok) return result.value as T
    throw new Error(result.error?.message ?? 'The request failed.')
  }
  return {
    overview: () => call('overview'),
    entries: (request) => call('entries', request),
    create: (request) => call('create', request),
    update: (request) => call('update', request),
    delete: (request) => call('delete', request),
  }
}
