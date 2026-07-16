import { describe, expect, it } from 'vitest'
import { aggregateRows, computeEconomics, COST_BUCKETS, type CostBucket, type Rates } from './economics'
import { recalcFotSatellites } from './fot'
import { computeRow } from './row'
import { CATEGORIES, type EngineRow } from './types'

/**
 * Инвариант Механики §12.1: «Сумма итогового блока всегда равна сумме
 * включённых строк + начисления §9 (в Excel это контролировалось дублирующей
 * формулой — здесь инвариант движка, покрывается тестами)».
 *
 * В эталоне ту же роль играет сверка N449 против O449.
 *
 * Тест рандомизированный, но детерминированный: генератор — простой LCG с
 * фиксированным зерном, чтобы падение всегда воспроизводилось.
 */

const RATES: Rates = { fotRub: 1207.8, overheadRub: 1584.73, acetoneRub: 109.4, ppeRub: 122 }

function makeRng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

const UNITS = ['шт', 'м', 'кг', 'чел. ч', 'м²']

function randomRows(rnd: () => number, n: number): Array<EngineRow & { bucket?: CostBucket }> {
  const rows: Array<EngineRow & { bucket?: CostBucket }> = []

  for (let i = 0; i < n; i++) {
    const unit = UNITS[Math.floor(rnd() * UNITS.length)]!
    const category = CATEGORIES[Math.floor(rnd() * CATEGORIES.length)]!

    rows.push({
      id: `r${i}`,
      kind: unit === 'кг' ? 'ОПЕРАЦИЯ' : 'МАТЕРИАЛ',
      category,
      // Часть работ уводим на участок РМУ через «изготов» в наименовании.
      name: rnd() < 0.25 ? `Изготовление узла ${i}` : `Позиция ${i}`,
      unit,
      qtyCalc: Math.round(rnd() * 5000) / 10,
      qtyManual: rnd() < 0.2 ? String(Math.round(rnd() * 100) / 10) : null,
      priceCatalog: rnd() < 0.15 ? null : Math.round(rnd() * 100000) / 100,
      priceManual: rnd() < 0.1 ? Math.round(rnd() * 50000) / 100 : null,
      enabled: rnd() < 0.15 ? false : true,
      bucket: rnd() < 0.05 ? 'Труба, муфта' : undefined,
    })
  }

  // ФОТ-спутники к части операций.
  const ops = rows.filter((r) => r.kind === 'ОПЕРАЦИЯ')
  ops.forEach((op, i) => {
    if (rnd() < 0.6) {
      rows.push({
        id: `fot${i}`,
        kind: 'ФОТ',
        category: 'ФОТ',
        name: 'ФОТ',
        unit: 'чел. ч',
        qtyCalc: 0,
        qtyManual: null,
        priceCatalog: RATES.fotRub,
        priceManual: null,
        parentId: op.id,
      })
    }
  })

  return rows
}

describe('инвариант §12.1: итог = сумма включённых строк + начисления', () => {
  const SEEDS = [1, 7, 42, 1337, 20260716, 999983]

  it.each(SEEDS)('зерно %i', (seed) => {
    const rnd = makeRng(seed)
    const rows = recalcFotSatellites(randomRows(rnd, 60)) as Array<EngineRow & { bucket?: CostBucket }>

    const agg = aggregateRows(rows)
    const e = computeEconomics(agg, RATES)

    // 1. Себестоимость равна сумме своих же корзин — ровно пяти, без остатка.
    const bucketTotal = COST_BUCKETS.reduce((s, b) => s + e.buckets[b], 0)
    expect(e.costRub).toBeCloseTo(bucketTotal, 6)

    // 2. Сумма строк, посчитанная независимо от пайплайна, совпадает с
    //    корзинами строк (все, кроме «Прочих» и ПЗР, — они начисления).
    const rowsTotal = rows.reduce((s, r) => s + computeRow(r).sum, 0)
    const fromBuckets =
      e.buckets['Материалы на закупку'] +
      e.buckets['Труба, муфта'] +
      e.buckets.Формовка +
      e.buckets['Работы, ФОТ'] -
      e.pzrRub // ПЗР — начисление, строки за ним нет
    expect(fromBuckets).toBeCloseTo(rowsTotal, 6)

    // 3. «Прочие» — ровно ацетон + СИЗ + накладные, без ПЗР (эталон N455).
    expect(e.buckets['Прочие затраты']).toBeCloseTo(e.acetoneRub + e.ppeRub + e.overheadRub, 6)

    // 4. Цена продажи не ниже себестоимости при неотрицательной наценке.
    expect(e.salePriceRub).toBeGreaterThanOrEqual(e.costRub)

    // 5. Рентабельность в допустимом диапазоне.
    expect(e.profitability).toBeGreaterThanOrEqual(0)
    expect(e.profitability).toBeLessThan(1)
  })

  it('выключенные строки не влияют на итог', () => {
    const rnd = makeRng(2024)
    const rows = recalcFotSatellites(randomRows(rnd, 40)) as Array<EngineRow & { bucket?: CostBucket }>

    const withAll = computeEconomics(aggregateRows(rows), RATES)
    // Удаляем выключенные физически — итог обязан совпасть.
    const withoutDisabled = computeEconomics(
      aggregateRows(rows.filter((r) => r.enabled !== false)),
      RATES,
    )

    expect(withoutDisabled.costRub).toBeCloseTo(withAll.costRub, 6)
  })

  it('строки без цены не вносят вклад в себестоимость', () => {
    const rnd = makeRng(555)
    const rows = recalcFotSatellites(randomRows(rnd, 40)) as Array<EngineRow & { bucket?: CostBucket }>

    const withAll = computeEconomics(aggregateRows(rows), RATES)
    const priced = rows.filter((r) => r.priceManual != null || r.priceCatalog != null)
    const withoutMissing = computeEconomics(aggregateRows(priced), RATES)

    // Часы строк без цены всё равно участвуют в начислениях, поэтому
    // сравниваем именно корзины материалов, а не итог целиком.
    expect(withoutMissing.buckets['Материалы на закупку']).toBeCloseTo(
      withAll.buckets['Материалы на закупку'],
      6,
    )
  })

  it('тираж N масштабирует корзины строк ровно в N раз', () => {
    const rnd = makeRng(88)
    const rows = recalcFotSatellites(randomRows(rnd, 30)) as Array<EngineRow & { bucket?: CostBucket }>

    const one = aggregateRows(rows, { tirage: 1 })
    const three = aggregateRows(rows, { tirage: 3 })

    expect(three.bucketSums['Материалы на закупку']).toBeCloseTo(
      one.bucketSums['Материалы на закупку'] * 3,
      6,
    )
    expect(three.moldingMassKg).toBeCloseTo(one.moldingMassKg * 3, 6)
  })
})
