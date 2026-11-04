import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { activate } from '../src/index.js'
import { PANEL_ID, buildContribution, buildDescriptors } from '../src/remote.js'
import { en, zh } from '../src/client/locale.js'
import { childrenOf, crumbsOf, lastSegment, totalsOf } from '../src/client/paths.js'
import { FAST_RETRY, FakeHost, tempDir, workspaces } from './helpers.js'

const hosts: FakeHost[] = []
afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose()
})

function setup(root: string) {
  const host = new FakeHost()
  hosts.push(host)
  const opened = activate(host.ctx, { dbPath: join(root, 'db.sqlite') }, { retry: FAST_RETRY })
  return { host, opened }
}

const descriptors = buildDescriptors()
const byMethod = (method: string) => descriptors.find((descriptor) => descriptor.method === method)!
const parseCreate = (value: unknown) => byMethod('create').parameters[0]!.codec.create().parse(value)
const parseUpdate = (value: unknown) => byMethod('update').parameters[0]!.codec.create().parse(value)

describe('Remote descriptors', () => {
  it('exports the five page operations with direct strict signatures', () => {
    expect(descriptors.map((descriptor) => `${descriptor.namespace}/${descriptor.method}`)).toEqual([
      'loreMemory/overview',
      'loreMemory/entries',
      'loreMemory/create',
      'loreMemory/update',
      'loreMemory/delete',
    ])
    for (const descriptor of descriptors) {
      expect(descriptor.id).toBe(`dsh-lore-memory#${descriptor.namespace}/${descriptor.method}`)
      expect(descriptor.service).toBe('loreMemory')
      expect(descriptor.invocation.kind).toBe('direct')
      expect(descriptor.result.mode).toBe('strict')
      expect(descriptor.result.typeSymbol.length).toBeGreaterThan(0)
      expect(typeof descriptor.result.create().parse).toBe('function')
      for (const parameter of descriptor.parameters) {
        expect(parameter.source).toBe('json')
        expect(parameter.codec.mode).toBe('strict')
        expect(typeof parameter.codec.jsonSchema).toBe('object')
      }
    }
    expect(buildContribution().package).toBe('dsh-lore-memory')
    expect(PANEL_ID).toBe('lore-memory')
  })

  it('keeps method names clear of the gateway namespace service', () => {
    // `ctx.remote.$mount` rejects a method that shadows RemoteNamespaceService.
    // Its own `remove` broke the 0.3.0 client boot, so the delete operation is
    // exposed as `delete`.
    const reserved = new Set([
      'ctx',
      'empty',
      'invokeRemote',
      'methods',
      'name',
      'namespace',
      'assertMethodAvailable',
      'has',
      'install',
      'installDirect',
      'installScoped',
      'remove',
      'constructor',
    ])
    for (const descriptor of descriptors) expect(reserved.has(descriptor.method)).toBe(false)
  })

  it('validates create and update input at the boundary', () => {
    expect(parseCreate({ type: 'lore', scope: '/work/', text: '  Use pnpm.  ' })).toEqual({
      type: 'lore',
      scope: '/work',
      text: 'Use pnpm.',
    })
    expect(parseCreate({ type: 'memory', scope: '/work', text: 'macOS only', kind: 'fact' })).toEqual({
      type: 'memory',
      scope: '/work',
      text: 'macOS only',
      kind: 'fact',
    })
    expect(() => parseCreate({ type: 'memory', scope: '/work', text: 'no kind' })).toThrow(/kind must be one of/)
    expect(() => parseCreate({ type: 'lore', scope: '/work', text: 'x', kind: 'fact' })).toThrow(/lore entries have no kind/)
    expect(() => parseCreate({ type: 'lore', scope: 'work', text: 'x' })).toThrow(/absolute path/)
    expect(() => parseCreate({ type: 'lore', scope: '/work', text: 'x', extra: true })).toThrow(/unexpected field/)
    expect(() => parseCreate({ type: 'other', scope: '/work', text: 'x' })).toThrow(/type must be/)
    expect(parseUpdate({ type: 'memory', scope: '/work', id: 1, text: 'changed' })).toEqual({
      type: 'memory',
      scope: '/work',
      id: 1,
      text: 'changed',
    })
    expect(() => parseUpdate({ type: 'lore', scope: '/work', id: 1, kind: 'fact' })).toThrow(/lore entries have no kind/)
    expect(() => parseUpdate({ type: 'lore', scope: '/work', id: 1 })).toThrow(/nothing to change/)
    expect(() => parseUpdate({ type: 'lore', scope: '/work', id: 0 })).toThrow(/positive integer/)
  })
})

