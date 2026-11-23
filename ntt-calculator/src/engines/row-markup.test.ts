import { describe, expect, it } from 'vitest'
import { defaultMarkupK, optimizeMarkupK, PURCHASE_MARKUP_K, rowMarkupK, weightedMarkup, type MarkupRowInput } from './row-markup'

const rows: MarkupRowInput[] = [
  { id: 'pump', category: 'Насосы, АТМ', sum: 600_000 },
  { id: 'valve', category: 'Запорная арматура', sum: 100_000 },
  { id: 'body', category: 'Собственное производство', sum: 250_000 },
  { id: 'work', category: 'Работы', sum: 50_000 },
]

const weighted = (ks: Map<string, number>, list = rows) =>
  weightedMarkup(list.map((r) => ({ sum: r.sum, k: ks.get(r.id)! })))

describe('коэффициент наценки строки', () => {
  it('по умолчанию — от общей наценки', () => {
    expect(defaultMarkupK(0.43)).toBe(1.43)
    expect(rowMarkupK({}, 0.43)).toBe(1.43)
    expect(rowMarkupK({ markupK: 1.2 }, 0.43)).toBe(1.2)
  })

  it('по умолчанию без округления: нецелая наценка не превышается', () => {
    expect(defaultMarkupK(0.43255)).toBe(1 + 0.43255)
    const w = weightedMarkup(rows.map((r) => ({ sum: r.sum, k: defaultMarkupK(0.43255) })))!
    expect(w).toBeLessThanOrEqual(0.43255 + 1e-9)
  })

  it('средневзвешенная наценка не учитывает строки без суммы', () => {
    expect(weightedMarkup([{ sum: 100, k: 1.5 }, { sum: 0, k: 9 }])).toBeCloseTo(0.5)
    expect(weightedMarkup([])).toBeNull()
  })
})

describe('optimizeMarkupK', () => {
  it('закупка — 1,05, производство — остаток наценки', () => {
    const ks = optimizeMarkupK(rows, 0.43)
    expect(ks.get('pump')).toBe(PURCHASE_MARKUP_K)
    expect(ks.get('valve')).toBe(PURCHASE_MARKUP_K)
    // (1,43·1 000 000 − 1,05·700 000) / 300 000 = 2,316(6) → вниз до 2,316
    expect(ks.get('body')).toBe(2.316)
    expect(ks.get('work')).toBe(2.316)
  })

  it('S_з = 1 000 000, S_п = 500 000, наценка 0,43 → закупка 1,05, производство 2,19', () => {
    const list: MarkupRowInput[] = [
      { id: 'buy', category: 'Насосы, АТМ', sum: 1_000_000 },
      { id: 'own', category: 'Собственное производство', sum: 500_000 },
    ]
    const ks = optimizeMarkupK(list, 0.43)
    expect(ks.get('buy')).toBe(1.05)
    expect(ks.get('own')).toBe(2.19)
    expect(weighted(ks, list)!).toBeLessThanOrEqual(0.43 + 1e-9)
  })

  it('Работы и ФОТ — производство', () => {
    const list: MarkupRowInput[] = [
      { id: 'buy', category: 'Метизы', sum: 1_000 },
      { id: 'work', category: 'Работы', sum: 1_000 },
      { id: 'fot', category: 'ФОТ', sum: 1_000 },
    ]
    const ks = optimizeMarkupK(list, 0.43)
    expect(ks.get('buy')).toBe(1.05)
    expect(ks.get('fot')).toBe(ks.get('work'))
    expect(ks.get('fot')).toBeGreaterThan(1.43)
  })

  it('нецелая наценка без производства — у всех 1 + наценка без округления', () => {
    const only = rows.filter((r) => r.id === 'pump')
    expect(optimizeMarkupK(only, 0.43255).get('pump')).toBe(1 + 0.43255)
  })

  it('тираж (все суммы × 3) коэффициентов не меняет', () => {
    const x3 = rows.map((r) => ({ ...r, sum: r.sum * 3 }))
    expect([...optimizeMarkupK(x3, 0.43)]).toEqual([...optimizeMarkupK(rows, 0.43)])
  })

  it('на случайных суммах наценка по строкам после оптимизации не выше общей', () => {
    let seed = 42
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let n = 0; n < 300; n++) {
      const m = 0.051 + rnd() * 1.5
      const list: MarkupRowInput[] = Array.from({ length: 1 + Math.floor(rnd() * 8) }, (_, i) => ({
        id: `r${i}`,
        category: rnd() < 0.5 ? 'Метизы' : 'Собственное производство',
        sum: rnd() < 0.1 ? 0 : Math.round(rnd() * 5_000_000) / 100,
      }))
      const w = weighted(optimizeMarkupK(list, m), list)
      if (w != null) expect(w).toBeLessThanOrEqual(m + 1e-9)
    }
  })

  it('общая наценка по строкам не превышает заданной', () => {
    for (const m of [0.06, 0.1, 0.25, 0.43, 0.777]) {
      const w = weighted(optimizeMarkupK(rows, m))!
      expect(w).toBeLessThanOrEqual(m + 1e-12)
      expect(w).toBeGreaterThan(m - 0.001)
    }
  })

  it('наценка не выше 5 % — у всех общая', () => {
    const ks = optimizeMarkupK(rows, 0.05)
    expect([...ks.values()].every((k) => k === 1.05)).toBe(true)
    const low = optimizeMarkupK(rows, 0.03)
    expect([...low.values()].every((k) => k === 1.03)).toBe(true)
  })

  it('без производства перекладывать некуда — у всех общая', () => {
    const only = rows.filter((r) => r.id === 'pump' || r.id === 'valve')
    const ks = optimizeMarkupK(only, 0.43)
    expect([...ks.values()].every((k) => k === 1.43)).toBe(true)
  })

  it('без закупки — производство по общей', () => {
    const own = rows.filter((r) => r.id === 'body' || r.id === 'work')
    expect(optimizeMarkupK(own, 0.43).get('body')).toBe(1.43)
  })

  it('строка с нулевой суммой получает коэффициент своей группы', () => {
    const ks = optimizeMarkupK([...rows, { id: 'off', category: 'Работы', sum: 0 }, { id: 'nop', category: 'Метизы', sum: 0 }], 0.43)
    expect(ks.get('off')).toBe(2.316)
    expect(ks.get('nop')).toBe(1.05)
  })
})
