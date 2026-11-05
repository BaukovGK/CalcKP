import { describe, expect, it, vi } from 'vitest'
import { BitrixRestError } from './bitrix-auth'
import { B24ClientError, createB24Client, OAuthError, type StoredToken, type TokenStore } from './b24-client'

const NOW = Date.UTC(2026, 10, 5, 10, 0, 0)

function memStore(initial?: StoredToken): TokenStore & { data: Map<string, StoredToken> } {
  const data = new Map<string, StoredToken>()
  if (initial) data.set('u1', initial)
  return {
    data,
    get: async id => data.get(id) ?? null,
    save: async (id, t) => { data.set(id, t) },
    remove: async id => { data.delete(id) },
  }
}

const fresh = (over: Partial<StoredToken> = {}): StoredToken => ({
  bitrixUserId: '7', accessToken: 'A1', refreshToken: 'R1', expiresAt: new Date(NOW + 30 * 60_000), ...over,
})

async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p } catch (e) { return e instanceof B24ClientError ? e.code : 'other' }
  return 'ok'
}

describe('клиент REST от имени сотрудника', () => {
  it('живой ключ — вызов без продления', async () => {
    const rest = vi.fn(async () => ({ ID: '5' }))
    const refresh = vi.fn()
    const c = createB24Client({ rest, store: memStore(fresh()), refresh, now: () => NOW })
    expect(await c.call('u1', 'crm.deal.get', { id: '5' })).toEqual({ ID: '5' })
    expect(rest).toHaveBeenCalledWith('crm.deal.get', 'A1', { id: '5' })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('нет ключа — no_token', async () => {
    const c = createB24Client({ rest: vi.fn(), store: memStore(), refresh: null, now: () => NOW })
    expect(await codeOf(c.call('u1', 'crm.deal.get'))).toBe('no_token')
  })

  it('ключ на исходе — продлевается и сохраняется', async () => {
    const store = memStore(fresh({ expiresAt: new Date(NOW + 30_000) }))
    const refresh = vi.fn(async () => ({ accessToken: 'A2', refreshToken: 'R2', expiresIn: 3600, userId: '7' }))
    const rest = vi.fn(async () => 'ok')
    const c = createB24Client({ rest, store, refresh, now: () => NOW })
    await c.call('u1', 'user.current')
    expect(refresh).toHaveBeenCalledWith('R1')
    expect(rest).toHaveBeenCalledWith('user.current', 'A2', undefined)
    expect(store.data.get('u1')).toMatchObject({ accessToken: 'A2', refreshToken: 'R2', bitrixUserId: '7' })
    expect(store.data.get('u1')!.expiresAt.getTime()).toBe(NOW + 3600_000)
  })

  it('несколько вызовов разом — одно продление', async () => {
    const store = memStore(fresh({ expiresAt: new Date(NOW - 1) }))
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const refresh = vi.fn(async () => { await gate; return { accessToken: 'A2', refreshToken: 'R2', expiresIn: 3600 } })
    const c = createB24Client({ rest: vi.fn(async () => 1), store, refresh, now: () => NOW })
    const calls = [c.call('u1', 'a'), c.call('u1', 'b'), c.call('u1', 'c')]
    await new Promise(r => setTimeout(r, 0))
    release()
    await Promise.all(calls)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('без client_secret истёкший ключ не продлить — token_expired', async () => {
    const c = createB24Client({ rest: vi.fn(), store: memStore(fresh({ expiresAt: new Date(NOW - 1) })), refresh: null, now: () => NOW })
    expect(await codeOf(c.call('u1', 'x'))).toBe('token_expired')
  })

  it('OAuth отказал — ключи стираются', async () => {
    const store = memStore(fresh({ expiresAt: new Date(NOW - 1) }))
    const refresh = vi.fn(async () => { throw new OAuthError('invalid_grant') })
    const c = createB24Client({ rest: vi.fn(), store, refresh, now: () => NOW })
    expect(await codeOf(c.call('u1', 'x'))).toBe('token_expired')
    expect(store.data.has('u1')).toBe(false)
  })

  it('сеть при продлении — portal_error, ключи остаются', async () => {
    const store = memStore(fresh({ expiresAt: new Date(NOW - 1) }))
    const refresh = vi.fn(async () => { throw new Error('ECONNRESET') })
    const c = createB24Client({ rest: vi.fn(), store, refresh, now: () => NOW })
    expect(await codeOf(c.call('u1', 'x'))).toBe('portal_error')
    expect(store.data.has('u1')).toBe(true)
  })

  it('продление выдало ключ другому сотруднику — не принимается', async () => {
    const store = memStore(fresh({ expiresAt: new Date(NOW - 1) }))
    const refresh = vi.fn(async () => ({ accessToken: 'A2', refreshToken: 'R2', expiresIn: 3600, userId: '99' }))
    const c = createB24Client({ rest: vi.fn(), store, refresh, now: () => NOW })
    expect(await codeOf(c.call('u1', 'x'))).toBe('token_expired')
    expect(store.data.has('u1')).toBe(false)
  })

  it('портал счёл ключ истёкшим раньше срока — продление и один повтор', async () => {
    const rest = vi.fn()
      .mockRejectedValueOnce(new BitrixRestError('x', 401, 'expired_token', ''))
      .mockResolvedValueOnce('ok')
    const refresh = vi.fn(async () => ({ accessToken: 'A2', refreshToken: 'R2', expiresIn: 3600 }))
    const c = createB24Client({ rest, store: memStore(fresh()), refresh, now: () => NOW })
    expect(await c.call('u1', 'x')).toBe('ok')
    expect(rest).toHaveBeenLastCalledWith('x', 'A2', undefined)
  })

  it('ошибки портала — по смыслу', async () => {
    const mk = (err: unknown) => createB24Client({ rest: vi.fn(async () => { throw err }), store: memStore(fresh()), refresh: null, now: () => NOW })
    expect(await codeOf(mk(new BitrixRestError('x', 403, 'ACCESS_DENIED', '')).call('u1', 'x'))).toBe('access_denied')
    expect(await codeOf(mk(new BitrixRestError('x', 400, 'NOT_FOUND', '')).call('u1', 'x'))).toBe('not_found')
    expect(await codeOf(mk(new BitrixRestError('x', 503, 'QUERY_LIMIT_EXCEEDED', '')).call('u1', 'x'))).toBe('portal_error')
    expect(await codeOf(mk(new Error('timeout')).call('u1', 'x'))).toBe('portal_error')
  })
})
