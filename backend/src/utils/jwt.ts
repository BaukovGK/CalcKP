import { randomUUID } from 'node:crypto'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

const encoder = new TextEncoder()

function getSecret() {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET is not set')
  return encoder.encode(s)
}

/** Издатель и аудитория токенов: токен с тем же секретом, но не отсюда, не пройдёт. */
export const TOKEN_ISSUER = 'ntt-calculator'
export const TOKEN_AUDIENCE = 'ntt-calculator-api'

/**
 * Тип токена. Прежде access и refresh различались только сроком жизни:
 * access-токен проходил `/auth/refresh`, refresh-токен — `requireAuth`
 * (План_реализации §4.2 №2). Теперь тип вписан в токен и проверяется.
 */
export type TokenType = 'access' | 'refresh'

export interface TokenPayload extends JWTPayload {
  userId: string
  role: string
  typ?: TokenType
}

type Claims = Pick<TokenPayload, 'userId' | 'role'>

function sign(claims: Claims, typ: TokenType, expires: string) {
  return new SignJWT({ userId: claims.userId, role: claims.role, typ })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    // jti — задел под отзыв токенов (blacklist при выходе и смене пароля).
    .setJti(randomUUID())
    .setExpirationTime(expires)
    .sign(getSecret())
}

export function signAccess(claims: Claims) {
  return sign(claims, 'access', process.env.JWT_ACCESS_EXPIRES ?? '15m')
}

export function signRefresh(claims: Claims) {
  return sign(claims, 'refresh', process.env.JWT_REFRESH_EXPIRES ?? '7d')
}

/**
 * Токены, выпущенные до 11.09.2026, типа не несут — ни `typ`, ни издателя с
 * аудиторией. Их тип читается по сроку жизни: access живёт 15 минут,
 * refresh — 7 дней; порог — час. Так выданные сессии не обрываются при
 * выкладке, а подмена одного токена другим уже не проходит. Последние такие
 * токены истекут к 18.09.2026 — после этого ветку можно удалить.
 */
const LEGACY_ACCESS_MAX_S = 60 * 60

function tokenType(p: TokenPayload): TokenType | null {
  if (p.typ === 'access' || p.typ === 'refresh') return p.typ
  if (p.typ !== undefined) return null
  if (typeof p.iat !== 'number' || typeof p.exp !== 'number') return null
  return p.exp - p.iat <= LEGACY_ACCESS_MAX_S ? 'access' : 'refresh'
}

function audienceIncludes(aud: JWTPayload['aud'], expected: string): boolean {
  return Array.isArray(aud) ? aud.includes(expected) : aud === expected
}

async function verifyAs(token: string, expected: TokenType): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
  const p = payload as TokenPayload
  // Типизированный токен обязан быть своим: издатель и аудитория — наши.
  if (p.typ !== undefined && (p.iss !== TOKEN_ISSUER || !audienceIncludes(p.aud, TOKEN_AUDIENCE))) {
    throw new Error('Токен выпущен не этим сервером')
  }
  if (tokenType(p) !== expected) throw new Error(`Нужен ${expected}-токен`)
  if (typeof p.userId !== 'string' || p.userId === '') throw new Error('В токене нет пользователя')
  return p
}

/** Токен доступа к API; refresh-токен не проходит. */
export function verifyAccess(token: string): Promise<TokenPayload> {
  return verifyAs(token, 'access')
}

/** Токен обновления доступа; access-токен не проходит. */
export function verifyRefresh(token: string): Promise<TokenPayload> {
  return verifyAs(token, 'refresh')
}
