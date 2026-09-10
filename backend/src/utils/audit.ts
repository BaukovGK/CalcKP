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
  /** Выпуск КП — точка фиксации процесса (ТЗ §4.3 v1.5). */
  | 'estimate.kp'
  /** Выгрузка печатной формы КП (docx/pdf) — документ уходит заказчику. */
  | 'estimate.kp.export'
  | 'prices.update'
  | 'prices.import'
  /** Выгрузка прайса в xlsx (лист «НН» + «Проверка»). */
  | 'prices.export'
  | 'user.create'
  /** Смена роли, имени или активности пользователя. */
  | 'user.update'
  /** Пользователь сменил себе пароль. Сам пароль в meta не попадает. */
  | 'user.password_change'
  /** Дамп базы снят из админки. */
  | 'db.backup'
  /** Дамп выгружен наружу — вся база, включая хеши паролей. */
  | 'db.backup.download'
  /** Дамп загружен в каталог (ещё не применён). */
  | 'db.backup.upload'
  | 'db.backup.delete'
  /** База заменена содержимым дампа. Самая разрушительная операция. */
  | 'db.restore'
  /** Удаление проекта (только пустого — расчёты его удаление не переживают). */
  | 'project.delete'
  /** Выгрузка КП на проект целиком: документ по нескольким единицам сразу. */
  | 'project.kp.export'
  /** Выгрузка Заявки на закупку (ТЗ §9.6). */
  | 'purchase.export'
  /** Редактор шаблонов (TECHNOLOG): правки справочников материализации. */
  | 'template.nozzle_norm.upsert'
  | 'template.nozzle_norm.delete'
  | 'template.pipe_weight.upsert'
  | 'template.pipe_weight.delete'
  | 'template.engineering.upsert'
  /** Мс — масса формованных слоёв на стыке, f(Dу, PN). */
  | 'template.joint_layer.upsert'

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
