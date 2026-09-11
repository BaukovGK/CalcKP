import { beforeAll, describe, expect, it } from 'vitest'
import { authenticate, AuthError, type AuthUser, type FindAuthUser } from './auth-check'
import { signAccess, signRefresh } from './jwt'

beforeAll(() => {
  process.env.JWT_SECRET = 'тестовый-секрет-длиной-не-меньше-32-символов'
})

/** Пользователи «БД» теста. */
function users(...list: AuthUser[]): FindAuthUser {
  return async (id) => list.find((u) => u.id === id) ?? null
}

describe('authenticate', () => {
  it('действующий токен доступа и активный пользователь — пропуск', async () => {
    const token = await signAccess({ userId: 'u1', role: 'ENGINEER' })
    await expect(authenticate(token, users({ id: 'u1', role: 'ENGINEER', isActive: true }))).resolves.toEqual({
      userId: 'u1',
      role: 'ENGINEER',
    })
  })

  // План_реализации §4.2 №3: роль бралась из токена, и её отзыв не действовал,
  // пока токен не истечёт (15 минут).
  it('роль — из БД, а не из токена', async () => {
    const token = await signAccess({ userId: 'u1', role: 'ADMIN' })
    const who = await authenticate(token, users({ id: 'u1', role: 'VIEWER', isActive: true }))
    expect(who.role).toBe('VIEWER')
  })

  it('заблокированный или удалённый пользователь — отказ сразу', async () => {
    const token = await signAccess({ userId: 'u1', role: 'ADMIN' })
    await expect(authenticate(token, users({ id: 'u1', role: 'ADMIN', isActive: false }))).rejects.toBeInstanceOf(AuthError)
    await expect(authenticate(token, users())).rejects.toBeInstanceOf(AuthError)
  })

  // §4.2 №2: refresh-токен в заголовке запроса больше не открывает API.
  it('refresh-токен вместо токена доступа — отказ', async () => {
    const token = await signRefresh({ userId: 'u1', role: 'ADMIN' })
    await expect(authenticate(token, users({ id: 'u1', role: 'ADMIN', isActive: true }))).rejects.toBeInstanceOf(AuthError)
  })

  it('мусор вместо токена — отказ, а не сбой', async () => {
    await expect(authenticate('не-токен', users())).rejects.toBeInstanceOf(AuthError)
  })

  it('сбой БД — не отказ по токену: ошибка уходит дальше', async () => {
    const token = await signAccess({ userId: 'u1', role: 'ADMIN' })
    const broken: FindAuthUser = async () => {
      throw new Error('БД недоступна')
    }
    const err = await authenticate(token, broken).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(AuthError)
  })
})
