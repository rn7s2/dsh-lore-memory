import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { tempDir } from './helpers.js'

const root = join(import.meta.dirname, '..')

describe('built bundle', () => {
  it('exports the Cordis plugin surface and finds its vendored tokenizer', async () => {
    // @ts-expect-error -- the built file has no declarations
    const lib = await import('../lib/index.js')
    expect(lib.name).toBe('lore-memory')
    expect(lib.inject).toEqual(['tools', 'systemPrompt'])
    expect(typeof lib.apply).toBe('function')
    expect(lib.Config({})).toEqual({ dbPath: '~/.dsh/lore-memory.db', searchLimitDefault: 8 })
    const host = { warnings: [] as string[] }
    const ctx = {
      tools: { register: () => () => undefined },
      systemPrompt: { section: () => () => undefined },
      get: () => undefined,
      on: () => () => undefined,
      effect: (fn: () => () => void) => void fn,
      inject: () => undefined,
      logger: { warn: (m: string) => void host.warnings.push(m) },
    }
    const { store } = lib.activate(ctx, { dbPath: join(tempDir(), 'db.sqlite') })
    const opened = await store
    expect(opened.status().state).toBe('ready')
    opened.close()
  })

  it('declares the bundle manifest, display metadata, and shipped files', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(pkg.exports['./icon']).toBe('./icon.svg')
    expect(pkg.files).toEqual(expect.arrayContaining(['lib/**/*.js', 'native/**/*', 'locale/*.json', 'cordis.patch.yml', 'icon.svg']))
    for (const locale of ['en', 'zh']) {
      const meta = JSON.parse(readFileSync(join(root, 'locale', `${locale}.json`), 'utf8')).meta
      expect(meta.title.length).toBeGreaterThan(0)
      expect(meta.description.length).toBeGreaterThan(0)
    }
    expect(readFileSync(join(root, 'cordis.patch.yml'), 'utf8')).toContain('name: dsh-lore-memory')
    expect(readFileSync(join(root, 'icon.svg'), 'utf8')).toMatch(/^<svg [^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/)
  })
})
