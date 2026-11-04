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
  readonly dbPath: string
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

/** A strict codec: the Host parses every browser-supplied field with `create().parse`. */
export interface StrictCodec<T> {
  readonly mode: 'strict'
  readonly typeSymbol: string
  readonly description: string
  readonly jsonSchema: Readonly<Record<string, unknown>>
  create(): { parse(value: unknown): T }
}

export interface RemoteParameter {
  readonly name: string
  readonly wire: string
  readonly source: 'json'
  readonly description: string
  readonly codec: StrictCodec<unknown>
}

export interface RemoteDescriptor {
  readonly id: string
  readonly service: string
  readonly namespace: string
  readonly method: string
  readonly description: string
  readonly invocation: { readonly kind: 'direct' }
  readonly parameters: readonly RemoteParameter[]
  readonly result: StrictCodec<unknown>
  readonly sourceLocation: { readonly file: string; readonly line: number; readonly column: number }
  /** Envelope parser used by reflection consumers; Host dispatch parses each parameter codec. */
  input(options?: { strict?: boolean }): { create(): { parse(value: unknown): Record<string, unknown> } }
  /** Invoke the business method on a mounted namespace with the parsed envelope. */
  invoke(remote: unknown, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
}

/** The mountable contribution the browser hands to `ctx.remote.$mount`. */
export interface RemoteContribution {
  readonly package: string
  readonly descriptors: readonly RemoteDescriptor[]
  readonly methods: Readonly<Record<string, RemoteDescriptor>>
}

type JsonSchema = Record<string, unknown>

function codec<T>(name: string, description: string, jsonSchema: JsonSchema, parse: (value: unknown) => T): StrictCodec<T> {
  return {
    mode: 'strict',
    typeSymbol: `${PACKAGE_NAME}#${name}`,
    description,
    jsonSchema,
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

const TYPE_ENUM = ['lore', 'memory'] as const
const KIND_ENUM = [...MEMORY_KINDS]

const entriesRequest = codec<EntriesRequest>(
  'EntriesRequest',
  'the entry type and the absolute path prefix to list',
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...TYPE_ENUM] },
      prefix: { type: 'string', minLength: 1, description: 'Absolute path; "/" selects every scope.' },
    },
    required: ['type', 'prefix'],
    additionalProperties: false,
  },
  (value) => {
    const object = strictObject(value, ['type', 'prefix'])
    return { type: entryTypeOf(required(object['type'], 'type')), prefix: pathOf(required(object['prefix'], 'prefix'), 'prefix') }
  },
)

const createRequest = codec<CreateRequest>(
  'CreateRequest',
  'the entry to add',
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...TYPE_ENUM] },
      scope: { type: 'string', minLength: 1, description: 'Absolute path of the folder that owns the entry.' },
      text: { type: 'string', minLength: 1 },
      kind: { type: 'string', enum: KIND_ENUM, description: 'Required for memory, rejected for lore.' },
    },
    required: ['type', 'scope', 'text'],
    additionalProperties: false,
  },
  (value) => {
    const object = strictObject(value, ['type', 'scope', 'text', 'kind'])
    const type = entryTypeOf(required(object['type'], 'type'))
    const kind = kindOf(type, object['kind'])
    return {
      type,
      scope: pathOf(required(object['scope'], 'scope'), 'scope'),
      text: textOf(required(object['text'], 'text')),
      ...(kind === null ? {} : { kind }),
    }
  },
)

const updateRequest = codec<UpdateRequest>(
  'UpdateRequest',
  'the entry to change and its new text and/or kind',
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...TYPE_ENUM] },
      scope: { type: 'string', minLength: 1 },
      id: { type: 'integer', minimum: 1 },
      text: { type: 'string', minLength: 1 },
      kind: { type: 'string', enum: KIND_ENUM },
    },
    required: ['type', 'scope', 'id'],
    additionalProperties: false,
  },
  (value) => {
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
  },
)

