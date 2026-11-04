import { symlinkSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { LoreMemoryAdmin } from '../src/admin.js'
import { activate } from '../src/index.js'
import { PANEL_ID, buildContribution, buildDescriptors } from '../src/remote.js'
import { en, zh } from '../src/client/locale.js'
import { childrenOf, crumbsOf, isScopePath, lastSegment, normalizeScope, totalsOf } from '../src/client/paths.js'
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
const parseEntries = (value: unknown) => byMethod('entries').parameters[0]!.codec.create().parse(value)

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
    expect((parseCreate({ type: 'lore', scope: '/work/', text: 'x' }) as { scope: string }).scope).toBe('/work')
    expect(() => parseCreate({ type: 'lore', scope: '/', text: 'x' })).toThrow(/filesystem root/)
    expect(() => parseCreate({ type: 'lore', scope: '/work//x', text: 'x' })).toThrow(/empty/)
    expect(() => parseCreate({ type: 'lore', scope: '/work/./x', text: 'x' })).toThrow(/segments/)
    expect(() => parseCreate({ type: 'lore', scope: '/work\u0000x', text: 'x' })).toThrow(/control/)
    expect(parseUpdate({ type: 'memory', scope: '/work', id: 1, text: 'changed' })).toEqual({
      type: 'memory',
      scope: '/work',
      id: 1,
      text: 'changed',
    })
    expect(() => parseUpdate({ type: 'lore', scope: '/work', id: 1, kind: 'fact' })).toThrow(/lore entries have no kind/)
    expect(() => parseUpdate({ type: 'lore', scope: '/work', id: 1 })).toThrow(/nothing to change/)
    expect(() => parseUpdate({ type: 'lore', scope: '/work', id: 0 })).toThrow(/positive integer/)
    expect(parseEntries({ type: 'lore', prefix: '/', query: '  pnpm  ' })).toEqual({ type: 'lore', prefix: '/', query: 'pnpm' })
    expect(parseEntries({ type: 'lore', prefix: '/' })).toEqual({ type: 'lore', prefix: '/' })
    expect(parseEntries({ type: 'lore', prefix: '/', query: '   ' })).toEqual({ type: 'lore', prefix: '/' })
    expect(() => parseEntries({ type: 'lore', prefix: '/', query: 5 })).toThrow(/query must be a string/)
    expect(() => parseEntries({ type: 'lore', prefix: '/', query: 'x'.repeat(501) })).toThrow(/500 characters/)
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
    const searched = await service.entries({ type: 'memory', prefix: work, query: 'postgres' })
    expect(searched).toMatchObject({ entries: [{ text: 'acme uses Postgres 16.' }], truncated: false })
    expect((await service.entries({ type: 'lore', prefix: '/' })).entries).toHaveLength(1)

    // The page may change a parent entry: it names that parent as the scope.
    const updated = await service.update({ type: 'lore', scope: work, id: created.entry.id, text: 'Use pnpm only.' })
    expect(updated.entry.text).toBe('Use pnpm only.')
    const removed = await service.delete({ type: 'lore', scope: work, id: created.entry.id })
    expect(removed.entry.id).toBe(created.entry.id)
    expect((await service.overview()).total).toEqual({ lore: 0, memory: 2 })
  })

  it('bounds one entry page and reports the truncation', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      id: index + 1,
      type: 'lore',
      scope: '/work',
      kind: null,
      text: `entry ${index}`,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }))
    const admin = new LoreMemoryAdmin(
      Promise.resolve({ status: () => ({ state: 'ready', dbPath: '/tmp/db' }), listUnderAsync: async () => rows } as any),
    )
    const page = await admin.entries({ type: 'lore', prefix: '/' })
    expect(page.entries).toHaveLength(500)
    expect(page.truncated).toBe(true)
  })

  it('canonicalises the folder a new entry is written to', async () => {
    const root = tempDir()
    const { work } = workspaces(root)
    const link = join(root, 'linked-work')
    symlinkSync(work, link)
    const { host, opened } = setup(root)
    await opened.store
    const service = host.provided.get('loreMemory') as any
    const created = await service.create({ type: 'lore', scope: link, text: 'Written through a symlink.' })
    expect(created.entry.scope).toBe(work)
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
    await expect(service.create({ type: 'lore', scope: join(root, 'missing'), text: 'typo' })).rejects.toMatchObject({
      code: 'lore-memory/invalid-scope',
    })
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

  it('validates a typed scope path', () => {
    expect(isScopePath('/work/acme')).toBe(true)
    expect(isScopePath('/work/')).toBe(true)
    expect(isScopePath('/')).toBe(false)
    expect(isScopePath('work')).toBe(false)
    expect(isScopePath('/work//x')).toBe(false)
    expect(isScopePath('/work/./x')).toBe(false)
    expect(normalizeScope('/work///')).toBe('/work')
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
