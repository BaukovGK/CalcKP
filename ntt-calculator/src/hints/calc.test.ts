import { describe, expect, it } from 'vitest'
import { calcRowHint, type RowHintContext } from './calc'
import type { CalcRowNode } from '@/engines/template-kns'
import type { RowResult } from '@/engines/types'

const row = (over: Partial<CalcRowNode> = {}): CalcRowNode => ({
  id: 'r1',
  kind: 'ОПЕРАЦИЯ',
  category: 'Собственное производство',
  name: 'Механическая формовка эллиптических днищ',
  unit: 'кг',
  qtyCalc: 392,
  qtyManual: null,
  priceCatalog: 214.4,
  priceManual: null,
  enabled: true,
  ...over,
})

const res = (over: Partial<RowResult> = {}): RowResult => ({
  qty: 392,
  price: 214.4,
  sum: 392 * 214.4,
  missingPrice: false,
  qtyOverridden: false,
  priceOverridden: false,
  ...over,
})

const ctx = (over: Partial<RowHintContext> = {}): RowHintContext => ({
  conflict: false,
  prevCalc: null,
  fotK: null,
  parent: null,
  disabled: false,
  tirage: 1,
  ...over,
})

const all = (h: ReturnType<typeof calcRowHint>) => [h.title, ...[h.text ?? []].flat(), ...[h.formula ?? []].flat()].join('\n')

describe('сноска строки расчёта', () => {
  it('полное наименование, цена из прайса, сумма и корзина итогов', () => {
    const h = calcRowHint(row({ note: 'ƒ 2 днища × 196 кг — матрица' }), res(), ctx())
    expect(h.title).toBe('Механическая формовка эллиптических днищ')
    expect(all(h)).toContain('Цена — из прайса по категории «Собственное производство»')
    expect(h.formula).toContain('2 днища × 196 кг — матрица')
    expect(all(h)).toContain('сумма = 392 × 214,4')
    expect(all(h)).toContain('«Формовка»')
    expect(h.tone).toBeUndefined()
  })

  // План_устранения 3.8: щебень и сорбент не формуют — это покупное.
  it('покупное в кг — в материалах, и сноска говорит почему', () => {
    const h = calcRowHint(row({ kind: 'МАТЕРИАЛ', category: 'Прочие материалы', name: 'Щебень 5-20 мм' }), res(), ctx())
    expect(all(h)).toContain('В итогах — «Материалы на закупку»: покупное в кг не формуют, в массу для ацетона оно не входит.')
    expect(all(h)).not.toContain('«Формовка»')
  })

  it('нет цены — сноска-ошибка: строка не даёт выпустить КП', () => {
    const h = calcRowHint(row({ priceCatalog: null }), res({ price: null, sum: 0, missingPrice: true }), ctx())
    expect(h.tone).toBe('error')
    expect(all(h)).toContain('не даёт выпустить КП')
  })

  it('цена, связанная с полем опросного листа, называет это поле', () => {
    const h = calcRowHint(
      row({ name: 'Труба СК/НПС-К 2000-0,1-10000', unit: 'м', bucket: 'Труба, муфта', priceBinding: 'pipePrice', priceManual: 20000 }),
      res({ price: 20000, priceOverridden: true }),
      ctx(),
    )
    expect(all(h)).toContain('«Цена трубы, ₽/м.п.»')
    expect(all(h)).toContain('«Труба, муфта»')
  })

  it('ручное количество — выражение и расчётное, синий тон', () => {
    const h = calcRowHint(row({ qtyManual: '1,55*2+2,88*2' }), res({ qty: 8.86, qtyOverridden: true }), ctx())
    expect(h.tone).toBe('ovr')
    expect(all(h)).toContain('«1,55*2+2,88*2»')
    expect(all(h)).toContain('Расчётное — 392')
  })

  // План_устранения, 1.1: правки перенесены на строку с новым наименованием.
  it('наименование сменилось с параметром ОЛ — янтарь, прежнее наименование', () => {
    const h = calcRowHint(
      row({ name: 'Муфта-2 СК/НПС-К 300-1', priceManual: 41000, renamedFrom: 'Муфта-2 СК/НПС-К 250-1' }),
      res({ priceOverridden: true }),
      ctx({ conflict: true }),
    )
    expect(h.tone).toBe('warn')
    expect(all(h)).toContain('было «Муфта-2 СК/НПС-К 250-1»')
  })

  it('конфликт с опросным листом — янтарь, было → стало', () => {
    const h = calcRowHint(row({ qtyManual: '400' }), res({ qty: 400, qtyOverridden: true }), ctx({ conflict: true, prevCalc: 380 }))
    expect(h.tone).toBe('warn')
    expect(all(h)).toContain('380 → 392')
  })

  // Часы спутника — от массы родителя: сноска показывает и массу, и k.
  it('ФОТ-спутник: масса операции × k', () => {
    const parent = row({ id: 'p1', name: 'Ламинирование эллиптического днища к корпусу', qtyCalc: 70 })
    const sat = row({ id: 's1', kind: 'ФОТ', category: 'ФОТ', name: 'ФОТ', unit: 'чел. ч', qtyCalc: 39.2, parentId: 'p1', priceCatalog: 1207.8 })
    const h = calcRowHint(sat, res({ qty: 39.2, price: 1207.8, sum: 39.2 * 1207.8 }), ctx({ fotK: 0.56, parent }))
    expect(h.formula).toContain('«Ламинирование эллиптического днища к корпусу» 70 кг × k 0,56 = 39,2 чел.ч, вверх до 0,1')
    expect(all(h)).toContain('ламинирование')
    expect(all(h)).toContain('«Работы, ФОТ»')
  })

  it('выключенный узел: строка в итог не входит', () => {
    const h = calcRowHint(row(), res({ qty: 0, sum: 0 }), ctx({ disabled: true }))
    expect(all(h)).toContain('в итог не входит')
  })
})

describe('сноска строки: цена сдвинулась при пересчёте по новому прайсу', () => {
  it('говорит, какая цена была и какая стала, и что делают ✓ и ↶', () => {
    const h = calcRowHint(row({ priceCatalog: 230, priceCatalogPrev: 214.4 }), res({ price: 230, sum: 392 * 230 }), ctx({ priceDelta: true, pricePrev: 214.4 }))
    expect(all(h)).toContain('было 214,4 ₽, стало 230 ₽')
    expect(all(h)).toContain('↶ — оставить прежнюю')
    expect(h.tone).toBe('warn')
  })

  it('под ручной ценой — что применяется ручная', () => {
    const h = calcRowHint(
      row({ priceCatalog: 230, priceManual: 200 }),
      res({ price: 200, sum: 392 * 200, priceOverridden: true }),
      ctx({ priceDelta: true, pricePrev: 214.4 }),
    )
    expect(all(h)).toContain('Применяется ручная — 200 ₽')
  })

  it('раньше цены в прайсе не было — так и сказано', () => {
    const h = calcRowHint(row({ priceCatalog: 230 }), res({ price: 230 }), ctx({ priceDelta: true, pricePrev: null }))
    expect(all(h)).toContain('цены в прайсе не было, стало 230 ₽')
  })
})
