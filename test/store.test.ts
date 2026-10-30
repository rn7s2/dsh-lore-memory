import { cpSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { isVisible, visibleScopes } from '../src/scope.js'
import { LoreMemoryStore } from '../src/store.js'
import { defaultNativeRoot, verifyTokenizer } from '../src/tokenizer.js'
import { FAST_RETRY, tempDir, workspaces } from './helpers.js'

const opened: LoreMemoryStore[] = []
async function open(dbPath: string, nativeRoot?: string): Promise<LoreMemoryStore> {
  const store = await LoreMemoryStore.open({ dbPath, retry: FAST_RETRY, ...(nativeRoot === undefined ? {} : { nativeRoot }) })
  opened.push(store)
  return store
}
afterEach(() => {
  for (const store of opened.splice(0)) store.close()
})

const user = { author: 'user' as const }

describe('scopes (§2)', () => {
  it('follows the visibility table on whole path components', () => {
    expect(isVisible('/work', '/work')).toBe(true)
    expect(isVisible('/work', '/work/acme')).toBe(true)
    expect(isVisible('/work', '/work/acme-other')).toBe(true)
    expect(isVisible('/work/acme', '/work')).toBe(false)
    expect(isVisible('/work/acme', '/work/acme')).toBe(true)
    expect(isVisible('/work/acme', '/work/acme-other')).toBe(false)
    expect(isVisible('/Work', '/work/acme')).toBe(false)
    expect(visibleScopes('/work/acme')).toEqual(['/work/acme', '/work', '/'])
    expect(visibleScopes('/')).toEqual(['/'])
  })
})

describe('store', () => {
  it('verifies the vendored tokenizer', () => {
    expect(verifyTokenizer().ok).toBe(true)
  })

  it('shows entries per the §2 table and writes only to the given workspace', async () => {
    const root = tempDir()
    const { work, acme, other } = workspaces(root)
    const store = await open(join(root, 'db.sqlite'))
    expect(store.status().state).toBe('ready')
    const broad = await store.add('lore', work, 'Use pnpm, never npm.', null, user)
    const narrow = await store.add('lore', acme, 'Run tests with vitest.', null, user)
    expect(broad.scope).toBe(work)
    expect(narrow.scope).toBe(acme)
    expect(store.list('lore', work).map((e) => e.id)).toEqual([broad.id])
    expect(store.list('lore', acme).map((e) => e.id)).toEqual([narrow.id, broad.id]) // nearest first
    expect(store.list('lore', other).map((e) => e.id)).toEqual([broad.id])
    expect(store.list('memory', acme)).toEqual([])
  })

  it('refuses to change a parent workspace entry and names the workspace to open', async () => {
    const root = tempDir()
    const { work, acme, other } = workspaces(root)
    const store = await open(join(root, 'db.sqlite'))
    const broad = await store.add('memory', work, 'The CI runs on macOS.', 'fact', { author: 'agent' })
    const narrow = await store.add('memory', acme, 'acme uses Postgres 16.', 'fact', { author: 'agent' })
    await expect(store.update('memory', acme, broad.id, { text: 'changed' }, user)).rejects.toMatchObject({ code: 'PARENT_SCOPE', message: expect.stringContaining(`open a session in ${work}`) })
    await expect(store.remove('memory', acme, broad.id)).rejects.toMatchObject({ code: 'PARENT_SCOPE' })
    await expect(store.remove('memory', other, narrow.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(store.remove('lore', acme, narrow.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(store.list('memory', acme).map((e) => e.text)).toEqual(['acme uses Postgres 16.', 'The CI runs on macOS.'])
    const updated = await store.update('memory', acme, narrow.id, { kind: 'constraint' }, user)
    expect(updated).toMatchObject({ kind: 'constraint', text: 'acme uses Postgres 16.' })
    expect((await store.remove('memory', acme, narrow.id)).id).toBe(narrow.id)
    expect(store.list('memory', acme).map((e) => e.id)).toEqual([broad.id])
  })

  it('validates input', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const store = await open(join(root, 'db.sqlite'))
    await expect(store.add('memory', acme, 'x', null, user)).rejects.toMatchObject({ code: 'INVALID' })
    await expect(store.add('lore', acme, '   ', null, user)).rejects.toMatchObject({ code: 'INVALID' })
    await expect(store.update('lore', acme, 1, {}, user)).rejects.toMatchObject({ code: 'INVALID' })
  })

  it('searches Chinese, English, prefixes, and pinyin, any term, ranked by bm25 (§4)', async () => {
    const root = tempDir()
    const { work, acme, other } = workspaces(root)
    const store = await open(join(root, 'db.sqlite'))
    const pnpm = await store.add('memory', acme, '使用 pnpm 安装依赖，不要用 npm。', 'convention', user)
    const tests = await store.add('memory', acme, '测试用 vitest 运行，测试文件放在 test 目录。', 'procedure', user)
    const singer = await store.add('memory', work, '周杰伦是用户最喜欢的歌手。', 'fact', user)
    const parser = await store.add('memory', acme, 'The parser is tested by snapshot testing.', 'fact', user)
    await store.add('memory', other, '测试 in a sibling workspace must stay invisible', 'fact', user)

    // A Chinese query finds Chinese entries; nothing from acme-other leaks in.
    expect((await store.search('memory', acme, '测试', 8)).map((e) => e.id)).toEqual([tests.id])
    // Any term matches; an entry matching more terms ranks first.
    const ids = (await store.search('memory', acme, '测试 vitest pnpm', 8)).map((e) => e.id)
    expect(ids[0]).toBe(tests.id)
    expect(ids).toContain(pnpm.id)
    // Prefix: `test` finds `testing`/`tested`.
    expect((await store.search('memory', acme, 'test', 8)).map((e) => e.id)).toContain(parser.id)
    // Pinyin finds Chinese; parent workspace entries are included with their scope.
    const hits = await store.search('memory', acme, 'zhoujielun', 8)
    expect(hits.map((e) => [e.id, e.scope])).toEqual([[singer.id, work]])
    // Kind filter and limit.
    expect((await store.search('memory', acme, '测试 pnpm', 8, 'convention')).map((e) => e.id)).toEqual([pnpm.id])
    expect(await store.search('memory', acme, '测试 pnpm parser', 1)).toHaveLength(1)
    // Punctuation-only and FTS syntax characters are harmless.
    expect(await store.search('memory', acme, '   ', 8)).toEqual([])
    expect(await store.search('memory', acme, '"( * - NEAR AND OR NOT', 8)).toEqual([])
  })

  it('keeps the index in step with edits and removals', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const store = await open(join(root, 'db.sqlite'))
    const entry = await store.add('lore', acme, 'Deploy with kubectl.', null, user)
    await store.update('lore', acme, entry.id, { text: '部署使用 helm。' }, user)
    expect(await store.search('lore', acme, 'kubectl', 8)).toEqual([])
    expect((await store.search('lore', acme, '部署', 8)).map((e) => e.id)).toEqual([entry.id])
    await store.remove('lore', acme, entry.id)
    expect(await store.search('lore', acme, '部署', 8)).toEqual([])
  })

  it('shares one database between independent connections, as two DSH profiles do', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const dbPath = join(root, 'shared.sqlite')
    const first = await open(dbPath)
    const second = await open(dbPath)
    const entry = await first.add('lore', acme, 'Shared rule.', null, user)
    expect(second.list('lore', acme).map((e) => e.id)).toEqual([entry.id])
    expect((await second.search('lore', acme, 'shared', 8)).map((e) => e.id)).toEqual([entry.id])
  })

  it('retries a busy database without blocking, then fails with "busy, try again"', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const dbPath = join(root, 'db.sqlite')
    const store = await open(dbPath)
    const holder = new DatabaseSync(dbPath)
    try {
      holder.exec('BEGIN IMMEDIATE')
      let ticks = 0
      const timer = setInterval(() => (ticks += 1), 5)
      await expect(store.add('lore', acme, 'blocked', null, user)).rejects.toMatchObject({ code: 'BUSY', message: expect.stringContaining('try again') })
      clearInterval(timer)
      expect(ticks).toBeGreaterThan(5) // the event loop kept running while retrying
      expect(store.list('lore', acme)).toEqual([])

      // A lock released within the budget lets the write through.
      holder.exec('COMMIT')
      holder.exec('BEGIN IMMEDIATE')
      const pending = store.add('lore', acme, 'eventually', null, user)
      setTimeout(() => holder.exec('COMMIT'), 60)
      expect((await pending).text).toBe('eventually')
    } finally {
      if (holder.isTransaction) holder.exec('ROLLBACK')
      holder.close()
    }
  })

  it('becomes read-only with the reason when the tokenizer is tampered with (§9)', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const dbPath = join(root, 'db.sqlite')
    const good = await open(dbPath)
    await good.add('lore', acme, 'Existing rule.', null, user)
    await good.add('memory', acme, 'Existing memory.', 'fact', user)
    good.close()

    const nativeRoot = join(root, 'native-simple')
    cpSync(defaultNativeRoot(), nativeRoot, { recursive: true })
    const library = join(nativeRoot, `darwin-${process.arch}`, 'libsimple.dylib')
    const bytes = readFileSync(library)
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff
    writeFileSync(library, bytes)

    const tampered = await open(dbPath, nativeRoot)
    expect(tampered.status()).toMatchObject({ state: 'read-only', reason: expect.stringContaining('failed its integrity check') })
    expect(tampered.list('lore', acme).map((e) => e.text)).toEqual(['Existing rule.'])
    expect((await tampered.listAsync('memory', acme)).map((e) => e.text)).toEqual(['Existing memory.'])
    await expect(tampered.search('lore', acme, 'rule', 8)).rejects.toMatchObject({ code: 'READ_ONLY', message: expect.stringContaining('integrity check') })
    await expect(tampered.add('lore', acme, 'new', null, user)).rejects.toMatchObject({ code: 'READ_ONLY', message: expect.stringContaining('integrity check') })
    await expect(tampered.remove('lore', acme, 1)).rejects.toMatchObject({ code: 'READ_ONLY' })
  })

  it('a dictionary file counts as part of the tokenizer', () => {
    const root = tempDir()
    const nativeRoot = join(root, 'native-simple')
    cpSync(defaultNativeRoot(), nativeRoot, { recursive: true })
    writeFileSync(join(nativeRoot, 'dict', 'user.dict.utf8'), 'tampered\n')
    expect(verifyTokenizer(nativeRoot)).toMatchObject({ ok: false, reason: expect.stringContaining('dict/user.dict.utf8') })
    expect(verifyTokenizer(nativeRoot, 'linux', 'x64')).toMatchObject({ ok: false, reason: expect.stringContaining('macOS only') })
  })

  it('a fresh database opened read-only gains its index once the tokenizer is back', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const dbPath = join(root, 'db.sqlite')
    const broken = await open(dbPath, join(root, 'missing'))
    expect(broken.status().state).toBe('read-only')
    expect(broken.list('lore', acme)).toEqual([])
    broken.close()
    const fixed = await open(dbPath)
    expect(fixed.status().state).toBe('ready')
    const entry = await fixed.add('lore', acme, '中文规则', null, user)
    expect((await fixed.search('lore', acme, '规则', 8)).map((e) => e.id)).toEqual([entry.id])
  })

  it('reports an unusable database path as unavailable', async () => {
    const root = tempDir()
    writeFileSync(join(root, 'file'), 'not a directory')
    const store = await open(join(root, 'file', 'db.sqlite'))
    expect(store.status()).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('cannot open the database') })
    expect(() => store.list('lore', root)).toThrow(/unavailable/)
  })
})
