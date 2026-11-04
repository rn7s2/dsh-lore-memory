import { describe, expect, it } from 'vitest'

import { createApi, messageOf } from '../src/client/api.js'

describe('client api', () => {
  it('unwraps a successful RemoteResult', async () => {
    const api = createApi(() => ({
      overview: async () => ({ ok: true, value: { status: { state: 'ready' }, scopes: [], total: { lore: 0, memory: 0 } } }),
    }))
    expect((await api.overview()).status.state).toBe('ready')
  })

  it('throws the Host message on a failed RemoteResult', async () => {
    const api = createApi(() => ({ overview: async () => ({ ok: false, error: { message: 'the store is unavailable' } }) }))
    await expect(api.overview()).rejects.toThrow('the store is unavailable')
  })

  it('calls the delete wire method, not a remove method', async () => {
    const calls: unknown[] = []
    const api = createApi(() => ({
      delete: async (request: unknown) => {
        calls.push(request)
        return { ok: true, value: { entry: { id: 1 } } }
      },
    }))
    await api.delete({ type: 'lore', scope: '/work', id: 1 })
    expect(calls).toEqual([{ type: 'lore', scope: '/work', id: 1 }])
  })

  it('reports a missing namespace and formats non-Error values', async () => {
    const missing = createApi(() => undefined)
    await expect(missing.overview()).rejects.toThrow(/not mounted/)
    expect(messageOf('down')).toBe('down')
    expect(messageOf(42)).toBe('The request failed.')
    expect(messageOf(new Error('nope'))).toBe('nope')
  })
})
