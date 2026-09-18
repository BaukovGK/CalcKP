/**
 * Можно ли удалить проект вместе с его единицами оборудования.
 *
 * Прежде проект удалялся только пустым: `Estimate.projectId` объявлен
 * `ON DELETE SET NULL`, и удаление непустого проекта оставило бы расчёты без
 * заказчика, объекта и адреса — а они печатаются в КП. При этом окно
 * подтверждения на экране проектов спрашивало «Удалить проект со всеми
 * единицами оборудования?», и администратор, согласившись, получал голый 422.
 * Экран обещал ровно то, что сервер запрещал.
 *
 * Теперь проект удаляется вместе с единицами — по тем же правилам, что и
 * единица по отдельности (`DELETE /api/estimates/:id`): не удаляется
 * утверждённый расчёт и расчёт, по которому выпущено КП или зафиксирована
 * версия, — такие слепки подтверждают цену, ушедшую заказчику. Хоть одна
 * такая единица — и проект не удаляется целиком, а отказ называет её:
 * удалить полпроекта хуже, чем не удалить ничего.
 *
 * Слепок создания единицы удалению не мешает (`utils/snapshot-reason.ts`).
 *
 * @module utils/project-delete
 */

/** Статусы, в которых расчёт можно удалить — те же, что у единицы по отдельности. */
export const DELETABLE_STATUSES: readonly string[] = ['DRAFT', 'CALC', 'REJECTED']

/** Что о единице нужно, чтобы решить судьбу проекта. */
export interface UnitForDeletion {
  id: string
  title: string
  status: string
  /** Слепков, защищающих от удаления: выпуск КП и ручная фиксация. */
  protectedSnapshots: number
}

/** Единица, из-за которой проект не удаляется, и почему. */
export interface UnitBlock {
  id: string
  title: string
  reason: string
}

/** Почему эту единицу удалить нельзя; `null` — можно. */
export function unitDeletionBlock(unit: UnitForDeletion): string | null {
  if (!DELETABLE_STATUSES.includes(unit.status)) {
    return 'расчёт утверждён — такие не удаляются'
  }
  if (unit.protectedSnapshots > 0) {
    return unit.protectedSnapshots === 1
      ? 'выпущено КП или зафиксирована версия'
      : `выпущено КП или зафиксированы версии — ${unit.protectedSnapshots}`
  }
  return null
}

/** Единицы, которые не дают удалить проект. Пусто — удалять можно. */
export function projectDeletionBlocks(units: readonly UnitForDeletion[]): UnitBlock[] {
  const blocks: UnitBlock[] = []
  for (const unit of units) {
    const reason = unitDeletionBlock(unit)
    if (reason) blocks.push({ id: unit.id, title: unit.title, reason })
  }
  return blocks
}

/** Сколько единиц назвать в тексте отказа; остальные — числом. */
export const BLOCKS_IN_MESSAGE = 5

/** Текст отказа: какие единицы мешают и что с этим делать. */
export function projectDeletionMessage(blocks: readonly UnitBlock[]): string {
  const shown = blocks
    .slice(0, BLOCKS_IN_MESSAGE)
    .map((b) => `«${b.title}» — ${b.reason}`)
    .join('; ')
  const more = blocks.length > BLOCKS_IN_MESSAGE ? ` и ещё ${blocks.length - BLOCKS_IN_MESSAGE}` : ''
  return (
    `Проект не удалён: ${shown}${more}. ` +
    'По таким единицам заказчику ушла цена, и их история должна сохраниться. ' +
    'Остальные единицы можно удалить по одной на экране проекта.'
  )
}
