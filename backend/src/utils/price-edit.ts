import type { PriceItem, PrismaClient } from '@prisma/client'
import { logger } from './logger'
import { createPriceVersion, lockPriceVersions, withPriceVersionRetry } from './price-version'

/**
 * Ручная правка позиции прайса — экран «Прайс», `PATCH /api/prices/:id`.
 *
 * Смена цены — такое же ценовое событие, как строка импорта: запись в
 * PriceHistory и новая версия прайса (решение Р3, План_устранения 1.2). По
 * версии расчёты узнают, что цены под ними сдвинулись. Правка одного
 * поставщика цену не меняет — ни истории, ни версии.
 *
 * @module utils/price-edit
 */

/** Что меняет правка: поля, которые экран прайса даёт править. */
export interface PriceEdit {
  priceRub?: number
  supplier?: string
}

/** Примечание к версии прайса: какую позицию поправили вручную. */
export function manualEditNote(item: Pick<PriceItem, 'name' | 'unit'>): string {
  return `Ручная правка цены: ${item.name}, ${item.unit}`
}

/** Правка меняет цену позиции. */
export function changesPrice(before: Pick<PriceItem, 'priceRub'>, edit: PriceEdit): boolean {
  return edit.priceRub != null && edit.priceRub !== before.priceRub
}

/** Итог правки: позиция до и после и новая версия прайса. */
export interface PriceEditResult {
  before: PriceItem
  item: PriceItem
  /** Номер новой версии прайса; `null` — цена не менялась. */
  version: number | null
}

/**
 * Применить правку одной транзакцией: позиция, история цены, версия прайса.
 *
 * Правки цен идут по одной — под той же блокировкой, что выдаёт номер
 * версии, — и позиция читается уже под ней: прежняя цена в истории — та,
 * что стояла в момент записи, даже когда позицию правят в двух вкладках
 * разом. Без блокировки обе правки прочитали бы одну «прежнюю» цену.
 *
 * @returns итог правки; `null` — позиции нет
 */
export function applyPriceEdit(
  prisma: Pick<PrismaClient, '$transaction'>,
  id: string,
  edit: PriceEdit,
  userId: string | null,
): Promise<PriceEditResult | null> {
  return withPriceVersionRetry(
    () =>
      prisma.$transaction(async (tx) => {
        await lockPriceVersions(tx)
        const before = await tx.priceItem.findUnique({ where: { id } })
        if (!before) return null
        const item = await tx.priceItem.update({ where: { id }, data: edit })
        if (!changesPrice(before, edit)) return { before, item, version: null }

        await tx.priceHistory.create({
          data: { priceItemId: id, oldPrice: before.priceRub, newPrice: edit.priceRub, changedById: userId },
        })
        const version = await createPriceVersion(tx, { note: manualEditNote(before), userId })
        return { before, item, version }
      }),
    (attempt) => logger.warn('Гонка за номер версии прайса при ручной правке, повтор', { priceItemId: id, attempt }),
  )
}
