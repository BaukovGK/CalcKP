/**
 * Отбор записей журнала: что приходит с экрана администрирования, то и
 * превращается в условие выборки.
 *
 * Главное, что держат тесты: «по 17.09» включает весь день, раздел берётся
 * приставкой, а мусор в параметрах отвечает понятной причиной, а не 500.
 */
import { describe, expect, it } from 'vitest'
import { AUDIT_PAGE_DEFAULT, AUDIT_PAGE_MAX, auditWhere, parseAuditQuery } from './audit-query'

const ok = (input: Record<string, unknown>) => {
  const parsed = parseAuditQuery(input)
  if (!parsed.ok) throw new Error(`ожидался разбор, получено: ${parsed.message}`)
  return parsed.query
}

describe('разбор отбора', () => {
  it('пустой запрос — первая страница без условий', () => {
    const q = ok({})

    expect(q.limit).toBe(AUDIT_PAGE_DEFAULT)
    expect(q.offset).toBe(0)
    expect(auditWhere(q)).toEqual({})
  })

  it('период: «по 17.09» включает весь день', () => {
    const q = ok({ from: '2026-09-17', to: '2026-09-17' })
    const where = auditWhere(q) as { createdAt: { gte: Date; lte: Date } }

    expect(where.createdAt.gte.getHours()).toBe(0)
    expect(where.createdAt.lte.getHours()).toBe(23)
    expect(where.createdAt.lte.getMinutes()).toBe(59)
    // Иначе отбор за один день всегда возвращал бы пусто.
    expect(where.createdAt.lte.getTime()).toBeGreaterThan(where.createdAt.gte.getTime())
  })

  it('полный момент ISO тоже принимается', () => {
    const q = ok({ from: '2026-09-17T08:30:00.000Z' })
    expect(q.from?.toISOString()).toBe('2026-09-17T08:30:00.000Z')
  })

  it('перевёрнутый период и кривые даты — понятный отказ', () => {
    expect(parseAuditQuery({ from: 'вчера' })).toMatchObject({ ok: false })
    expect(parseAuditQuery({ from: '2026-09-18', to: '2026-09-17' })).toMatchObject({
      ok: false,
      message: 'Начало периода позже его конца',
    })
  })

  it('страница: потолок и отказ на мусоре', () => {
    expect(ok({ limit: '10', offset: '20' })).toMatchObject({ limit: 10, offset: 20 })
    expect(parseAuditQuery({ limit: String(AUDIT_PAGE_MAX + 1) })).toMatchObject({ ok: false })
    expect(parseAuditQuery({ limit: '-1' })).toMatchObject({ ok: false })
    expect(parseAuditQuery({ offset: '1.5' })).toMatchObject({ ok: false })
    // Нулевая страница бессмысленна — отдаём страницу по умолчанию.
    expect(ok({ limit: '0' }).limit).toBe(AUDIT_PAGE_DEFAULT)
  })
})

describe('условие выборки', () => {
  it('действие с точкой — точное, без точки — раздел целиком', () => {
    expect(auditWhere(ok({ action: 'estimate.kp' }))).toMatchObject({ action: 'estimate.kp' })
    expect(auditWhere(ok({ action: 'estimate' }))).toMatchObject({
      action: { startsWith: 'estimate.' },
    })
  })

  it('сотрудник и объект — точным совпадением', () => {
    expect(auditWhere(ok({ user: 'u1', entity: 'e2' }))).toMatchObject({
      userId: 'u1',
      entityId: 'e2',
    })
  })

  it('поиск идёт по действию, объекту, имени и почте сотрудника', () => {
    const where = auditWhere(ok({ q: 'иванов' })) as { OR: Array<Record<string, unknown>> }

    expect(where.OR).toHaveLength(4)
    expect(JSON.stringify(where.OR)).toContain('иванов')
    expect(JSON.stringify(where.OR)).toContain('insensitive')
  })

  it('пустые параметры условий не добавляют', () => {
    expect(auditWhere(ok({ user: '  ', action: '', q: '   ' }))).toEqual({})
  })
})
