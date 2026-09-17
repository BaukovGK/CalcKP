/**
 * Отказ в выпуске КП: почему не выпустили и что чинить.
 *
 * Гейты выпуска (`backend/routes/estimates.routes.ts`, POST `/:id/kp`) —
 * строки без цены, отрицательные суммы, ставки не из прайса, несошедшийся
 * итог — отвечают 422 с кодом и, где это уместно, со списком строк. Прежде
 * экран расчёта показывал такой отказ тостом на несколько секунд: тост легко
 * пропустить, и выглядело это как «кнопка не работает» — КП не выпущено,
 * новой версии нет, а причина уже исчезла с экрана (жалоба 17.09.2026).
 *
 * Здесь отказ превращается в содержимое окна: текст сервера и список строк.
 *
 * @module utils/kp-gate
 */

/** Строка расчёта в списке отказа. */
export interface KpBlockRow {
  name: string
  unit?: string
}

/** Содержимое окна «КП не выпущено». */
export interface KpBlock {
  message: string
  rows: KpBlockRow[]
  /** Сколько строк не поместилось в список. */
  more: number
  /** Показывать ли кнопку «показать строки»: они помечены в таблице. */
  showRows: boolean
}

/** Сколько строк показываем списком: остальные — счётчиком. */
export const BLOCK_ROWS_SHOWN = 12

/** Коды отказа, у которых строки помечены в таблице расчёта фильтрами. */
const ROW_CODES = new Set(['ROWS_WITHOUT_PRICE', 'NEGATIVE_ROWS'])

export function blockOf(
  message: string,
  rows: readonly KpBlockRow[] = [],
  showRows = false,
): KpBlock {
  return {
    message,
    rows: rows.slice(0, BLOCK_ROWS_SHOWN),
    more: Math.max(0, rows.length - BLOCK_ROWS_SHOWN),
    showRows: showRows && rows.length > 0,
  }
}

/**
 * Отказ по строкам без цены — до обращения к серверу.
 *
 * Экран знает их сам (`missingPriceIds`), и незачем открывать окно выпуска,
 * чтобы сервер отказал тем же самым.
 */
export function missingPriceBlock(rows: readonly KpBlockRow[]): KpBlock {
  return blockOf(
    `Строк без цены: ${rows.length}. Их сумма равна нулю, то есть итог занижен — ` +
      'такой документ заказчику уходить не должен. Проставьте цены и повторите выпуск.',
    rows,
    true,
  )
}

/** Ответ сервера при отказе. */
export interface KpGateError {
  code?: string
  message?: string
  rows?: KpBlockRow[]
}

/**
 * Отказ сервера → окно. `null` — это не гейт (сеть, 500, истёкшая сессия):
 * такое остаётся тостом, потому что чинить в расчёте нечего.
 */
export function serverBlock(data: KpGateError | undefined | null): KpBlock | null {
  if (!data?.code) return null
  return blockOf(
    data.message ?? 'Выпустить КП не удалось',
    Array.isArray(data.rows) ? data.rows : [],
    ROW_CODES.has(data.code),
  )
}
