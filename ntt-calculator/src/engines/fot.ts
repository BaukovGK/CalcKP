/**
 * ФОТ-спутники: производные строки операций (§9.3 ТЗ, Механика §6,
 * Библиотека §1.1).
 *
 * ФОТ — не третий список строк, а производная операции:
 *   чел.ч = ROUNDUP(масса_операции_кг × k; 0,1)
 * Независимый ввод запрещён, ручной override возможен.
 */

import { computeRow } from './row'
import { roundUpHours } from './rounding'
import type { EngineRow } from './types'

/** Коэффициенты трудоёмкости, чел.ч/кг (§9.3, Механика §13). */
export const FOT_K_MECH = 0.28 // механическая формовка
export const FOT_K_LAMIN = 0.56 // ламинирование
export const FOT_K_MANUAL = 1.0 // ручная формовка и особые случаи

/**
 * Коэффициент по наименованию операции — ЭВРИСТИКА-ДЕФОЛТ.
 *
 * Приоритет важен: сначала «мех», затем «ламин». Узел каталога может задать
 * `fotK` явно (особые ламинирования с k = 1.0), и явное значение выигрывает
 * (Механика §6).
 *
 * Прежняя реализация (`engines/cost.ts`) возвращала 0,28 для любого вхождения
 * «формов» — то есть и для «Ручная формовка», которой положено 1,0. Здесь это
 * исправлено: 0,28 даёт только «мех».
 */
export function fotCoeffByName(name: string): number {
  const n = name.toLowerCase()
  if (n.includes('мех')) return FOT_K_MECH
  if (n.includes('ламин')) return FOT_K_LAMIN
  return FOT_K_MANUAL
}

/** Эффективный коэффициент строки: явный из каталога, иначе эвристика. */
export function resolveFotK(operation: EngineRow): number {
  return operation.fotK ?? fotCoeffByName(operation.name)
}

/**
 * Трудоёмкость спутника от массы операции.
 *
 * Считается от ИТОГОВОГО qty родителя (после override), а не от qtyCalc
 * (Механика §6).
 */
export function fotHoursFromMass(massKg: number, k: number): number {
  return roundUpHours(massKg * k)
}

/**
 * Пересчитывает `qtyCalc` ФОТ-спутников от их родительских операций.
 *
 * Возвращает НОВЫЙ массив; входной не мутируется — движок чист от побочных
 * эффектов, в отличие от прежнего `recalcAuto`, который правил строки на месте.
 * Ручной override спутника (`qtyManual`) не трогается.
 */
export function recalcFotSatellites(
  rows: EngineRow[],
  opts: { sectionEnabled?: boolean; tirage?: number } = {},
): EngineRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]))

  return rows.map((row) => {
    if (row.kind !== 'ФОТ' || !row.parentId) return row

    const parent = byId.get(row.parentId)
    if (!parent) return row

    // Тираж к спутнику не применяем: он придёт из массы родителя, иначе
    // домножился бы дважды.
    const parentQty = computeRow(parent, { ...opts, tirage: 1 }).qty
    const k = row.fotK ?? resolveFotK(parent)

    return { ...row, qtyCalc: fotHoursFromMass(parentQty, k) }
  })
}
