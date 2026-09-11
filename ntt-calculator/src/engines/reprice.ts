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
 * @module engines/reprice
 */

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
  /** Ставка ФОТ до и после, если сдвинулась. */
  fotRate: { from: number | null; to: number } | null
}

/**
 * Пересчёт что-то изменит: у строк сменится цена прайса или ставка ФОТ.
 *
 * Позиции, которых в прайсе нет, в счёт не идут: их цена остаётся прежней
 * при любом пересчёте. Версия прайса растёт с каждой правкой цены, и правка
 * одной позиции не должна звать к пересчёту расчёты, где её нет, — поэтому
 * «прайс обновился» решает это расхождение, а не номер версии.
 */
export function hasPriceDrift(summary: RepriceSummary): boolean {
  return summary.changed > 0 || summary.fotRate != null
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
  const summary: RepriceSummary = { changed: 0, changedUnderManual: 0, notFound: 0, fotRate: null }

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
      sections: tree.sections.map((s) => ({
        ...s,
        components: s.components.map((c) => ({ ...c, rows: c.rows.map(reprice) })),
      })),
    },
    summary,
  }
}
