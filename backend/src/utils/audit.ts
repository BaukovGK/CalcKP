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
  /** Вход в систему: кто и когда начал работу. */
  | 'auth.login'
  /**
   * Неудачная попытка входа — с почтой и причиной.
   *
   * Пишется без пользователя: на этом шаге его ещё нет (а при неверной почте
   * и не будет). Нужна не для статистики, а чтобы подбор пароля был виден
   * администратору: ограничение частоты (План_устранения 2.2) его тормозит,
   * но само по себе ничего не рассказывает.
   */
  | 'auth.login_failed'
  /** Выход на этом устройстве. */
  | 'auth.logout'
  | 'estimate.create'
  /**
   * Правка опросного листа — какие ответы изменились.
   *
   * Лист сохраняется часто (экран пишет его через полторы секунды после
   * правки), поэтому запись одна на сеанс правок: повторы в течение окна
   * дописываются к ней (`auditRepeating`). Сохранения дерева и цен сюда не
   * попадают — сравниваются только ответы листа (`utils/survey-diff.ts`).
   */
  | 'estimate.survey'
  /** Расчёт удалён — необратимо; в meta — название, тип, проект и итог. */
  | 'estimate.delete'
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
  /** Сотрудник поправил свои личные данные: ФИО, должность, телефон. */
  | 'user.profile'
  /** Администратор сбросил пароль пользователю — временный, со сменой при входе. */
  | 'user.password_reset'
  /** Пользователь вышел на всех устройствах — все его токены отозваны. */
  | 'user.logout_all'
  /** Дамп базы снят из админки. */
  | 'db.backup'
  /** Дамп выгружен наружу — вся база, включая хеши паролей. */
  | 'db.backup.download'
  /** Дамп загружен в каталог (ещё не применён). */
  | 'db.backup.upload'
  | 'db.backup.delete'
  /** База заменена содержимым дампа. Самая разрушительная операция. */
  | 'db.restore'
  | 'project.create'
  /** Правка карточки проекта: объект, заказчик, адрес, примечание. */
  | 'project.update'
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
  /**
   * Каталог узлов (редактор шаблонов, этап 2): новый узел, сохранение и
   * публикация черновика, откат к прежней версии, архив, отмена.
   */
  | 'template.node.create'
  /** Черновик узла сохранён — кнопкой, поэтому событие своё. */
  | 'template.node.draft'
  | 'template.node.publish'
  | 'template.node.activate'
  | 'template.node.archive'
  | 'template.node.discard'
  /** Шаблон изделия: черновик, публикация версии, откат, отмена черновика. */
  | 'template.product.draft'
  | 'template.product.publish'
  | 'template.product.activate'
  | 'template.product.discard'

/**
 * Частое событие — одной записью на сеанс.
 *
 * Правка опросного листа доходит до сервера несколько раз подряд: экран
 * сохраняет лист сам. Отдельная запись на каждое сохранение превратила бы
 * журнал в ленту «сохранено, сохранено, сохранено», где не видно остального.
 * Поэтому повтор того же события тем же сотрудником по тому же объекту в
 * течение окна дописывается к прежней записи: `merge` решает, что станет с её
 * подробностями, а время сдвигается на последнюю правку.
 *
 * Не бросает — как и `audit`: сбой журнала не отменяет уже сделанное.
 */
export async function auditRepeating(
  userId: string | null | undefined,
  action: AuditAction,
  entityType: string,
  entityId: string,
  meta: Record<string, unknown>,
  merge: (previous: Record<string, unknown>) => Record<string, unknown>,
  windowMs = 10 * 60 * 1000,
): Promise<void> {
  try {
    const since = new Date(Date.now() - windowMs)
    const previous = await prisma.auditLog.findFirst({
      where: { action, entityId, userId: userId ?? null, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    })
    if (!previous) {
      await audit(userId, action, entityType, entityId, meta as Prisma.InputJsonValue)
      return
    }
    const before = (previous.meta ?? {}) as Record<string, unknown>
    await prisma.auditLog.update({
      where: { id: previous.id },
      data: { meta: merge(before) as Prisma.InputJsonValue, createdAt: new Date() },
    })
  } catch (e) {
    logger.error('Не удалось дописать событие аудита', {
      action,
      entityId,
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

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
