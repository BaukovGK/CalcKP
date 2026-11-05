import { randomBytes } from 'node:crypto'

/**
 * Вход из вкладки Битрикс24 (ТЗ §10.3).
 *
 * Портал открывает приложение во фрейме POST-запросом на обработчик и
 * передаёт ключ текущего сотрудника (`AUTH_ID`, живёт час). Здесь — всё, что
 * не зависит от express и базы: проверка запуска, сопоставление с учёткой и
 * одноразовые коды обмена. Маршруты — `routes/bitrix.routes.ts`.
 *
 * Здесь ключ портала нужен узнать, кто пришёл; сессия в калькуляторе дальше
 * идёт на собственных токенах приложения. Для вызовов REST от имени
 * сотрудника (сделка, лента) ключ сохраняется в B24Token — utils/b24-client.ts.
 */

/** Настройки из окружения. null — вход из Битрикс24 выключен. */
export interface BitrixConfig {
  /** Адрес портала без протокола: `nttcrm.bitrix24.ru`. */
  portal: string
  /** `member_id` портала; пусто — не сверяется (узнаётся из первого запуска). */
  memberId?: string
  /** `client_id` локального приложения; пусто — не сверяется. */
  clientId?: string
  /**
   * `client_secret` приложения — продлевать ключи сотрудников без открытой
   * вкладки (utils/b24-client.ts). Пусто — ключ живёт час от открытия.
   */
  clientSecret?: string
}

export function bitrixConfig(env: NodeJS.ProcessEnv = process.env): BitrixConfig | null {
  const portal = env.BITRIX_PORTAL?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  if (!portal) return null
  return {
    portal,
    memberId: env.BITRIX_MEMBER_ID?.trim() || undefined,
    clientId: env.BITRIX_CLIENT_ID?.trim() || undefined,
    clientSecret: env.BITRIX_CLIENT_SECRET?.trim() || undefined,
  }
}

/** Что прислал портал при открытии приложения. */
export interface BitrixLaunch {
  domain?: string
  authId?: string
  memberId?: string
  /** Ключ продления (`REFRESH_ID`), 28 дней. */
  refreshId?: string
  /** Через сколько секунд истечёт `AUTH_ID` (`AUTH_EXPIRES`). */
  authExpires?: string
  /** Где открыто: `DEFAULT` — меню портала, `CRM_DEAL_DETAIL_TAB` — сделка. */
  placement?: string
  /** `PLACEMENT_OPTIONS` — JSON строкой, у вкладки сделки `{"ID":"123"}`. */
  placementOptions?: string
}

/** Встройка вкладки в карточку сделки (placement.bind). */
export const DEAL_TAB_PLACEMENT = 'CRM_DEAL_DETAIL_TAB'

/**
 * ID сделки, если приложение открыто во вкладке сделки, иначе null. Берётся
 * только число: дальше оно попадает в адрес экрана и в запросы к порталу.
 */
export function launchDealId(launch: Pick<BitrixLaunch, 'placement' | 'placementOptions'>): string | null {
  if (launch.placement !== DEAL_TAB_PLACEMENT || !launch.placementOptions) return null
  let opts: unknown
  try { opts = JSON.parse(launch.placementOptions) } catch { return null }
  const id = (opts as { ID?: unknown } | null)?.ID
  const s = typeof id === 'number' ? String(id) : typeof id === 'string' ? id.trim() : ''
  return /^[1-9]\d{0,17}$/.test(s) ? s : null
}

/** Ключи сотрудника из запуска — для B24Token. null — портал ключ не прислал. */
export interface LaunchTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
}

export function launchTokens(launch: BitrixLaunch, now = Date.now()): LaunchTokens | null {
  const accessToken = launch.authId?.trim()
  if (!accessToken) return null
  const sec = Number(launch.authExpires)
  // Портал обещает час; странное значение — считаем, что час.
  const ttl = Number.isFinite(sec) && sec > 0 && sec <= 86_400 ? sec : 3600
  return { accessToken, refreshToken: launch.refreshId?.trim() || null, expiresAt: new Date(now + ttl * 1000) }
}

