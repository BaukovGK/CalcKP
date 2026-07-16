import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { logger } from './logger'

/**
 * Запись события в AuditLog (ТЗ §7).
 *
 * До этого момента `prisma.auditLog` встречался в коде ровно один раз — на
 * чтение в `GET /api/admin/audit`, поэтому аудит всегда возвращал пустой
 * список.
 *
 * Аудит НЕ должен ронять основную операцию: если запись события не удалась,
 * логируем и продолжаем — иначе сбой журнала отменил бы уже совершённое
 * действие. Поэтому функция никогда не бросает.
 */
export type AuditAction =
  | 'estimate.create'
  | 'estimate.status_change'
  | 'estimate.snapshot'
  | 'prices.update'
  | 'prices.import'
  | 'user.create'

export async function audit(
  userId: string | null | undefined,
  action: AuditAction,
  entityType?: string,
  entityId?: string,
  meta?: Prisma.InputJsonValue,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId ?? null,
        action,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        meta: meta ?? undefined,
      },
    })
  } catch (e) {
    logger.error('Не удалось записать событие аудита', {
      action,
      entityType,
      entityId,
      error: e instanceof Error ? e.message : String(e),
    })
  }
}
