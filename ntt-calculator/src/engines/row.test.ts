import { describe, expect, it } from 'vitest'
import { computeRow, hasQtyConflict, isPurchase, resolvePrice, resolveQty } from './row'
import type { EngineRow } from './types'

const row = (o: Partial<EngineRow> = {}): EngineRow => ({
  id: 'r1',
  kind: 'МАТЕРИАЛ',
  category: 'Прочие материалы',
  name: 'Позиция',
  unit: 'шт',
  qtyCalc: 10,
  qtyManual: null,
  priceCatalog: 100,
  priceManual: null,
  ...o,
})

describe('isPurchase — флаг «Закупка» (Механика §5.3)', () => {
  it('13 закупочных категорий → да', () => {
    expect(isPurchase('Метизы')).toBe(true)
    expect(isPurchase('Насосы, АТМ')).toBe(true)
    expect(isPurchase('Грузоподъем')).toBe(true)
  })

  it('3 непокупные категории → нет', () => {
    expect(isPurchase('Собственное производство')).toBe(false)
    expect(isPurchase('Работы')).toBe(false)
    expect(isPurchase('ФОТ')).toBe(false)
  })
})

describe('канал количества (Механика §5.1)', () => {
  it('без override берётся расчётное', () => {
    expect(resolveQty(row())).toEqual({ qty: 10, overridden: false })
  })

  it('ручной override перекрывает расчётное', () => {
    expect(resolveQty(row({ qtyManual: '3' }))).toEqual({ qty: 3, overridden: true })
  })

  it('override принимает арифметическое выражение', () => {
    const { qty } = resolveQty(row({ qtyManual: '1.55*2+2.88*2' }))
    expect(qty).toBeCloseTo(8.86, 10)
  })

  it('некорректное выражение откатывает к расчётному, а не роняет расчёт', () => {
    expect(resolveQty(row({ qtyManual: 'мусор' }))).toEqual({ qty: 10, overridden: false })
  })

  it('строка без формулы имеет только ручное количество', () => {
    expect(resolveQty(row({ qtyCalc: null, qtyManual: '7' })).qty).toBe(7)
    expect(resolveQty(row({ qtyCalc: null, qtyManual: null })).qty).toBe(0)
  })

  it('выключенная строка даёт 0', () => {
    expect(resolveQty(row({ enabled: false })).qty).toBe(0)
  })

  it('выключенный раздел обнуляет строку (Механика §7.2)', () => {
    expect(resolveQty(row(), { sectionEnabled: false }).qty).toBe(0)
  })

  it('тираж домножает количество', () => {
    expect(resolveQty(row(), { tirage: 3 }).qty).toBe(30)
  })

  it('трудоёмкость округляется вверх до 0,1', () => {
    expect(resolveQty(row({ unit: 'чел. ч', qtyCalc: 2.81 })).qty).toBe(2.9)
  })

  it('штучный материал не округляется', () => {
    expect(resolveQty(row({ unit: 'шт', qtyCalc: 2.81 })).qty).toBe(2.81)
  })
})

describe('канал цены (Механика §5.2)', () => {
  it('без override берётся каталожная', () => {
    expect(resolvePrice(row())).toEqual({ price: 100, overridden: false })
  })

  it('ручная цена перекрывает каталожную', () => {
    expect(resolvePrice(row({ priceManual: 250 }))).toEqual({ price: 250, overridden: true })
  })

  it('ручной ноль — это цена, а не отсутствие цены', () => {
    expect(resolvePrice(row({ priceManual: 0 }))).toEqual({ price: 0, overridden: true })
  })
})

describe('computeRow', () => {
  it('сумма = кол-во × цена', () => {
    expect(computeRow(row()).sum).toBe(1000)
  })

  // §9.2 ТЗ, Механика §5.2: промах по прайсу и нет ручной цены → сумма 0,
  // строка «красная», блокирует переход CALC → REVIEW.
  it('строка без цены: сумма 0 и признак missingPrice', () => {
    const r = computeRow(row({ name: 'Труба СК/НПС-К 3000-0,1-10000', unit: 'м', qtyCalc: 11.6, priceCatalog: null }))
    expect(r.missingPrice).toBe(true)
    expect(r.sum).toBe(0)
    expect(r.qty).toBe(11.6) // количество при этом известно
  })

  it('ввод ручной цены снимает состояние «без цены»', () => {
    const r = computeRow(row({ qtyCalc: 11.6, priceCatalog: null, priceManual: 50000 }))
    expect(r.missingPrice).toBe(false)
    expect(r.sum).toBe(580000)
  })

  it('сообщает, какой канал переопределён', () => {
    const r = computeRow(row({ qtyManual: '5', priceManual: 200 }))
    expect(r).toMatchObject({ qty: 5, price: 200, sum: 1000, qtyOverridden: true, priceOverridden: true })
  })

  it('выключенная строка не входит в итог, но цену сохраняет', () => {
    const r = computeRow(row({ enabled: false }))
    expect(r.qty).toBe(0)
    expect(r.sum).toBe(0)
    expect(r.price).toBe(100)
  })
})

describe('hasQtyConflict (Механика §8.3)', () => {
  it('override поверх изменившегося расчётного → конфликт', () => {
    expect(hasQtyConflict(row({ qtyCalc: 17.2, qtyManual: '18.85' }), 20)).toBe(true)
  })

  it('расчётное не менялось → конфликта нет', () => {
    expect(hasQtyConflict(row({ qtyCalc: 17.2, qtyManual: '18.85' }), 17.2)).toBe(false)
  })

  it('без override конфликта нет — расчётное просто обновляется', () => {
    expect(hasQtyConflict(row({ qtyCalc: 17.2, qtyManual: null }), 20)).toBe(false)
  })

  it('нет предыдущего значения → конфликта нет', () => {
    expect(hasQtyConflict(row({ qtyManual: '5' }), null)).toBe(false)
  })
})