/** Сотрудник портала, как его вернул `user.current`. */
export interface BitrixProfile {
  id: string
  email: string | null
  /** «Фамилия Имя Отчество» — для журнала и экрана отказа. */
  name: string
  active: boolean
}

/**
 * Вызов метода REST портала с ключом сотрудника. Ответ — поле `result`;
 * ошибка портала или сети — исключение.
 */
export type BitrixRest = (method: string, authId: string, params?: Record<string, unknown>) => Promise<unknown>

/** Ошибка портала с его кодом (`expired_token`, `ACCESS_DENIED`, …). */
export class BitrixRestError extends Error {
  constructor(readonly method: string, readonly status: number, readonly code: string, description: string) {
    super(`${method}: ${status} ${code} ${description}`.trim())
  }
}

/** Причина отказа — код для журнала и экрана `/bitrix`. */
export type BitrixDenial =
  | 'disabled'
  | 'bad_request'
  | 'wrong_portal'
  | 'wrong_app'
  | 'portal_error'
  | 'portal_inactive'
  /**
   * Портал не отдал почту сотрудника — у приложения права «Пользователи
   * (краткие)», `user_brief`: без почты привязать новую учётку не по чему.
   */
  | 'no_email'
  | 'no_account'
  | 'blocked'
  | 'email_taken'

export class BitrixAuthError extends Error {
  constructor(readonly code: BitrixDenial, message: string) {
    super(message)
  }
}

