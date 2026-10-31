import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { activate, Config, MEMORY_SECTION } from '../src/index.js'
import { resolveConfig } from '../src/config.js'
import { memoryRequest } from '../src/commands.js'
import { LoreMemoryStore } from '../src/store.js'
import { FAST_RETRY, FakeHost, tempDir, workspaces } from './helpers.js'

const hosts: FakeHost[] = []
function setup(dbPath: string, config: Record<string, unknown> = {}, nativeRoot?: string) {
  const host = new FakeHost()
  hosts.push(host)
  const { service, store } = activate(host.ctx, { dbPath, ...config }, { retry: FAST_RETRY, ...(nativeRoot === undefined ? {} : { nativeRoot }) })
  return { host, service, store }
}
afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose()
})

const loreOf = (messages: { source: { kind: string }; content: readonly { text?: string }[] }[]) =>
  messages.filter((m) => m.source.kind === 'lore-memory').map((m) => m.content[0]!.text!)

describe('activation', () => {
  it('registers the tools, the commands, and the memory section', async () => {
    const root = tempDir()
    const { host, store } = setup(join(root, 'db.sqlite'))
    await store
    expect([...host.tools.keys()].sort()).toEqual(['lore', 'memory'])
    expect([...host.commands.keys()].sort()).toEqual(['lore', 'memory'])
    expect(host.sections).toEqual([expect.objectContaining({ name: MEMORY_SECTION.name, interpolate: false })])
    for (const tool of host.tools.values()) {
      expect(tool.parameters).toMatchObject({ type: 'object', required: ['action'], additionalProperties: false })
      expect(tool.description.length).toBeLessThan(600)
    }
  })

  it('validates config and defaults to the machine-wide database shared by profiles', () => {
    expect(Config({})).toEqual({ dbPath: '~/.dsh/lore-memory.db', searchLimitDefault: 8 })
    expect(() => Config({ searchLimitDefault: 0 })).toThrow()
    const a = resolveConfig({})
    expect(a.dbPath).toMatch(/\/\.dsh\/lore-memory\.db$/)
    const before = process.env.DSH_PROFILE
    process.env.DSH_PROFILE = 'another-profile'
    expect(resolveConfig({}).dbPath).toBe(a.dbPath)
    process.env.DSH_PROFILE = before
    expect(() => resolveConfig({ dbPath: 'relative.db' })).toThrow(/absolute/)
  })
})

