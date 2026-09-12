/**
 * Сверка итога КП (решение Р7, План_устранения 3.5): пайплайн экономики,
 * перенесённый на бэкенд, обязан совпадать с движком фронта — это держат общие
 * примеры `kp-total.vectors.json`, — а сама сверка не должна запрещать выпуск
 * КП там, где проверить нечем.
 */
import { describe, expect, it } from 'vitest'
import vectors from './kp-total.vectors.json'
import {
  economicsOfTree,
  isMoldingRow,
  markupOf,
  roundUp,
  treeRates,
  verifyKpTotal,
  type TreeRates,
} from './estimate-economics'

type Case = (typeof vectors.cases)[number]

/** Сохранённый расчёт из примера: дерево одним разделом плюс итоги. */
function surveyData(c: Case, over: { rates?: unknown; totals?: unknown } = {}) {
  return {
    tree: {
      rates: 'rates' in over ? over.rates : c.rates,
      sections: [{ code: '1', enabled: true, components: [{ id: 'c1', enabled: true, rows: c.rows }] }],
    },
    totals: 'totals' in over ? over.totals : { markup: c.markup, tirage: c.tirage },
  }
}

describe('экономика сохранённого дерева совпадает с движком фронта', () => {
  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const e = economicsOfTree(surveyData(c), c.rates as TreeRates)
    expect(e).not.toBeNull()
    expect({
      hoursFittings: e!.hoursFittings,
      hoursRmu: e!.hoursRmu,
      moldingMassKg: e!.moldingMassKg,
      pzrHours: e!.pzrHours,
      acetoneKg: e!.acetoneKg,
      ppeUnits: e!.ppeUnits,
      overheadHours: e!.overheadHours,
      costRub: e!.costRub,
      salePriceRub: e!.salePriceRub,
    }).toEqual(c.expect)
  })
})

describe('ROUNDUP', () => {
  it('вверх до 0,1 · до целого · до 100 ₽ — как в эталоне', () => {
    expect(roundUp(56.3909, 1)).toBe(56.4)
    expect(roundUp(922.3, 0)).toBe(923)
    expect(roundUp(16592919.2, -2)).toBe(16593000)
  })

  it('двоичная погрешность не добавляет лишнюю десятую', () => {
    // 10 кг × 0,28 = 2.8000000000000003 — наивный Math.ceil дал бы 2,9.
    expect(roundUp(10 * 0.28, 1)).toBe(2.8)
  })
})

describe('строка формовки', () => {
  const row = (o: Record<string, unknown>) => ({ unit: 'кг', kind: 'МАТЕРИАЛ', category: 'Прочие материалы', ...o })

  it('операция в кг и непокупная категория в кг — формовка', () => {
    expect(isMoldingRow(row({ kind: 'ОПЕРАЦИЯ', category: 'Собственное производство' }))).toBe(true)
    expect(isMoldingRow(row({ category: 'Собственное производство' }))).toBe(true)
  })

  it('покупное в кг и любая строка в других ЕИ — нет', () => {
    expect(isMoldingRow(row({ name: 'Щебень 5-20 мм' }))).toBe(false)
    expect(isMoldingRow(row({ unit: 'чел. ч', kind: 'ОПЕРАЦИЯ', category: 'Собственное производство' }))).toBe(false)
  })
})

describe('ставки и наценка сохранённого дерева', () => {
  const c = vectors.cases[0]!

  it('ставки читаются из дерева; неполные — как будто их нет', () => {
    expect(treeRates(surveyData(c))).toEqual(c.rates)
    expect(treeRates(surveyData(c, { rates: { fotRub: 1207.8 } }))).toBeNull()
    expect(treeRates(surveyData(c, { rates: undefined }))).toBeNull()
  })

  it('наценки в итогах нет — константа движка 0,43', () => {
    expect(markupOf(surveyData(c, { totals: {} }))).toBe(0.43)
    expect(markupOf(surveyData(c, { totals: { markup: 0.3 } }))).toBe(0.3)
  })
})

describe('сверка итога КП', () => {
  const c = vectors.cases[0]!
  const total = c.expect.salePriceRub

  it('итог расчёта сходится с пересчитанным', () => {
    expect(verifyKpTotal(surveyData(c), total)).toEqual({ ok: true, serverTotal: total, clientTotal: total })
  })

  it('присланный итог занижен — не сходится', () => {
    expect(verifyKpTotal(surveyData(c), 1000)).toEqual({ ok: false, serverTotal: total, clientTotal: 1000 })
  })

  it('тираж и наценка из итогов участвуют в сверке', () => {
    const check = verifyKpTotal(surveyData(c, { totals: { markup: c.markup, tirage: 2 } }), total)
    expect(check).toMatchObject({ ok: false, clientTotal: total })
  })

  // Старое дерево не отклоняется, а не проверяется: у него нет ни ставок, ни
  // посчитанных количеств, и запрет выпуска КП стал бы потерей работы.
  it('дерево без ставок не проверяется', () => {
    expect(verifyKpTotal(surveyData(c, { rates: undefined }), 1)).toEqual({ ok: true, skipped: 'NO_RATES' })
  })

  it('количество выражением без посчитанного — не проверяется', () => {
    const withExpr = surveyData(c)
    withExpr.tree.sections[0]!.components[0]!.rows = [
      { kind: 'МАТЕРИАЛ', category: 'Метизы', name: 'Анкер', unit: 'шт', qtyManual: '2*3+1', priceCatalog: 92.4 },
    ] as never
    expect(verifyKpTotal(withExpr, 1)).toEqual({ ok: true, skipped: 'UNRESOLVED_ROWS' })
  })

  it('посчитанное количество строки с выражением берётся из дерева', () => {
    const withResolved = surveyData(c)
    withResolved.tree.sections[0]!.components[0]!.rows = [
      { kind: 'МАТЕРИАЛ', category: 'Метизы', name: 'Анкер', unit: 'шт', qtyManual: '2*3+1', qtyResolved: 7, priceCatalog: 100 },
    ] as never
    const e = economicsOfTree(withResolved, c.rates as TreeRates)
    expect(e!.rowsRub).toBe(700)
  })

  it('расчёт без итога — сверять не с чем', () => {
    expect(verifyKpTotal(surveyData(c), null)).toEqual({ ok: true, skipped: 'NO_CLIENT_TOTAL' })
  })
})
