import type { Request, RequestHandler } from 'express'

/**
 * Ограничение частоты запросов в памяти процесса (План_устранения, 2.2).
 *
 * Первый рубеж — nginx (`limit_req` на входе и обновлении токена), этот —
 * второй: он видит то, чего не видит nginx, — адрес почты, на который
 * подбирают пароль, с каких бы адресов ни шли попытки.
 *
 * Окно фиксированное: счётчик ключа живёт `windowMs` с первого запроса.
 * Экземпляр бэкенда один, поэтому памяти процесса достаточно; при нескольких
 * экземплярах лимит станет на каждый свой — nginx при этом держит общий.
 *
 * @module utils/rate-limit
 */

export interface LimiterOptions {
  windowMs: number
  /** Сколько попыток в окне допускается. */
  max: number
  /** Сколько ключей держать; сверх — сначала выметаются истёкшие, затем старые. */
  maxKeys?: number
}

export interface LimiterHit {
  allowed: boolean
  /** Через сколько секунд окно ключа закончится. */
  retryAfterS: number
}

export interface Limiter {
  /** Засчитать попытку и сказать, укладывается ли она в лимит. */
  hit(key: string, now?: number): LimiterHit
  /** Проверить, не засчитывая: лимит ключа уже исчерпан? */
  blocked(key: string, now?: number): LimiterHit
  /** Забыть ключ — например, после успешного входа. */
  reset(key: string): void
}

export function createLimiter(opts: LimiterOptions): Limiter {
  const { windowMs, max, maxKeys = 10_000 } = opts
  const entries = new Map<string, { count: number; resetAt: number }>()

  function sweep(now: number) {
    for (const [k, e] of entries) if (e.resetAt <= now) entries.delete(k)
    // Всё ещё тесно (ключи подделывают быстрее, чем они истекают) — уходят
    // самые старые: Map помнит порядок вставки.
    while (entries.size >= maxKeys) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  const retryAfter = (resetAt: number, now: number) => Math.max(1, Math.ceil((resetAt - now) / 1000))

  return {
    hit(key, now = Date.now()) {
      let e = entries.get(key)
      if (!e || e.resetAt <= now) {
        if (!e && entries.size >= maxKeys) sweep(now)
        e = { count: 0, resetAt: now + windowMs }
        entries.set(key, e)
      }
      e.count++
      return { allowed: e.count <= max, retryAfterS: retryAfter(e.resetAt, now) }
    },
    blocked(key, now = Date.now()) {
      const e = entries.get(key)
      if (!e || e.resetAt <= now) return { allowed: true, retryAfterS: 0 }
      return { allowed: e.count < max, retryAfterS: retryAfter(e.resetAt, now) }
    },
    reset(key) {
      entries.delete(key)
    },
  }
}

/** «через 12 мин» / «через 40 с» — для текста ответа 429. */
export function retryText(seconds: number): string {
  return seconds >= 60 ? `через ${Math.ceil(seconds / 60)} мин` : `через ${seconds} с`
}

/**
 * Middleware: не больше `max` запросов за окно с одного адреса. Адрес —
 * `req.ip`: за nginx его даёт `trust proxy` (app.ts).
 */
export function limitByIp(limiter: Limiter, message: string): RequestHandler {
  return (req: Request, res, next) => {
    const { allowed, retryAfterS } = limiter.hit(req.ip ?? 'unknown')
    if (allowed) { next(); return }
    res.setHeader('Retry-After', String(retryAfterS))
    res.status(429).json({ message: `${message} — повторите ${retryText(retryAfterS)}`, code: 'TOO_MANY_REQUESTS', retryAfterS })
  }
}