function sameHost(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** Битрикс отдаёт флаги то булевыми, то строками «Y»/«N». */
function truthy(v: unknown): boolean {
  return v === true || v === 'Y' || v === 'y' || v === 1 || v === '1'
}

function fullName(u: Record<string, unknown>): string {
  return [u.LAST_NAME, u.NAME, u.SECOND_NAME]
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .map(p => p.trim())
    .join(' ')
}

/**
 * Проверка запуска: тот ли портал, то ли приложение, кто сотрудник.
 *
 * Портал в запросе сверяется с настройкой, но REST вызывается всегда по
 * адресу из настройки, а не из запроса: ключ чужого портала наш портал не
 * примет, и подделать `DOMAIN` бесполезно.
 */
export async function verifyLaunch(launch: BitrixLaunch, cfg: BitrixConfig, rest: BitrixRest): Promise<BitrixProfile> {
  const authId = launch.authId?.trim()
  if (!authId) throw new BitrixAuthError('bad_request', 'Портал не передал ключ сотрудника (AUTH_ID)')
  if (!launch.domain || !sameHost(launch.domain, cfg.portal)) {
    throw new BitrixAuthError('wrong_portal', `Запуск не с портала ${cfg.portal}: ${launch.domain ?? 'адрес не передан'}`)
  }
  if (cfg.memberId && launch.memberId !== cfg.memberId) {
    throw new BitrixAuthError('wrong_portal', `member_id не совпадает с BITRIX_MEMBER_ID: ${launch.memberId ?? 'не передан'}`)
  }

  let app: unknown
  let me: unknown
  try {
    ;[app, me] = await Promise.all([
      cfg.clientId ? rest('app.info', authId) : Promise.resolve(null),
      rest('user.current', authId),
    ])
  } catch (e) {
    throw new BitrixAuthError('portal_error', `Портал не подтвердил ключ: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (cfg.clientId) {
    const a = (app ?? {}) as Record<string, unknown>
    // У локального приложения client_id приходит в CODE (`local.…`); CLIENT_ID —
    // на случай, если портал отдаст его отдельным полем.
    if (a.CLIENT_ID !== cfg.clientId && a.CODE !== cfg.clientId) {
      throw new BitrixAuthError('wrong_app', `Ключ выдан не приложению ${cfg.clientId}: ${String(a.CODE ?? a.CLIENT_ID ?? '?')}`)
    }
  }

  const u = (me ?? {}) as Record<string, unknown>
  const id = u.ID == null ? '' : String(u.ID).trim()
  if (!id) throw new BitrixAuthError('portal_error', 'Портал не вернул ID сотрудника')
  const email = typeof u.EMAIL === 'string' && u.EMAIL.trim() ? u.EMAIL.trim().toLowerCase() : null
  return { id, email, name: fullName(u) || email || `сотрудник №${id}`, active: u.ACTIVE === undefined ? true : truthy(u.ACTIVE) }
}

/** Учётка приложения — столько, сколько нужно для решения. */
export interface BitrixCandidate {
  id: string
  email: string
  isActive: boolean
  bitrixUserId: string | null
}

export type BitrixResolution<U extends BitrixCandidate> =
  | { kind: 'linked'; user: U }
  | { kind: 'link'; user: U }
  | { kind: 'denied'; code: Extract<BitrixDenial, 'portal_inactive' | 'no_email' | 'no_account' | 'blocked' | 'email_taken'> }

/**
 * Какая учётка у сотрудника портала.
 *
 * Сначала — по ID в портале. Нет такой — по почте, но только у учётки, ещё
 * не привязанной ни к кому: почту сотрудник может сменить в профиле, и
 * привязка по ней делается один раз. Учёток сами не заводим: роль назначает
 * администратор.
 */
export function resolveAccount<U extends BitrixCandidate>(
  profile: BitrixProfile,
  byBitrixId: U | null,
  byEmail: U | null,
): BitrixResolution<U> {
  if (!profile.active) return { kind: 'denied', code: 'portal_inactive' }
  if (byBitrixId) {
    return byBitrixId.isActive ? { kind: 'linked', user: byBitrixId } : { kind: 'denied', code: 'blocked' }
  }
  // Без почты «нет учётки» было бы неправдой: учётка может и быть, просто
  // сравнить не с чем — причина в правах приложения, а не у администратора.
  if (!profile.email) return { kind: 'denied', code: 'no_email' }
  if (!byEmail) return { kind: 'denied', code: 'no_account' }
  if (byEmail.bitrixUserId && byEmail.bitrixUserId !== profile.id) return { kind: 'denied', code: 'email_taken' }
  if (!byEmail.isActive) return { kind: 'denied', code: 'blocked' }
  return { kind: 'link', user: byEmail }
}

/**
 * Одноразовые коды: обработчик запуска отдаёт код в адресе `/bitrix?code=…`,
 * экран меняет его на токены. Токены в адрес не попадают, а код без обмена
 * через минуту бесполезен. Хранятся в памяти процесса — бэкенд один.
 */
export interface OneTimeCodes {
  issue(userId: string, now?: number): string
  /** Код погашается при первом же обращении — и удачном, и просроченном. */
  consume(code: string, now?: number): string | null
}

export function createOneTimeCodes(ttlMs = 60_000, maxCodes = 1000): OneTimeCodes {
  const codes = new Map<string, { userId: string; expires: number }>()
  return {
    issue(userId, now = Date.now()) {
      for (const [k, v] of codes) if (v.expires <= now) codes.delete(k)
      // Сверх предела — сначала самые старые: Map хранит порядок вставки.
      while (codes.size >= maxCodes) codes.delete(codes.keys().next().value as string)
      const code = randomBytes(24).toString('base64url')
      codes.set(code, { userId, expires: now + ttlMs })
      return code
    },
    consume(code, now = Date.now()) {
      const hit = codes.get(code)
      if (!hit) return null
      codes.delete(code)
      return hit.expires > now ? hit.userId : null
    },
  }
}

/**
 * REST портала через fetch. Ключ — в теле запроса, а не в адресе: адреса
 * оседают в журналах прокси. Тело — JSON: в нём едут и вложенные параметры
 * (фильтры, файлы base64).
 */
export function fetchBitrixRest(portal: string, timeoutMs = 15000): BitrixRest {
  return async (method, authId, params = {}) => {
    const res = await fetch(`https://${portal}/rest/${method}.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, auth: authId }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string; error_description?: string }
    if (!res.ok || body.error) {
      throw new BitrixRestError(method, res.status, body.error ?? '', body.error_description ?? '')
    }
    return body.result
  }
}
