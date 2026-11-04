/**
 * The Remote surface of the management page: one specification shared by the
 * Host descriptors and the browser contribution, so both sides agree on the
 * endpoint names, the wire fields, and the shapes.
 *
 * Nothing here imports Node.js or React: the Host bundle registers these
 * descriptors and the browser bundle mounts the same list.
 */
import { MEMORY_KINDS, type Entry, type EntryType, type MemoryKind, isMemoryKind } from './types.js'

/** The package name, used as the descriptor id prefix and the contribution key. */
export const PACKAGE_NAME = 'dsh-lore-memory'

/** The Remote namespace (`ctx.remote.loreMemory` on the browser side). */
export const NAMESPACE = 'loreMemory'

/** The `main` panel key and the matching sidebar entry id. */
export const PANEL_ID = 'lore-memory'

export interface OverviewStatus {
  readonly state: 'ready' | 'read-only' | 'unavailable'
  readonly reason?: string
}

export interface ScopeSummary {
  readonly path: string
  readonly lore: number
  readonly memory: number
}

export interface Overview {
  readonly status: OverviewStatus
  readonly scopes: readonly ScopeSummary[]
  readonly total: { readonly lore: number; readonly memory: number }
}

export interface EntriesResult {
  readonly entries: readonly Entry[]
}

export interface EntryResult {
  readonly entry: Entry
}

export interface EntriesRequest {
  readonly type: EntryType
  readonly prefix: string
}

export interface CreateRequest {
  readonly type: EntryType
  readonly scope: string
  readonly text: string
  readonly kind?: MemoryKind
}

export interface UpdateRequest {
  readonly type: EntryType
  readonly scope: string
  readonly id: number
  readonly text?: string
  readonly kind?: MemoryKind
}

export interface RemoveRequest {
  readonly type: EntryType
  readonly scope: string
  readonly id: number
}

/** A strict codec: the Host and the client both parse through `create().parse`. */
export interface StrictCodec<T> {
  readonly mode: 'strict'
  readonly typeSymbol: string
  create(): { parse(value: unknown): T }
}

export interface RemoteParameter {
  readonly name: string
  readonly wire: string
  readonly source: 'json'
  readonly codec: StrictCodec<unknown>
}

export interface RemoteDescriptor {
  readonly id: string
  readonly service: string
  readonly namespace: string
  readonly method: string
  readonly invocation: { readonly kind: 'direct' }
  readonly parameters: readonly RemoteParameter[]
  readonly result: StrictCodec<unknown>
}

/** The mountable contribution the browser hands to `ctx.remote.$mount`. */
export interface RemoteContribution {
  readonly package: string
  readonly descriptors: readonly RemoteDescriptor[]
}

function codec<T>(name: string, parse: (value: unknown) => T): StrictCodec<T> {
  return {
    mode: 'strict',
    typeSymbol: `${PACKAGE_NAME}#${name}`,
    create: () => ({ parse }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strictObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError('expected an object')
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw new TypeError(`unexpected field ${JSON.stringify(key)}`)
  }
  return value
}

function required<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new TypeError(`${field} is required`)
  return value
}

function entryTypeOf(value: unknown): EntryType {
  if (value !== 'lore' && value !== 'memory') throw new TypeError('type must be "lore" or "memory"')
  return value
}