describe('management service', () => {
  it('installs the service and the Host descriptors', async () => {
    const root = tempDir()
    const { host, opened } = setup(root)
    await opened.store
    const service = host.provided.get('loreMemory') as any
    expect(service).toBeDefined()
    expect(service.typertRemote).toMatchObject({
      service,
      serviceKey: 'loreMemory',
      namespace: 'loreMemory',
    })
    expect(host.typertContributions).toHaveLength(1)
    expect(host.typertContributions[0]).toMatchObject({ package: 'dsh-lore-memory', face: 'host', schemas: [] })
    expect(host.typertContributions[0].invocations.map((descriptor: any) => descriptor.method)).toEqual([
      'overview',
      'entries',
      'create',
      'update',
      'delete',
    ])
  })

  it('manages entries in any scope, including a parent folder', async () => {
    const root = tempDir()
    const { work, acme } = workspaces(root)
    const { host, opened } = setup(root)
    await opened.store
    const service = host.provided.get('loreMemory') as any

    const created = await service.create({ type: 'lore', scope: work, text: 'Use pnpm, never npm.' })
    expect(created.entry).toMatchObject({ scope: work, kind: null, text: 'Use pnpm, never npm.' })
    await service.create({ type: 'memory', scope: acme, text: 'acme uses Postgres 16.', kind: 'fact' })
    await service.create({ type: 'memory', scope: work, text: 'macOS only.', kind: 'constraint' })

    expect(await service.overview()).toMatchObject({
      status: { state: 'ready' },
      total: { lore: 1, memory: 2 },
    })
    const overview = await service.overview()
    expect(overview.scopes.map((scope: any) => scope.path)).toEqual([work, acme].sort((left, right) => left.localeCompare(right)))

    const under = await service.entries({ type: 'memory', prefix: work })
    expect(under.entries.map((entry: any) => entry.text)).toEqual(['macOS only.', 'acme uses Postgres 16.'])
    expect((await service.entries({ type: 'lore', prefix: '/' })).entries).toHaveLength(1)

    // The page may change a parent entry: it names that parent as the scope.
    const updated = await service.update({ type: 'lore', scope: work, id: created.entry.id, text: 'Use pnpm only.' })
    expect(updated.entry.text).toBe('Use pnpm only.')
    const removed = await service.delete({ type: 'lore', scope: work, id: created.entry.id })
    expect(removed.entry.id).toBe(created.entry.id)
    expect((await service.overview()).total).toEqual({ lore: 0, memory: 2 })
  })

  it('reports store failures with a stable code', async () => {
    const root = tempDir()
    const { work } = workspaces(root)
    const { host, opened } = setup(root)
    await opened.store
    const service = host.provided.get('loreMemory') as any
    await expect(service.create({ type: 'memory', scope: work, text: 'no kind' })).rejects.toMatchObject({
      code: 'lore-memory/invalid',
      message: expect.stringContaining('kind'),
    })
    await expect(service.delete({ type: 'lore', scope: work, id: 99 })).rejects.toMatchObject({ code: 'lore-memory/not-found' })
  })
})

describe('page path arithmetic', () => {
  const scopes = [
    { path: '/other', lore: 1, memory: 1 },
    { path: '/work', lore: 1, memory: 2 },
    { path: '/work/acme', lore: 3, memory: 0 },
    { path: '/work/acme/deep', lore: 0, memory: 4 },
  ]

  it('derives child folders with subtree counts', () => {
    expect(childrenOf(scopes, '/').map((child) => [child.path, child.lore, child.memory])).toEqual([
      ['/other', 1, 1],
      ['/work', 4, 6],
    ])
    expect(childrenOf(scopes, '/work').map((child) => [child.path, child.lore, child.memory])).toEqual([['/work/acme', 3, 4]])
    expect(childrenOf(scopes, '/work/acme').map((child) => [child.path, child.lore, child.memory])).toEqual([
      ['/work/acme/deep', 0, 4],
    ])
    expect(childrenOf(scopes, '/work/acme/deep')).toEqual([])
  })

  it('builds breadcrumbs and totals', () => {
    expect(crumbsOf('/').map((crumb) => crumb.path)).toEqual([])
    expect(crumbsOf('/work/acme').map((crumb) => [crumb.label, crumb.path])).toEqual([
      ['work', '/work'],
      ['acme', '/work/acme'],
    ])
    expect(totalsOf(scopes, '/work')).toEqual({ lore: 4, memory: 6 })
    expect(totalsOf(scopes, '/')).toEqual({ lore: 5, memory: 7 })
    expect(lastSegment('/work/acme')).toBe('acme')
  })
})

describe('page locale', () => {
  it('keeps one key set in English and Chinese', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    expect(Object.values(en).every((value) => value.length > 0)).toBe(true)
    expect(Object.values(zh).every((value) => value.length > 0)).toBe(true)
  })
})
