/**
 * Отбор записей журнала действий — разбор параметров и условие для базы.
 *
 * Журнал отдавался одним куском: последние 200 записей без отбора. За день
 * работы отдела столько набирается само, и ответ «кто и когда менял этот
 * проект» приходилось искать глазами. Здесь — отбор по сотруднику, разделу,
 * объекту, периоду и поиску, плюс постраничная выдача.
 *
 * Модуль чистый: маршрут (`routes/admin.routes.ts`, `GET /audit`) отдаёт сюда
 * `req.query` и получает готовое условие Prisma — поэтому правила отбора
 * проверяются тестами без базы.
 *
 * @module utils/audit-query
 */

import type { Prisma } from '@prisma/client'

/** Сколько записей отдаём, если страница не задана. */
export const AUDIT_PAGE_DEFAULT = 50
/** Потолок страницы: больше — это выгрузка, а не просмотр. */
export const AUDIT_PAGE_MAX = 200

export interface AuditQuery {
  /** Сотрудник — id учётной записи. */
  userId?: string
  /**
   * Действие: с точкой — точное («estimate.kp»), без — раздел целиком
   * («estimate» берёт и `estimate.create`, и `estimate.kp.export`).
   */
  action?: string
  /** Объект: id расчёта, проекта, пользователя — как он записан в журнале. */
  entityId?: string
  /** Период: с начала `from` по конец `to` включительно. */
  from?: Date
  to?: Date
  /** Поиск по действию, объекту и имени с почтой сотрудника. */
  q?: string
  limit: number
  offset: number
}

/** Разобранный отбор либо понятная причина отказа. */
export type ParsedAuditQuery = { ok: true; query: AuditQuery } | { ok: false; message: string }

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Дата из параметра: и «2026-09-17», и полный ISO-момент.
 *
 * Для `to` день берётся целиком: «по 17.09» значит «включая весь 17-е», иначе
 * отбор за один день всегда возвращал бы пусто.
 *
 * День без времени считается по часам СЕРВЕРА, а не по UTC: «2026-09-17» без
 * времени JavaScript разбирает как полночь UTC, и у московского пользователя
 * день начинался бы в три часа ночи. Экран отбора шлёт полный момент
 * (`api/admin.ts`), поэтому это запасной путь — для запросов руками.
 */
function date(value: unknown, endOfDay = false): Date | 'bad' | undefined {
  const raw = text(value)
  if (raw === undefined) return undefined
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw)
  const parsed = new Date(dateOnly ? `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}` : raw)
  return Number.isNaN(parsed.getTime()) ? 'bad' : parsed
}

function count(value: unknown, fallback: number, max: number): number | 'bad' {
  const raw = text(value)
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0 || n > max) return 'bad'
  return n
}

/** Разобрать параметры запроса журнала. */
export function parseAuditQuery(input: Record<string, unknown>): ParsedAuditQuery {
  const from = date(input.from)
  const to = date(input.to, true)
  if (from === 'bad' || to === 'bad') {
    return { ok: false, message: 'Даты периода задаются как 2026-09-17 или полным моментом ISO' }
  }
  if (from && to && from > to) {
    return { ok: false, message: 'Начало периода позже его конца' }
  }

  const limit = count(input.limit, AUDIT_PAGE_DEFAULT, AUDIT_PAGE_MAX)
  const offset = count(input.offset, 0, Number.MAX_SAFE_INTEGER)
  if (limit === 'bad') {
    return { ok: false, message: `limit — целое число от 0 до ${AUDIT_PAGE_MAX}` }
  }
  if (offset === 'bad') return { ok: false, message: 'offset — целое число ≥ 0' }

  return {
    ok: true,
    query: {
      userId: text(input.user),
      action: text(input.action),
      entityId: text(input.entity),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      q: text(input.q),
      limit: limit === 0 ? AUDIT_PAGE_DEFAULT : limit,
      offset,
    },
  }
}

/**
 * Условие выборки по разобранному отбору.
 *
 * Поиск идёт по действию, объекту и по имени с почтой сотрудника; содержимое
 * `meta` не ищется — это Json, и разные события кладут в него разное.
 */
export function auditWhere(q: AuditQuery): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {}

  if (q.userId) where.userId = q.userId
  if (q.entityId) where.entityId = q.entityId
  if (q.action) {
    where.action = q.action.includes('.') ? q.action : { startsWith: `${q.action}.` }
  }
  if (q.from || q.to) {
    where.createdAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) }
  }
  if (q.q) {
    const contains = q.q
    where.OR = [
      { action: { contains, mode: 'insensitive' } },
      { entityId: { contains, mode: 'insensitive' } },
      { user: { name: { contains, mode: 'insensitive' } } },
      { user: { email: { contains, mode: 'insensitive' } } },
    ]
  }
  return where
}
