/**
 * Пересчёт цен расчёта по действующей версии прайса (Механика §5.2).
 *
 * Материализация фиксирует применённую цену: `priceCatalog` пишется при
 * вставке строки и хранится в дереве вместе с версией прайса. После импорта
 * нового прайса старый расчёт продолжал показывать прежние цены и ничего об
 * этом не говорил — КП выпускался по устаревшей себестоимости. Новую версию
 * прайса создаёт и ручная правка цены (План_устранения, 1.2).
 *
 * Пересчёт — явное действие инженера: цена каждой строки берётся заново по той
 * же тройке (категория, наименование, ЕИ), что и при материализации, а
 * прежняя запоминается в `priceCatalogPrev`. Это отметка «было → стало»: её
 * принимают (новая цена остаётся) или отклоняют — прежняя цена становится
 * ручной.
 *
 * Не трогаются:
 *  - договорная труба — корпуса, шахты, горловины: шаблон намеренно не берёт
 *    её цену из прайса, она живёт в поле ОЛ (`priceBinding`);
 *  - строки, которых в новом прайсе нет: прежняя цена остаётся, а строка
 *    попадает в сводку. Молча обнулить цену значило бы сделать строку
 *    «красной» и заблокировать КП без объяснения.
 *
 * Ручная цена (`priceManual`) остаётся ручной, применённая цена у такой
 * строки не меняется, но отметка ставится: инженер видит, что прайс под его
 * цифрой сдвинулся.
 *
 * ФОТ-спутники обновляются без отметки: их цена — ставка ФОТ, одна на все, и
 * её сдвиг показывает сводка, а не десятки одинаковых отметок.
 *
 * Ставки экономики дерева (`CalcTree.rates`: ФОТ, накладные, ацетон, СИЗ)
 * пересчёт берёт из того же прайса и показывает сдвиг каждой — ПЗР и
 * ФОТ-спутники считаются по одной ставке (План_устранения, 1.3).
 *
 * @module engines/reprice
 */

import { RATE_KEYS, ratesFromPrices, type RateKey, type TreeRates } from './economics'
import type { CalcRowNode, CalcTree } from './template-kns'
import type { EngineRow } from './types'

/** Цена позиции прайса по тройке; `null` — позиции нет. */
export type PriceLookup = (category: string, name: string, unit: string) => number | null

/** Что изменил пересчёт. */
export interface RepriceSummary {
  /** Строки, у которых сменилась цена прайса (без ФОТ-спутников). */
  changed: number
  /** Из них с ручной ценой: применённая цена у них прежняя. */
  changedUnderManual: number
  /** Строки с ценой, позиции которых в новом прайсе нет: цена оставлена прежней. */
  notFound: number
  /** Ставка ФОТ у ФОТ-спутников до и после, если сдвинулась. */
  fotRate: { from: number | null; to: number } | null
  /**
   * Ставки экономики дерева, которые сдвинутся: значение или источник
   * (прайс либо константа кода). У дерева без ставок — пусто: оно и так
   * считается по действующему прайсу.
   */
  rateShifts: RateShift[]
}

/** Сдвиг одной ставки экономики при пересчёте. */
export interface RateShift {
  key: RateKey
  from: number
  to: number
  /** До пересчёта ставка была константой кода: позиции не было в прайсе. */
  fromFallback: boolean
  /** После пересчёта — константа: позиции нет в прайсе. */
  toFallback: boolean
}

/** Какие ставки дерева сдвинутся, если взять `next`. */
export function rateShifts(prev: TreeRates | undefined, next: TreeRates): RateShift[] {
  if (!prev) return []
  const shifts: RateShift[] = []
  for (const key of RATE_KEYS) {
    const fromFallback = prev.fallback?.includes(key) ?? false
    const toFallback = next.fallback?.includes(key) ?? false
    if (prev[key] !== next[key] || fromFallback !== toFallback) {
      shifts.push({ key, from: prev[key], to: next[key], fromFallback, toFallback })
    }
  }
  return shifts
}

