import { beforeAll, describe, expect, it } from 'vitest'
import { SignJWT } from 'jose'
import { signAccess, signRefresh, TOKEN_AUDIENCE, TOKEN_ISSUER, verifyAccess, verifyRefresh } from './jwt'

const SECRET = 'тестовый-секрет-длиной-не-меньше-32-символов'
const claims = { userId: 'u1', role: 'ENGINEER' }

beforeAll(() => {
  process.env.JWT_SECRET = SECRET
})

/** Токен в обход signAccess/signRefresh — как чужой или выпущенный до 11.09.2026. */
function rawToken(payload: Record<string, unknown>, expires: string, secret = SECRET, extra?: (t: SignJWT) => SignJWT) {
  const t = new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(expires)
  return (extra ? extra(t) : t).sign(new TextEncoder().encode(secret))
}

// План_реализации §4.2 №2: access- и refresh-токены были неразличимы — первый
// проходил /auth/refresh, второй — requireAuth.
describe('тип токена', () => {
  it('access-токен — только для доступа', async () => {
    const t = await signAccess(claims)
    await expect(verifyAccess(t)).resolves.toMatchObject({ userId: 'u1', role: 'ENGINEER', typ: 'access' })
    await expect(verifyRefresh(t)).rejects.toThrow()
  })

  it('refresh-токен — только для обновления', async () => {
    const t = await signRefresh(claims)
    await expect(verifyRefresh(t)).resolves.toMatchObject({ userId: 'u1', typ: 'refresh' })
    await expect(verifyAccess(t)).rejects.toThrow()
  })

  it('токен несёт издателя, аудиторию и уникальный jti', async () => {
    const [a, b] = await Promise.all([verifyAccess(await signAccess(claims)), verifyAccess(await signAccess(claims))])
    expect(a.iss).toBe(TOKEN_ISSUER)
    expect(a.aud).toBe(TOKEN_AUDIENCE)
    expect(a.jti).toBeTruthy()
    expect(a.jti).not.toBe(b.jti)
  })
})

describe('чужие и подделанные токены', () => {
  it('другой секрет — отказ', async () => {
    const t = await rawToken({ ...claims, typ: 'access' }, '15m', 'другой-секрет-длиной-не-меньше-32-символов', (x) =>
      x.setIssuer(TOKEN_ISSUER).setAudience(TOKEN_AUDIENCE),
    )
    await expect(verifyAccess(t)).rejects.toThrow()
  })

  it('чужой издатель или аудитория — отказ', async () => {
    const foreignIss = await rawToken({ ...claims, typ: 'access' }, '15m', SECRET, (x) => x.setIssuer('other').setAudience(TOKEN_AUDIENCE))
    const foreignAud = await rawToken({ ...claims, typ: 'access' }, '15m', SECRET, (x) => x.setIssuer(TOKEN_ISSUER).setAudience('other'))
    await expect(verifyAccess(foreignIss)).rejects.toThrow()
    await expect(verifyAccess(foreignAud)).rejects.toThrow()
  })

  it('неизвестный тип и токен без пользователя — отказ', async () => {
    const odd = await rawToken({ ...claims, typ: 'service' }, '15m', SECRET, (x) => x.setIssuer(TOKEN_ISSUER).setAudience(TOKEN_AUDIENCE))
    const anonymous = await rawToken({ role: 'ADMIN', typ: 'access' }, '15m', SECRET, (x) => x.setIssuer(TOKEN_ISSUER).setAudience(TOKEN_AUDIENCE))
    await expect(verifyAccess(odd)).rejects.toThrow()
    await expect(verifyRefresh(odd)).rejects.toThrow()
    await expect(verifyAccess(anonymous)).rejects.toThrow()
  })

  it('истёкший токен — отказ', async () => {
    const past = Math.floor(Date.now() / 1000) - 10
    const t = await new SignJWT({ ...claims, typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(TOKEN_ISSUER)
      .setAudience(TOKEN_AUDIENCE)
      .setIssuedAt(past - 900)
      .setExpirationTime(past)
      .sign(new TextEncoder().encode(SECRET))
    await expect(verifyAccess(t)).rejects.toThrow()
  })
})

// Выданные до 11.09.2026 сессии не обрываются при выкладке: тип такого
// токена читается по сроку жизни — access 15 минут, refresh 7 дней.
describe('токены, выпущенные до типизации', () => {
  it('короткоживущий — access, и только он', async () => {
    const t = await rawToken(claims, '15m')
    await expect(verifyAccess(t)).resolves.toMatchObject({ userId: 'u1' })
    await expect(verifyRefresh(t)).rejects.toThrow()
  })

  it('долгоживущий — refresh, и только он', async () => {
    const t = await rawToken(claims, '7d')
    await expect(verifyRefresh(t)).resolves.toMatchObject({ userId: 'u1' })
    await expect(verifyAccess(t)).rejects.toThrow()
  })
})