describe('§10 acceptance', () => {
  it('visibility follows §2 and writes land only in the session workspace', async () => {
    const root = tempDir()
    const { work, acme, other } = workspaces(root)
    const { host } = setup(join(root, 'db.sqlite'))
    const atWork = await host.newAgent(work)
    const atAcme = await host.newAgent(acme)
    const atOther = await host.newAgent(other)
    await host.callTool(atWork, 'memory', { action: 'add', kind: 'fact', text: 'Work-wide fact.' })
    await host.callTool(atAcme, 'memory', { action: 'add', kind: 'decision', text: 'acme chose SQLite.' })
    const list = async (agent: typeof atWork) => ((await host.callTool(agent, 'memory', { action: 'query' })) as any).value.entries.map((e: any) => e.scope)
    expect(await list(atWork)).toEqual([work])
    expect(await list(atAcme)).toEqual([acme, work])
    expect(await list(atOther)).toEqual([work])
  })

  it('a subagent reads and writes its parent session workspace, wherever it runs', async () => {
    const root = tempDir()
    const { work, acme } = workspaces(root)
    const { host } = setup(join(root, 'db.sqlite'))
    const parent = await host.newAgent(acme)
    const child = await host.newAgent(work, parent)
    const added = (await host.callTool(child, 'memory', { action: 'add', kind: 'fact', text: 'Written by a subagent.' })) as any
    expect(added.value.entries[0].scope).toBe(acme)
  })

  it('a workspace is identified by its real path', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const link = join(root, 'link-to-acme')
    symlinkSync(acme, link)
    const { host } = setup(join(root, 'db.sqlite'))
    const viaLink = await host.newAgent(link)
    const added = (await host.callTool(viaLink, 'memory', { action: 'add', kind: 'fact', text: 'Through a symlink.' })) as any
    expect(added.value.entries[0].scope).toBe(acme)
  })

  it('refuses to change a parent workspace entry', async () => {
    const root = tempDir()
    const { work, acme } = workspaces(root)
    const { host } = setup(join(root, 'db.sqlite'))
    const atWork = await host.newAgent(work)
    const atAcme = await host.newAgent(acme)
    const added = (await host.callTool(atWork, 'memory', { action: 'add', kind: 'fact', text: 'Parent fact.' })) as any
    const id = added.value.entries[0].id
    const refused = await host.callTool(atAcme, 'memory', { action: 'remove', id })
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining(`open a session in ${work}`) })

    await host.command(atWork, 'lore', 'Parent rule.')
    host.approvalAnswer = 'allowed-once'
    const loreRefused = await host.callTool(atAcme, 'lore', { action: 'remove', id: id + 1 })
    expect(loreRefused).toMatchObject({ ok: false, error: expect.stringContaining('parent workspace') })
    expect(host.approvals).toEqual([]) // nothing to approve for a change that cannot happen
  })

  it('an agent lore change shows an approval prompt; rejecting it writes nothing', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const { host, store } = setup(join(root, 'db.sqlite'))
    const agent = await host.newAgent(acme)

    host.approvalAnswer = 'rejected'
    const rejected = await host.callTool(agent, 'lore', { action: 'add', text: 'Always use tabs.' })
    expect(rejected.ok).toBe(false)
    expect(host.approvals).toHaveLength(1)
    expect(host.approvals[0]!.reason).toContain('Always use tabs.')
    expect(host.approvals[0]!.displayReason).toMatchObject({ en: expect.stringContaining(acme), zh: expect.any(String) })
    expect((await store).list('lore', acme)).toEqual([])

    host.approvalAnswer = 'allowed-once'
    const allowed = (await host.callTool(agent, 'lore', { action: 'add', text: 'Always use tabs.' })) as any
    expect(allowed.ok).toBe(true)
    const id = allowed.value.entries[0].id
    expect(host.approvals).toHaveLength(2) // asked exactly once more, by the gate

    host.approvalAnswer = 'rejected'
    expect((await host.callTool(agent, 'lore', { action: 'edit', id, text: 'Always use spaces.' })).ok).toBe(false)
    expect(host.approvals.at(-1)!.reason).toContain('Always use spaces.')
    expect((await host.callTool(agent, 'lore', { action: 'remove', id })).ok).toBe(false)
    expect((await store).list('lore', acme).map((e) => e.text)).toEqual(['Always use tabs.'])

    // Queries need no approval.
    const count = host.approvals.length
    expect((await host.callTool(agent, 'lore', { action: 'query', query: 'tabs' })).ok).toBe(true)
    expect(host.approvals).toHaveLength(count)
  })

  it('with approval prompts off outside Full Access the agent cannot change lore, even if the gate is bypassed', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const { host, store } = setup(join(root, 'db.sqlite'))
    const agent = await host.newAgent(acme)
    host.approvalPolicy = 'never'
    host.sandboxMode = 'workspace-write'
    const refused = await host.callTool(agent, 'lore', { action: 'add', text: 'Sneaky rule.' })
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining('approval prompts are off in this session') })
    expect(refused).toMatchObject({ error: expect.stringContaining('/lore <text>') })
    await expect(host.callToolUngated(agent, 'lore', { action: 'add', text: 'Sneaky rule.' })).rejects.toThrow(/approval prompts are off/)
    host.services.delete('approval')
    await expect(host.callToolUngated(agent, 'lore', { action: 'add', text: 'Sneaky rule.' })).rejects.toThrow(/no approval service/)
    expect((await store).list('lore', acme)).toEqual([])
    expect(host.approvals).toEqual([])
  })

  it('in Full Access the agent changes lore directly, without an approval prompt', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const { host, store } = setup(join(root, 'db.sqlite'))
    const agent = await host.newAgent(acme)
    host.approvalPolicy = 'never'
    host.sandboxMode = 'danger-full-access'
    const added = (await host.callTool(agent, 'lore', { action: 'add', text: 'Use pnpm, never npm.' })) as any
    expect(added).toMatchObject({ ok: true, text: expect.stringContaining('Full Access') })
    const id = added.value.entries[0].id
    expect((await host.callTool(agent, 'lore', { action: 'edit', id, text: 'Use pnpm only.' })).ok).toBe(true)
    expect((await store).list('lore', acme).map((e) => e.text)).toEqual(['Use pnpm only.'])
    // The gate-free path decides the same way.
    const direct = await host.callToolUngated(agent, 'lore', { action: 'remove', id })
    expect(direct.message).toContain('Full Access')
    expect((await store).list('lore', acme)).toEqual([])
    expect(host.approvals).toEqual([])
    // Parent workspace lore stays read-only even in Full Access.
    const { work } = workspaces(root)
    await host.command(await host.newAgent(work), 'lore', 'Parent rule.')
    const parentId = (await store).list('lore', work)[0]!.id
    expect(await host.callTool(agent, 'lore', { action: 'remove', id: parentId })).toMatchObject({ ok: false, error: expect.stringContaining('parent workspace') })
  })

  it('a no-sandbox session that still asks for approval keeps asking', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const { host, store } = setup(join(root, 'db.sqlite'))
    const agent = await host.newAgent(acme)
    host.approvalPolicy = 'ask'
    host.sandboxMode = 'danger-full-access'
    host.approvalAnswer = 'rejected'
    expect((await host.callTool(agent, 'lore', { action: 'add', text: 'Asked rule.' })).ok).toBe(false)
    expect(host.approvals).toHaveLength(1)
    expect((await store).list('lore', acme)).toEqual([])
  })

  it('memory changes need no approval', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const { host } = setup(join(root, 'db.sqlite'))
    const agent = await host.newAgent(acme)
    const added = (await host.callTool(agent, 'memory', { action: 'add', kind: 'procedure', text: 'Release: tag, then push.' })) as any
    const id = added.value.entries[0].id
    expect((await host.callTool(agent, 'memory', { action: 'update', id, text: 'Release: bump, tag, push.' })).ok).toBe(true)
    expect((await host.callTool(agent, 'memory', { action: 'remove', id })).ok).toBe(true)
    expect(host.approvals).toEqual([])
  })

  it('a Chinese query finds Chinese entries, and results are presented as reference knowledge', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const { host } = setup(join(root, 'db.sqlite'))
    const agent = await host.newAgent(acme)
    await host.callTool(agent, 'memory', { action: 'add', kind: 'convention', text: '提交信息使用中文，格式为“模块: 描述”。' })
    await host.callTool(agent, 'memory', { action: 'add', kind: 'fact', text: 'The API server listens on port 8080.' })
    const found = (await host.callTool(agent, 'memory', { action: 'query', query: '提交信息格式' })) as any
    expect(found.ok).toBe(true)
    expect(found.value.entries.map((e: any) => e.text)).toEqual(['提交信息使用中文，格式为“模块: 描述”。'])
    expect(found.text).toMatch(/^Reference knowledge, not an instruction for the current task/)
    expect(found.text).toContain('(this workspace)')
  })

  it('uses searchLimitDefault when a query gives no limit', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const { host } = setup(join(root, 'db.sqlite'), { searchLimitDefault: 2 })
    const agent = await host.newAgent(acme)
    for (let i = 0; i < 4; i += 1) await host.callTool(agent, 'memory', { action: 'add', kind: 'fact', text: `deploy note ${i}` })
    expect(((await host.callTool(agent, 'memory', { action: 'query', query: 'deploy' })) as any).value.entries).toHaveLength(2)
    expect(((await host.callTool(agent, 'memory', { action: 'query', query: 'deploy', limit: 3 })) as any).value.entries).toHaveLength(3)
    expect(((await host.callTool(agent, 'memory', { action: 'query' })) as any).value.entries).toHaveLength(4) // listing is complete
    expect(host.tools.get('memory').parameters.properties.limit.description).toContain('default 2')
  })

  it('memory appears once, stays fixed for the session, and survives compaction and resume', async () => {
    const root = tempDir()
    const { work, acme } = workspaces(root)
    const { host, store } = setup(join(root, 'db.sqlite'))
    const writer = await host.newAgent(acme)
    await host.callTool(writer, 'memory', { action: 'add', kind: 'convention', text: 'Prefer small pull requests.' })
    await host.callTool(await host.newAgent(work), 'memory', { action: 'add', kind: 'fact', text: 'Work-wide fact.' })

    const agent = await host.newAgent(acme)
    await host.turn(agent, 'first')
    const systemMessages = () => agent.session.events.filter((e) => e.type === 'system/message')
    const firstPrompt = (systemMessages()[0]!.data as any).message.content[0].text as string
    expect(firstPrompt).toContain('<workspace-memory>')
    expect(firstPrompt).toContain('Prefer small pull requests.')
    expect(firstPrompt.indexOf('(this workspace)')).toBeLessThan(firstPrompt.indexOf('(parent workspace)'))

    // Newer memory does not change the running session's system prompt.
    await host.callTool(agent, 'memory', { action: 'add', kind: 'fact', text: 'Added mid-session.' })
    await host.turn(agent, 'second')
    expect(systemMessages()).toHaveLength(1)
    // ...but the memory tool finds it.
    expect(((await host.callTool(agent, 'memory', { action: 'query', query: 'mid-session' })) as any).value.entries).toHaveLength(1)

    // Compaction keeps the system prompt; the next turn still carries the same memory.
    agent.session.compact()
    await host.turn(agent, 'after compaction')
    expect(systemMessages()).toHaveLength(1)
    expect(host.systemPrompt(agent)).toBe(firstPrompt)

    // Resume in a new process: the snapshot is read back from the log, not the database.
    const fresh = new FakeHost()
    hosts.push(fresh)
    const reopened = activate(fresh.ctx, { dbPath: (await store).status().dbPath }, { retry: FAST_RETRY })
    await reopened.store
    const resumed = await fresh.resumeAgent(agent.session)
    expect(fresh.systemPrompt(resumed)).toBe(firstPrompt)
    expect(fresh.systemPrompt(resumed)).not.toContain('Added mid-session.')

    // A new agent (e.g. a subagent) gets the current memory once, at its own start.
    const later = await host.newAgent(work, agent)
    expect(host.systemPrompt(later)).toContain('Added mid-session.')
  })

  it('a session whose prompt was built without memory does not gain it later', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const { host } = setup(join(root, 'db.sqlite'))
    const agent = await host.newAgent(acme)
    await host.turn(agent, 'hello')
    expect(host.systemPrompt(agent)).toBe('')
    await host.callTool(agent, 'memory', { action: 'add', kind: 'fact', text: 'Late fact.' })
    const fresh = new FakeHost()
    hosts.push(fresh)
    activate(fresh.ctx, { dbPath: join(root, 'db.sqlite') }, { retry: FAST_RETRY })
    expect(fresh.systemPrompt(await fresh.resumeAgent(agent.session))).toBe('')
  })

  it('every turn carries the current lore just before the new input, including lore from another session', async () => {
    const root = tempDir()
    const { work, acme } = workspaces(root)
    const dbPath = join(root, 'db.sqlite')
    const { host } = setup(dbPath)
    const agent = await host.newAgent(acme)

    // No lore yet: nothing is inserted.
    expect(loreOf(await host.turn(agent, 'one') as any)).toEqual([])

    await host.command(agent, 'lore', 'Use pnpm, never npm.')
    const second = await host.turn(agent, 'two')
    expect(second.map((m) => m.source.kind)).toEqual(['lore-memory', 'user'])
    expect(loreOf(second as any)[0]).toContain('Use pnpm, never npm.')

    // Another session (here: another DSH process on the same database) adds lore in this workspace and a parent.
    const other = await LoreMemoryStore.open({ dbPath, retry: FAST_RETRY })
    await other.add('lore', acme, '提交前运行测试。', null, { author: 'user' })
    await other.add('lore', work, 'Parent rule.', null, { author: 'user' })
    other.close()
    const third = loreOf((await host.turn(agent, 'three')) as any)[0]!
    expect(third).toContain('提交前运行测试。')
    expect(third).toContain('Use pnpm, never npm.')
    expect(third.indexOf('(this workspace)')).toBeLessThan(third.indexOf('Parent rule.'))

    // Earlier copies stay where they are.
    const copies = agent.session.events.filter((e) => e.type === 'user/message' && (e.data as any).source.kind === 'lore-memory')
    expect(copies).toHaveLength(2)
    expect((copies[0]!.data as any).content[0].text).not.toContain('提交前运行测试。')
  })

  it('withdrawn lore is announced once, then nothing is inserted', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const { host, store } = setup(join(root, 'db.sqlite'))
    const agent = await host.newAgent(acme)
    await host.command(agent, 'lore', 'Temporary rule.')
    await host.turn(agent, 'one')
    const entry = (await store).list('lore', acme)[0]!
    await (await store).remove('lore', acme, entry.id)
    const withdrawn = loreOf((await host.turn(agent, 'two')) as any)
    expect(withdrawn[0]).toContain('No lore applies')
    expect(loreOf((await host.turn(agent, 'three')) as any)).toEqual([])
  })

  it('a tampered tokenizer leaves the store read-only with the reason reported; listing and injection still work', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const dbPath = join(root, 'db.sqlite')
    const good = await LoreMemoryStore.open({ dbPath })
    await good.add('lore', acme, 'Rule before tampering.', null, { author: 'user' })
    await good.add('memory', acme, 'Memory before tampering.', 'fact', { author: 'agent' })
    good.close()
    const missing = join(root, 'empty-native')
    mkdirSync(missing)
    const { host, store } = setup(dbPath, {}, missing)
    await store
    expect(host.warnings.join('\n')).toMatch(/read-only: .*missing or unreadable/)
    const agent = await host.newAgent(acme)
    expect(loreOf((await host.turn(agent, 'go')) as any)[0]).toContain('Rule before tampering.')
    expect(host.systemPrompt(agent)).toContain('Memory before tampering.')
    expect((await host.callTool(agent, 'memory', { action: 'query' })).ok).toBe(true)
    expect(await host.callTool(agent, 'memory', { action: 'query', query: 'tampering' })).toMatchObject({ ok: false, error: expect.stringContaining('missing or unreadable') })
    expect(await host.callTool(agent, 'memory', { action: 'add', kind: 'fact', text: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining('read-only') })
    expect(await host.command(agent, 'lore', 'x')).toMatchObject({ kind: 'error', text: expect.stringContaining('read-only') })
  })

  it('an unavailable database fails the tools and injects nothing, without breaking the session', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const fileAsDir = join(root, 'file')
    writeFileSync(fileAsDir, '')
    const broken = setup(join(fileAsDir, 'db.sqlite'))
    await broken.store
    const agent = await broken.host.newAgent(acme)
    expect(await broken.host.turn(agent, 'go')).toHaveLength(1)
    expect(broken.host.systemPrompt(agent)).toBe('')
    expect(await broken.host.callTool(agent, 'memory', { action: 'query' })).toMatchObject({ ok: false, error: expect.stringContaining('unavailable') })
    expect(await broken.host.command(agent, 'lore', '')).toMatchObject({ kind: 'error' })
  })
})

describe('commands', () => {
  it('/lore lists or adds without approval; /memory lists or asks the agent', async () => {
    const root = tempDir()
    const { acme } = workspaces(root)
    const { host } = setup(join(root, 'db.sqlite'))
    const agent = await host.newAgent(acme)
    expect((await host.command(agent, 'lore', '')).text).toContain('No lore is visible')
    expect(await host.command(agent, 'lore', '  Use pnpm.  ')).toMatchObject({ kind: 'success', text: expect.stringContaining('Added lore #') })
    expect(host.approvals).toEqual([])
    expect((await host.command(agent, 'lore', '')).text).toContain('Use pnpm.')

    expect((await host.command(agent, 'memory', '')).text).toContain('No memory is visible')
    expect(await host.command(agent, 'memory', 'we moved CI to GitHub Actions')).toMatchObject({ kind: 'success' })
    expect(agent.followups).toHaveLength(1)
    expect(agent.followups[0]!.content[0]!.text).toBe(memoryRequest('we moved CI to GitHub Actions'))
    expect(agent.followups[0]!.source).toEqual({ kind: 'user' })
  })
})
