import { describe, expect, it } from 'vitest'
import {
  aggregateRows,
  classifyRow,
  computeEconomics,
  DEFAULT_MARKUP,
  isRmuWork,
  profitabilityFromCost,
  salePriceFromCost,
  SIZ_BASE_UNITS,
  type CostBucket,
  type RowAggregate,
  type Rates,
} from './economics'
import type { EngineRow } from './types'

/** Ставки прайса, поколение «новое» (Реверс §1, §8). */
const RATES: Rates = {
  fotRub: 1207.8,
  overheadRub: 1584.73,
  acetoneRub: 109.4,
  ppeRub: 122,
}

const agg = (o: Partial<RowAggregate> = {}): RowAggregate => ({
  hoursFittings: 0,
  hoursRmu: 0,
  moldingMassKg: 0,
  bucketSums: {
    'Материалы на закупку': 0,
    'Труба, муфта': 0,
    Формовка: 0,
    'Работы, ФОТ': 0,
  },
  ...o,
})

// ─────────────────────────────────────────────────────────────────────────────
// Контрольные числа реального расчёта ОЛ3487 (задача §2).
// Это главный критерий приёмки этапа 2.
// ─────────────────────────────────────────────────────────────────────────────

describe('контрольные числа ОЛ3487', () => {
  const HOURS_FITTINGS = 620.3

  it('ПЗР: при часах фитингов 620,3 → 56,4 чел.ч', () => {
    const e = computeEconomics(agg({ hoursFittings: HOURS_FITTINGS }), RATES)
    expect(e.pzrHours).toBe(56.4)
  })

  it('накладные: (620,3 + 56,4) × 1584,73 = 1 072 387 ₽', () => {
    const e = computeEconomics(agg({ hoursFittings: HOURS_FITTINGS }), RATES)
    expect(e.overheadHours).toBe(676.7)
    expect(Math.round(e.overheadRub)).toBe(1072387)
  })

  // Цену и рентабельность проверяем чистыми функциями от себестоимости:
  // задача даёт итоговое число 11 603 440, а полное дерево строк ОЛ3487
  // появится только на этапе 3 — восстановить разбивку по корзинам нечем.
  it('цена продажи: себестоимость 11 603 440 → 16 593 000 ₽', () => {
    expect(salePriceFromCost(11603440, DEFAULT_MARKUP)).toBe(16593000)
  })

  it('рентабельность: 30,07 %', () => {
    const price = salePriceFromCost(11603440, DEFAULT_MARKUP)
    expect(profitabilityFromCost(11603440, price) * 100).toBeCloseTo(30.07, 2)
  })

  it('пайплайн целиком сходится на себестоимости 11 603 440', () => {
    // Подбираем закупку так, чтобы ИТОГОВАЯ себестоимость совпала с
    // контрольной: при часах 620,3 «Прочие» и ПЗР добавляются сами.
    const hoursFittings = 620.3
    const probe = computeEconomics(agg({ hoursFittings }), RATES)
    const materials = 11603440 - probe.costRub

    const e = computeEconomics(
      agg({ hoursFittings, bucketSums: { ...agg().bucketSums, 'Материалы на закупку': materials } }),
      RATES,
    )

    expect(e.costRub).toBeCloseTo(11603440, 6)
    expect(e.salePriceRub).toBe(16593000)
    expect(e.profitability * 100).toBeCloseTo(30.07, 2)
  })

  it('наценка по умолчанию — 0,43', () => {
    expect(DEFAULT_MARKUP).toBe(0.43)
    expect(computeEconomics(agg(), RATES).markup).toBe(0.43)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Формулы, сверенные с первоисточником построчно.
// ─────────────────────────────────────────────────────────────────────────────

describe('формулы эталона «Шаблон 3.0.xlsx»', () => {
  // Собственный самосогласованный кейс шаблона (не ОЛ3487):
  // J441 = 649, J443 = 59, J445 = 44,7, J446 = 951, J447 = 708.
  it('ПЗР: ROUNDUP(649 / 11; 0,1) = 59 (J443)', () => {
    expect(computeEconomics(agg({ hoursFittings: 649 }), RATES).pzrHours).toBe(59)
  })

  it('ацетон: ROUNDUP(892,85 × 0,05; 0,1) = 44,7 кг (J445)', () => {
    const e = computeEconomics(agg({ moldingMassKg: 892.8508406135089 }), RATES)
    expect(e.acetoneKg).toBe(44.7)
    expect(e.acetoneRub).toBeCloseTo(4890.18, 2)
  })

  it('накладные: ROUNDUP(649 + 59; 0,1) = 708 чел.ч (J447)', () => {
    const e = computeEconomics(agg({ hoursFittings: 649 }), RATES)
    expect(e.overheadHours).toBe(708)
    expect(e.overheadRub).toBeCloseTo(1121988.84, 2)
  })

  // Главное расхождение с прежней редакцией документов.
  describe('СИЗ = ROUNDUP(часы_фитингов + 302), а НЕ + ПЗР', () => {
    it('649 + 302 = 951 ед. (J446)', () => {
      const e = computeEconomics(agg({ hoursFittings: 649 }), RATES)
      expect(e.ppeUnits).toBe(951)
      expect(e.ppeRub).toBe(116022) // 951 × 122
    })

    it('константа надбавки — 302', () => {
      expect(SIZ_BASE_UNITS).toBe(302)
    })

    // Прямое следствие константы: расчёт с нулевым трудом всё равно несёт
    // 302 × 122 = 36 844 ₽ на СИЗ. Это поведение самого эталона, а не дефект
    // движка, — но именно оно делает вопрос о смысле 302 небезобидным
    // (План §4.1-bis A).
    it('при нулевых часах СИЗ всё равно даёт 36 844 ₽ — порог из константы', () => {
      const e = computeEconomics(agg(), RATES)
      expect(e.ppeUnits).toBe(302)
      expect(e.ppeRub).toBe(36844)
      expect(e.costRub).toBe(36844)
    })

    it('ПЗР на СИЗ не влияет', () => {
      // Часы фитингов те же, ПЗР меняется только вместе с ними, поэтому
      // проверяем прямо: 620,3 + 302 = 922,3 → 923, а не 620,3 + 56,4 = 677.
      const e = computeEconomics(agg({ hoursFittings: 620.3 }), RATES)
      expect(e.ppeUnits).toBe(923)
      expect(e.ppeUnits).not.toBe(677) // так считали бы по старой редакции ТЗ §9.5
    })
  })

  it('ПЗР входит в «Работы, ФОТ», а не в «Прочие» (N453 / N455)', () => {
    const e = computeEconomics(agg({ hoursFittings: 649 }), RATES)
    const pzrRub = 59 * 1207.8

    expect(e.buckets['Работы, ФОТ']).toBeCloseTo(pzrRub, 6)
    expect(e.buckets['Прочие затраты']).toBeCloseTo(e.acetoneRub + e.ppeRub + e.overheadRub, 6)
    expect(e.buckets['Прочие затраты']).not.toBeCloseTo(
      e.acetoneRub + e.ppeRub + e.overheadRub + pzrRub,
      6,
    )
  })

  it('себестоимость = ровно сумма 5 корзин (N449)', () => {
    const e = computeEconomics(
      agg({
        hoursFittings: 100,
        moldingMassKg: 50,
        bucketSums: {
          'Материалы на закупку': 1000,
          'Труба, муфта': 2000,
          Формовка: 3000,
          'Работы, ФОТ': 4000,
        },
      }),
      RATES,
    )
    const sum =
      e.buckets['Материалы на закупку'] +
      e.buckets['Труба, муфта'] +
      e.buckets.Формовка +
      e.buckets['Работы, ФОТ'] +
      e.buckets['Прочие затраты']
    expect(e.costRub).toBeCloseTo(sum, 6)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('isRmuWork — разделение участков по «*изготов*» (§9.5 п.1)', () => {
  it.each([
    ['Изготовление рамы', true],
    ['изготовление направляющих', true],
    ['Монтаж датчиков', false],
    ['Придание изделию товарного вида', false],
  ])('«%s» → РМУ: %s', (name, expected) => {
    expect(isRmuWork(name)).toBe(expected)
  })
})

describe('classifyRow — корзина определяется ЕИ, а не категорией', () => {
  const row = (o: Partial<EngineRow> & { bucket?: CostBucket }): EngineRow & { bucket?: CostBucket } =>
    ({
      id: 'r',
      kind: 'МАТЕРИАЛ',
      category: 'Прочие материалы',
      name: 'Позиция',
      unit: 'шт',
      qtyCalc: 1,
      qtyManual: null,
      priceCatalog: 100,
      priceManual: null,
      ...o,
    }) as EngineRow & { bucket?: CostBucket }

  it('ЕИ «чел. ч» → «Работы, ФОТ»', () => {
    expect(classifyRow(row({ unit: 'чел. ч' }))).toBe('Работы, ФОТ')
  })

  it('ЕИ «кг» → «Формовка»', () => {
    expect(classifyRow(row({ unit: 'кг' }))).toBe('Формовка')
  })

  it('прочие ЕИ → «Материалы на закупку»', () => {
    expect(classifyRow(row({ unit: 'шт' }))).toBe('Материалы на закупку')
    expect(classifyRow(row({ unit: 'м' }))).toBe('Материалы на закупку')
  })

  // Показательный случай из эталона (строка 430).
  it('«Собственное производство» с ЕИ «чел. ч» — это ТРУД, не формовка', () => {
    const r = row({
      category: 'Собственное производство',
      name: 'Монтаж Поплавковых выключателей',
      unit: 'чел. ч',
    })
    expect(classifyRow(r)).toBe('Работы, ФОТ')
  })

  it('явная корзина каталога выигрывает (труба/муфта по ЕИ неотличимы)', () => {
    expect(classifyRow(row({ unit: 'м', bucket: 'Труба, муфта' }))).toBe('Труба, муфта')
  })
})

describe('aggregateRows', () => {
  const mk = (o: Partial<EngineRow> & { bucket?: CostBucket }): EngineRow & { bucket?: CostBucket } =>
    ({
      id: Math.random().toString(36).slice(2),
      kind: 'МАТЕРИАЛ',
      category: 'Прочие материалы',
      name: 'Позиция',
      unit: 'шт',
      qtyCalc: 1,
      qtyManual: null,
      priceCatalog: 100,
      priceManual: null,
      ...o,
    }) as EngineRow & { bucket?: CostBucket }

  it('разделяет часы на фитинги и РМУ', () => {
    const a = aggregateRows([
      mk({ name: 'Монтаж датчиков', unit: 'чел. ч', qtyCalc: 10, priceCatalog: 1207.8 }),
      mk({ name: 'Изготовление рамы', unit: 'чел. ч', qtyCalc: 4, priceCatalog: 1207.8 }),
    ])
    expect(a.hoursFittings).toBe(10)
    expect(a.hoursRmu).toBe(4)
  })

  it('суммирует массу формовки по ЕИ «кг»', () => {
    const a = aggregateRows([
      mk({ unit: 'кг', qtyCalc: 262.8, priceCatalog: 214.4 }),
      mk({ unit: 'кг', qtyCalc: 78.9, priceCatalog: 310.2 }),
      mk({ unit: 'шт', qtyCalc: 5 }),
    ])
    expect(a.moldingMassKg).toBeCloseTo(341.7, 6)
  })

  it('строка без цены не ломает агрегат и даёт сумму 0', () => {
    const a = aggregateRows([mk({ unit: 'м', qtyCalc: 11.6, priceCatalog: null })])
    expect(a.bucketSums['Материалы на закупку']).toBe(0)
  })

  it('выключенная строка исключается из итога', () => {
    const a = aggregateRows([mk({ qtyCalc: 5, priceCatalog: 100, enabled: false })])
    expect(a.bucketSums['Материалы на закупку']).toBe(0)
  })

  it('тираж домножает количества (Механика §9.1)', () => {
    const a = aggregateRows([mk({ unit: 'кг', qtyCalc: 100, priceCatalog: 10 })], { tirage: 3 })
    expect(a.moldingMassKg).toBe(300)
    expect(a.bucketSums.Формовка).toBe(3000)
  })
})
