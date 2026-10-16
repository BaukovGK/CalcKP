/**
 * Вход из Битрикс24 (ТЗ §10.3): чужой портал и чужое приложение не проходят,
 * учётка находится по ID в портале, по почте — только непривязанная, коды
 * обмена одноразовые и короткие.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  bitrixConfig, BitrixAuthError, createOneTimeCodes, resolveAccount, verifyLaunch,
  type BitrixCandidate, type BitrixProfile, type BitrixRest,
} from './bitrix-auth'

const cfg = { portal: 'nttcrm.bitrix24.ru' }
const launch = { domain: 'nttcrm.bitrix24.ru', authId: 'key', memberId: 'm1' }
const me = { ID: '17', EMAIL: 'Ivanov@NTT.su', LAST_NAME: 'Иванов', NAME: 'Сергей', SECOND_NAME: 'Владимирович', ACTIVE: true }

function restWith(answers: Record<string, unknown>): BitrixRest & ReturnType<typeof vi.fn> {
  return vi.fn(async (method: string) => {
    if (!(method in answers)) throw new Error(`неожиданный вызов ${method}`)
    const a = answers[method]
    if (a instanceof Error) throw a
    return a
  }) as never
}

async function denial(p: Promise<unknown>): Promise<string> {
  try { await p } catch (e) { if (e instanceof BitrixAuthError) return e.code; throw e }
  return 'пропущен'
}

describe('настройки', () => {
  it('без BITRIX_PORTAL вход выключен', () => {
    expect(bitrixConfig({})).toBeNull()
    expect(bitrixConfig({ BITRIX_PORTAL: '  ' })).toBeNull()
  })

  it('адрес портала — без протокола и косой черты, пустые сверки опущены', () => {
    expect(bitrixConfig({ BITRIX_PORTAL: 'https://NttCrm.bitrix24.ru/', BITRIX_MEMBER_ID: '', BITRIX_CLIENT_ID: ' local.1 ' }))
      .toEqual({ portal: 'nttcrm.bitrix24.ru', memberId: undefined, clientId: 'local.1' })
  })
})

describe('проверка запуска', () => {
  it('сотрудник нашего портала — профиль из user.current', async () => {
    const rest = restWith({ 'user.current': me })
    await expect(verifyLaunch(launch, cfg, rest)).resolves.toEqual({
      id: '17', email: 'ivanov@ntt.su', name: 'Иванов Сергей Владимирович', active: true,
    })
    expect(rest).toHaveBeenCalledWith('user.current', 'key')
  })

  it('без ключа — отказ, портал не спрашиваем', async () => {
    const rest = restWith({})
    expect(await denial(verifyLaunch({ ...launch, authId: '' }, cfg, rest))).toBe('bad_request')
    expect(rest).not.toHaveBeenCalled()
  })

  it('запуск с другого портала — отказ до обращения к порталу', async () => {
    const rest = restWith({ 'user.current': me })
    expect(await denial(verifyLaunch({ ...launch, domain: 'evil.bitrix24.ru' }, cfg, rest))).toBe('wrong_portal')
    expect(await denial(verifyLaunch({ ...launch, domain: undefined }, cfg, rest))).toBe('wrong_portal')
    expect(rest).not.toHaveBeenCalled()
  })

  it('адрес портала сверяется без учёта регистра', async () => {
    await expect(verifyLaunch({ ...launch, domain: 'NTTCRM.bitrix24.ru' }, cfg, restWith({ 'user.current': me }))).resolves.toBeTruthy()
  })

  it('member_id сверяется, когда задан', async () => {
    const rest = restWith({ 'user.current': me })
    expect(await denial(verifyLaunch({ ...launch, memberId: 'm2' }, { ...cfg, memberId: 'm1' }, rest))).toBe('wrong_portal')
    await expect(verifyLaunch(launch, { ...cfg, memberId: 'm1' }, rest)).resolves.toBeTruthy()
  })

  it('ключ чужого приложения — отказ, когда задан client_id', async () => {
    const own = { ...cfg, clientId: 'local.abc.123' }
    expect(await denial(verifyLaunch(launch, own, restWith({ 'app.info': { CODE: 'local.other.1' }, 'user.current': me })))).toBe('wrong_app')
    await expect(verifyLaunch(launch, own, restWith({ 'app.info': { CODE: 'local.abc.123' }, 'user.current': me }))).resolves.toBeTruthy()
    await expect(verifyLaunch(launch, own, restWith({ 'app.info': { CLIENT_ID: 'local.abc.123' }, 'user.current': me }))).resolves.toBeTruthy()
  })

  it('портал отверг ключ или недоступен — отказ', async () => {
    expect(await denial(verifyLaunch(launch, cfg, restWith({ 'user.current': new Error('401 invalid_token') })))).toBe('portal_error')
    expect(await denial(verifyLaunch(launch, cfg, restWith({ 'user.current': {} })))).toBe('portal_error')
  })

  it('уволенный в портале — неактивен; флаг приходит и строкой', async () => {
    const p = await verifyLaunch(launch, cfg, restWith({ 'user.current': { ...me, ACTIVE: 'N' } }))
    expect(p.active).toBe(false)
  })

  it('без почты и ФИО — имя по номеру', async () => {
    const p = await verifyLaunch(launch, cfg, restWith({ 'user.current': { ID: 5 } }))
    expect(p).toEqual({ id: '5', email: null, name: 'сотрудник №5', active: true })
  })
})

describe('какая учётка', () => {
  const profile: BitrixProfile = { id: '17', email: 'ivanov@ntt.su', name: 'Иванов', active: true }
  const acc = (over: Partial<BitrixCandidate> = {}): BitrixCandidate =>
    ({ id: 'u1', email: 'ivanov@ntt.su', isActive: true, bitrixUserId: null, ...over })

  it('привязанная — по ID портала', () => {
    expect(resolveAccount(profile, acc({ bitrixUserId: '17' }), null)).toMatchObject({ kind: 'linked' })
  })

  it('не привязанная, почта совпала — привязать', () => {
    expect(resolveAccount(profile, null, acc())).toMatchObject({ kind: 'link', user: { id: 'u1' } })
  })

  it('учётки нет — отказ, сами не заводим', () => {
    expect(resolveAccount(profile, null, null)).toEqual({ kind: 'denied', code: 'no_account' })
  })

  it('почта совпала, но учётка привязана к другому сотруднику — отказ', () => {
    // Сменил почту в профиле портала на чужую — в чужую учётку не попадёт.
    expect(resolveAccount(profile, null, acc({ bitrixUserId: '99' }))).toEqual({ kind: 'denied', code: 'email_taken' })
  })

  it('заблокированная учётка — отказ, и привязанная, и по почте', () => {
    expect(resolveAccount(profile, acc({ bitrixUserId: '17', isActive: false }), null)).toEqual({ kind: 'denied', code: 'blocked' })
    expect(resolveAccount(profile, null, acc({ isActive: false }))).toEqual({ kind: 'denied', code: 'blocked' })
  })

  it('уволенный в портале — отказ, даже с привязанной учёткой', () => {
    expect(resolveAccount({ ...profile, active: false }, acc({ bitrixUserId: '17' }), null)).toEqual({ kind: 'denied', code: 'portal_inactive' })
  })
})

describe('одноразовые коды', () => {
  it('код погашается первым же обменом', () => {
    const codes = createOneTimeCodes(60_000)
    const c = codes.issue('u1', 0)
    expect(codes.consume(c, 1000)).toBe('u1')
    expect(codes.consume(c, 1000)).toBeNull()
  })

  it('просроченный не принимается', () => {
    const codes = createOneTimeCodes(60_000)
    const c = codes.issue('u1', 0)
    expect(codes.consume(c, 60_000)).toBeNull()
  })

  it('чужой код — нет', () => {
    expect(createOneTimeCodes().consume('придуманный')).toBeNull()
  })

  it('сверх предела вытесняются самые старые', () => {
    const codes = createOneTimeCodes(60_000, 2)
    const a = codes.issue('a', 0)
    const b = codes.issue('b', 0)
    const c = codes.issue('c', 0)
    expect(codes.consume(a, 1)).toBeNull()
    expect(codes.consume(b, 1)).toBe('b')
    expect(codes.consume(c, 1)).toBe('c')
  })

  it('коды разные и не угадываются по порядку', () => {
    const codes = createOneTimeCodes()
    const set = new Set(Array.from({ length: 50 }, () => codes.issue('u1')))
    expect(set.size).toBe(50)
    for (const c of set) expect(c.length).toBeGreaterThanOrEqual(32)
  })
})