const removeRequest = codec<RemoveRequest>(
  'RemoveRequest',
  'the entry to delete',
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...TYPE_ENUM] },
      scope: { type: 'string', minLength: 1 },
      id: { type: 'integer', minimum: 1 },
    },
    required: ['type', 'scope', 'id'],
    additionalProperties: false,
  },
  (value) => {
    const object = strictObject(value, ['type', 'scope', 'id'])
    return {
      type: entryTypeOf(required(object['type'], 'type')),
      scope: pathOf(required(object['scope'], 'scope'), 'scope'),
      id: idOf(required(object['id'], 'id')),
    }
  },
)

function passThrough<T>(value: unknown): T {
  return value as T
}

const overviewResult = codec<Overview>('Overview', 'every scope with its entry counts and the store status', { description: 'the overview' }, passThrough)
const entriesResult = codec<EntriesResult>('EntriesResult', 'the entries at and below the requested prefix', { description: 'the entries' }, passThrough)
const entryResult = codec<EntryResult>('EntryResult', 'the entry that was written', { description: 'the written entry' }, passThrough)

function directMethod(
  method: string,
  description: string,
  parameters: readonly RemoteParameter[],
  result: StrictCodec<unknown>,
): RemoteDescriptor {
  return {
    id: `${PACKAGE_NAME}#${NAMESPACE}/${method}`,
    service: NAMESPACE,
    namespace: NAMESPACE,
    method,
    description,
    invocation: { kind: 'direct' },
    parameters,
    result,
    sourceLocation: { file: `src/{host,client}/${method}.ts`, line: 1, column: 1 },
    input: () => ({
      create: () => ({
        parse: (value: unknown) => {
          const envelope = strictObject(value, parameters.map((parameter) => parameter.wire))
          return Object.fromEntries(parameters.map((parameter) => [parameter.wire, parameter.codec.create().parse(envelope[parameter.wire])]))
        },
      }),
    }),
    invoke: (remote: unknown, input: Record<string, unknown>) => {
      const receiver = remote as Record<string, (...args: unknown[]) => Promise<unknown>>
      const call = receiver[method]
      if (typeof call !== 'function') return Promise.reject(new Error(`Remote namespace has no method ${method}`))
      return call.apply(receiver, parameters.map((parameter) => input[parameter.wire]))
    },
  }
}

function parameter(name: string, description: string, spec: StrictCodec<unknown>): RemoteParameter {
  return { name, wire: name, source: 'json', description, codec: spec }
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
    directMethod(
      'overview',
      'List every scope that holds lore or memory, with its per-type counts and the store status.',
      [],
      overviewResult,
    ),
    directMethod(
      'entries',
      'List the entries of one type stored at an absolute path prefix or in a folder below it.',
      [parameter('request', 'the entry type and the absolute path prefix to list.', entriesRequest)],
      entriesResult,
    ),
    directMethod(
      'create',
      'Add one lore or memory entry to the scope named by its absolute path.',
      [parameter('request', 'the entry to add.', createRequest)],
      entryResult,
    ),
    directMethod(
      'update',
      'Change the text and/or kind of one entry owned by the scope named by its absolute path.',
      [parameter('request', 'the entry to change and its new text and/or kind.', updateRequest)],
      entryResult,
    ),
    directMethod(
      'delete',
      'Delete one entry owned by the scope named by its absolute path.',
      [parameter('request', 'the entry to delete.', removeRequest)],
      entryResult,
    ),
  ]
}

/** The contribution the browser mounts; the Host registers the same descriptors. */
export function buildContribution(): RemoteContribution {
  const descriptors = buildDescriptors()
  return {
    package: PACKAGE_NAME,
    descriptors,
    methods: Object.fromEntries(descriptors.map((descriptor) => [`${descriptor.namespace}/${descriptor.method}`, descriptor])),
  }
}