/** An absolute folder path, without trailing slashes (except the root itself). */
function pathOf(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${field} must be a non-empty absolute path`)
  if (!value.startsWith('/')) throw new TypeError(`${field} must be an absolute path`)
  const trimmed = value.length > 1 ? value.replace(/\/+$/, '') : value
  if (trimmed.split('/').includes('..')) throw new TypeError(`${field} must not contain ".."`)
  return trimmed === '' ? '/' : trimmed
}

function textOf(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError('text must be a non-empty string')
  return value.trim()
}

function idOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new TypeError('id must be a positive integer')
  return value
}

function kindOf(type: EntryType, value: unknown): MemoryKind | null {
  if (type === 'lore') {
    if (value !== undefined && value !== null) throw new TypeError('lore entries have no kind')
    return null
  }
  if (!isMemoryKind(value)) throw new TypeError(`kind must be one of ${MEMORY_KINDS.join(', ')}`)
  return value
}

function optionalKindOf(type: EntryType, value: unknown): MemoryKind | undefined {
  if (value === undefined) return undefined
  if (type === 'lore') throw new TypeError('lore entries have no kind')
  if (!isMemoryKind(value)) throw new TypeError(`kind must be one of ${MEMORY_KINDS.join(', ')}`)
  return value
}

const entriesRequest = codec<EntriesRequest>('EntriesRequest', (value) => {
  const object = strictObject(value, ['type', 'prefix'])
  return { type: entryTypeOf(required(object['type'], 'type')), prefix: pathOf(required(object['prefix'], 'prefix'), 'prefix') }
})

const createRequest = codec<CreateRequest>('CreateRequest', (value) => {
  const object = strictObject(value, ['type', 'scope', 'text', 'kind'])
  const type = entryTypeOf(required(object['type'], 'type'))
  const kind = kindOf(type, object['kind'])
  return {
    type,
    scope: pathOf(required(object['scope'], 'scope'), 'scope'),
    text: textOf(required(object['text'], 'text')),
    ...(kind === null ? {} : { kind }),
  }
})

const updateRequest = codec<UpdateRequest>('UpdateRequest', (value) => {
  const object = strictObject(value, ['type', 'scope', 'id', 'text', 'kind'])
  const type = entryTypeOf(required(object['type'], 'type'))
  const text = object['text'] === undefined ? undefined : textOf(object['text'])
  const kind = optionalKindOf(type, object['kind'])
  const id = idOf(required(object['id'], 'id'))
  if (text === undefined && kind === undefined) throw new TypeError('nothing to change: give text or kind')
  return {
    type,
    scope: pathOf(required(object['scope'], 'scope'), 'scope'),
    id,
    ...(text === undefined ? {} : { text }),
    ...(kind === undefined ? {} : { kind }),
  }
})

const removeRequest = codec<RemoveRequest>('RemoveRequest', (value) => {
  const object = strictObject(value, ['type', 'scope', 'id'])
  return {
    type: entryTypeOf(required(object['type'], 'type')),
    scope: pathOf(required(object['scope'], 'scope'), 'scope'),
    id: idOf(required(object['id'], 'id')),
  }
})

function passThrough<T>(value: unknown): T {
  return value as T
}

const overviewResult = codec<Overview>('Overview', passThrough)
const entriesResult = codec<EntriesResult>('EntriesResult', passThrough)
const entryResult = codec<EntryResult>('EntryResult', passThrough)

function directMethod(
  method: string,
  parameters: readonly RemoteParameter[],
  result: StrictCodec<unknown>,
): RemoteDescriptor {
  return {
    id: `${PACKAGE_NAME}#${NAMESPACE}/${method}`,
    service: NAMESPACE,
    namespace: NAMESPACE,
    method,
    invocation: { kind: 'direct' },
    parameters,
    result,
  }
}

function parameter(name: string, spec: StrictCodec<unknown>): RemoteParameter {
  return { name, wire: name, source: 'json', codec: spec }
}

/**
 * Build the descriptors for the five page operations. Order is stable so the
 * contribution and Host registration are identical in every process.
 *
 * Method names must not shadow a member of the gateway's namespace service
 * (`remove`, `has`, `install`, `namespace`, …): `ctx.remote.$mount` rejects
 * such a name outright, so the delete operation is exposed as `delete`.
 */
export function buildDescriptors(): RemoteDescriptor[] {
  return [
    directMethod('overview', [], overviewResult),
    directMethod('entries', [parameter('request', entriesRequest)], entriesResult),
    directMethod('create', [parameter('request', createRequest)], entryResult),
    directMethod('update', [parameter('request', updateRequest)], entryResult),
    directMethod('delete', [parameter('request', removeRequest)], entryResult),
  ]
}

/** The contribution the browser mounts; the Host registers the same descriptors. */
export function buildContribution(): RemoteContribution {
  return { package: PACKAGE_NAME, descriptors: buildDescriptors() }
}