/**
 * Пересчёт что-то изменит: у строк сменится цена прайса, у ФОТ-спутников —
 * ставка, у дерева — ставка экономики или её источник.
 *
 * Позиции, которых в прайсе нет, в счёт не идут: их цена остаётся прежней
 * при любом пересчёте. Версия прайса растёт с каждой правкой цены, и правка
 * одной позиции не должна звать к пересчёту расчёты, где её нет, — поэтому
 * «прайс обновился» решает это расхождение, а не номер версии.
 */
export function hasPriceDrift(summary: RepriceSummary): boolean {
  return summary.changed > 0 || summary.fotRate != null || summary.rateShifts.length > 0
}

/**
 * Договорная строка: её цену шаблон из прайса не берёт — труба корпуса,
 * шахты и горловины, цена которой вводится в ОЛ.
 */
export function isContractualRow(row: Pick<EngineRow, 'priceBinding'>): boolean {
  return row.priceBinding === 'pipePrice' || row.priceBinding === 'servicePipePrice'
}

/** У строки есть непринятая отметка «цена прайса изменилась». */
export function hasPriceDelta(row: Pick<EngineRow, 'priceCatalog' | 'priceCatalogPrev'>): boolean {
  return row.priceCatalogPrev !== undefined && row.priceCatalogPrev !== row.priceCatalog
}

/**
 * Отметка строки после того, как её цена прайса стала `after`.
 *
 * Запоминается САМАЯ РАННЯЯ непринятая цена — как у конфликта количества:
 * после двух пересчётов подряд инженер должен видеть цену, от которой ушли, а
 * не промежуточную. Цена вернулась к ней — отметка снимается сама.
 *
 * @param row строка до смены цены
 */
export function priceMarkAfter(
  row: Pick<EngineRow, 'kind' | 'priceBinding' | 'priceCatalog' | 'priceCatalogPrev'>,
  after: number | null,
): number | null | undefined {
  if (row.kind === 'ФОТ' || isContractualRow(row)) return undefined
  const earliest = row.priceCatalogPrev !== undefined ? row.priceCatalogPrev : row.priceCatalog
  return earliest !== after ? earliest : undefined
}

/**
 * Пересчитать цены дерева по прайсу `priceOf` версии `version`.
 *
 * Дерево не меняется — возвращается новое: так один и тот же расчёт служит и
 * предпросмотру («изменятся цены 37 строк»), и самому пересчёту.
 */
export function repriceTree(
  tree: CalcTree,
  priceOf: PriceLookup,
  version: number,
): { tree: CalcTree; summary: RepriceSummary } {
  const rates = ratesFromPrices(priceOf)
  const summary: RepriceSummary = {
    changed: 0,
    changedUnderManual: 0,
    notFound: 0,
    fotRate: null,
    rateShifts: rateShifts(tree.rates, rates),
  }

  const reprice = (r: CalcRowNode): CalcRowNode => {
    if (isContractualRow(r)) return r
    const found = priceOf(r.category, r.name, r.unit)
    if (found == null) {
      if (r.priceCatalog != null) summary.notFound++
      return r
    }
    if (found === r.priceCatalog) return r

    if (r.kind === 'ФОТ') {
      summary.fotRate ??= { from: r.priceCatalog, to: found }
      return { ...r, priceCatalog: found }
    }

    summary.changed++
    if (r.priceManual != null) summary.changedUnderManual++
    return { ...r, priceCatalog: found, priceCatalogPrev: priceMarkAfter(r, found) }
  }

  return {
    tree: {
      ...tree,
      priceListVersion: version,
      rates,
      sections: tree.sections.map((s) => ({
        ...s,
        components: s.components.map((c) => ({ ...c, rows: c.rows.map(reprice) })),
      })),
    },
    summary,
  }
}
