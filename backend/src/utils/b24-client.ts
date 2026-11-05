import { BitrixRestError, type BitrixRest } from './bitrix-auth'

/**
 * Вызовы REST Битрикс24 от имени сотрудника (doc/План_Б24_сделка.md).
 *
 * Ключ сотрудника портал присылает при каждом открытии приложения, он
 * хранится в B24Token. Истёк — продлевается на oauth.bitrix.info по
 * `refresh_token` и `client_secret` приложения; продление — одно на
 * сотрудника, даже если вызовов несколько разом. Без базы и сети: всё
 * внешнее передаётся при создании — так клиент проверяется тестами.
 */

export interface StoredToken {
  bitrixUserId: string
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
}

export interface TokenStore {
  get(userId: string): Promise<StoredToken | null>
  save(userId: string, token: StoredToken): Promise<void>
  remove(userId: string): Promise<void>
}

/** Ответ oauth.bitrix.info на продление. */
export interface RefreshedToken {
  accessToken: string
  refreshToken: string
  expiresIn: number
  memberId?: string
  userId?: string
}

export type RefreshFn = (refreshToken: string) => Promise<RefreshedToken>

/** Почему вызов от имени сотрудника не состоялся — для экрана и журнала. */
export type B24ClientErrorCode =
  /** Ключей нет: сотрудник ни разу не открывал калькулятор из портала. */
  | 'no_token'
  /** Ключ истёк, продлить нечем или портал отказал: открыть из портала заново. */
  | 'token_expired'
  /** Портал отказал в доступе: нет прав у сотрудника или у приложения. */
  | 'access_denied'
  /** Не найдено (сделка удалена или ID чужой). */
  | 'not_found'
  /** Сеть, лимит запросов, ошибка портала. */
  | 'portal_error'

export class B24ClientError extends Error {
  constructor(readonly code: B24ClientErrorCode, message: string) {
    super(message)
  }
}

/** Запас до конца жизни ключа: не начинать вызов с ключом на последней секунде. */
const EARLY_MS = 60_000

const EXPIRED = new Set(['expired_token', 'invalid_token', 'NO_AUTH_FOUND'])
const DENIED = new Set(['ACCESS_DENIED', 'insufficient_scope', 'INVALID_CREDENTIALS', 'authorization_error'])
const NOT_FOUND = new Set(['NOT_FOUND', 'ERROR_NOT_FOUND'])

export interface B24Client {
  /** Метод REST от имени учётки калькулятора `userId`. */
  call<T = unknown>(userId: string, method: string, params?: Record<string, unknown>): Promise<T>
}

export function createB24Client(opts: {
  rest: BitrixRest
  store: TokenStore
  /** null — client_secret не задан, продлевать нечем. */
  refresh: RefreshFn | null
  now?: () => number
}): B24Client {
  const now = opts.now ?? Date.now
  const inflight = new Map<string, Promise<StoredToken>>()

  async function renew(userId: string, current: StoredToken): Promise<StoredToken> {
    const pending = inflight.get(userId)
    if (pending) return pending
    const p = (async () => {
      if (!opts.refresh || !current.refreshToken) {
        throw new B24ClientError('token_expired', 'Ключ Битрикс24 истёк — откройте калькулятор из портала')
      }
      let r: RefreshedToken
      try {
        r = await opts.refresh(current.refreshToken)
      } catch (e) {
        // Отказ OAuth (ключ продления истёк или отозван) — ключи больше не годятся.
        if (e instanceof OAuthError) {
          await opts.store.remove(userId)
          throw new B24ClientError('token_expired', `Битрикс24 не продлил ключ (${e.code}) — откройте калькулятор из портала`)
        }
        throw new B24ClientError('portal_error', `Не удалось продлить ключ Битрикс24: ${errText(e)}`)
      }
      if (r.userId && r.userId !== current.bitrixUserId) {
        await opts.store.remove(userId)
        throw new B24ClientError('token_expired', 'Ключ Битрикс24 выдан другому сотруднику — откройте калькулятор из портала')
      }
      const next: StoredToken = {
        bitrixUserId: current.bitrixUserId,
        accessToken: r.accessToken,
        refreshToken: r.refreshToken,
        expiresAt: new Date(now() + r.expiresIn * 1000),
      }
      await opts.store.save(userId, next)
      return next
    })()
    inflight.set(userId, p)
    try { return await p } finally { inflight.delete(userId) }
  }

  return {
    async call<T>(userId: string, method: string, params?: Record<string, unknown>): Promise<T> {
      let token = await opts.store.get(userId)
      if (!token) throw new B24ClientError('no_token', 'Нет ключа Битрикс24 — откройте калькулятор из портала')
      if (token.expiresAt.getTime() - EARLY_MS <= now()) token = await renew(userId, token)

      for (let attempt = 0; ; attempt++) {
        try {
          return (await opts.rest(method, token.accessToken, params)) as T
        } catch (e) {
          if (e instanceof BitrixRestError) {
            // Портал счёл ключ истёкшим раньше срока — продлить и повторить один раз.
            if (EXPIRED.has(e.code) && attempt === 0) { token = await renew(userId, token); continue }
            if (EXPIRED.has(e.code)) throw new B24ClientError('token_expired', 'Ключ Битрикс24 не принят — откройте калькулятор из портала')
            if (DENIED.has(e.code) || e.status === 403) throw new B24ClientError('access_denied', `Битрикс24 отказал в доступе (${method}: ${e.code})`)
            if (NOT_FOUND.has(e.code) || e.status === 404) throw new B24ClientError('not_found', `Битрикс24: не найдено (${method})`)
          }
          throw new B24ClientError('portal_error', `Битрикс24 не ответил (${method}): ${errText(e)}`)
        }
      }
    },
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Отказ сервера OAuth (`invalid_grant`, `invalid_client`, …). */
export class OAuthError extends Error {
  constructor(readonly code: string) {
    super(`OAuth: ${code}`)
  }
}

/**
 * Продление на oauth.bitrix.info. Секрет и ключ — в теле POST, не в адресе:
 * адреса оседают в журналах.
 */
export function fetchOAuthRefresh(clientId: string, clientSecret: string, timeoutMs = 15000): RefreshFn {
  return async refreshToken => {
    const res = await fetch('https://oauth.bitrix.info/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const b = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (typeof b.error === 'string') throw new OAuthError(b.error)
    if (!res.ok || typeof b.access_token !== 'string' || typeof b.refresh_token !== 'string') {
      throw new Error(`oauth.bitrix.info: ${res.status}`)
    }
    const expiresIn = Number(b.expires_in)
    return {
      accessToken: b.access_token,
      refreshToken: b.refresh_token,
      expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600,
      memberId: typeof b.member_id === 'string' ? b.member_id : undefined,
      userId: b.user_id == null ? undefined : String(b.user_id),
    }
  }
}
