import { describe, expect, it } from 'vitest'
import { hasPriceDelta, hasPriceDrift, isContractualRow, priceMarkAfter, rateShifts, repriceTree, type PriceLookup, type RepriceSummary } from './reprice'
import { FALLBACK_RATES } from './economics'
import type { CalcRowNode, CalcTree } from './template-kns'

function row(over: Partial<CalcRowNode>): CalcRowNode {
  return {
    id: 'r',
    kind: 'МАТЕРИАЛ',
    category: 'Металлопрокат',
    name: 'Позиция',
    unit: 'шт',
    qtyCalc: 1,
    qtyManual: null,
    priceCatalog: 100,
    priceManual: null,
    enabled: true,
    ...over,
  }
}

function tree(rows: CalcRowNode[], priceListVersion = 2): CalcTree {
  return {
    deviceType: 'KNS',
    survey: {},
    priceListVersion,
    sections: [{ id: 's1', code: '1', title: 'Корпус', enabled: true, components: [{ id: 'c1', title: 'Узел', enabled: true, rows }] }],
  }
}

/** Прайс новой версии: наименование → цена; чего нет — `null`. */
function prices(map: Record<string, number>): PriceLookup {
  return (_category, name) => map[name] ?? null
}

const rowsOf = (t: CalcTree) => t.sections[0]!.components[0]!.rows
const byId = (t: CalcTree, id: string) => rowsOf(t).find((r) => r.id === id)!

describe('пересчёт цен по новой версии прайса', () => {
  it('сменившаяся цена берётся из нового прайса, прежняя — в отметку «было»', () => {
    const { tree: next, summary } = repriceTree(tree([row({ id: 'a', name: 'Полоса', priceCatalog: 100 })]), prices({ Полоса: 120 }), 5)
    expect(byId(next, 'a')).toMatchObject({ priceCatalog: 120, priceCatalogPrev: 100 })
    expect(summary.changed).toBe(1)
    expect(next.priceListVersion).toBe(5)
  })

  it('цена та же — строка не трогается и отметки нет', () => {
    const source = row({ id: 'a', name: 'Лист', priceCatalog: 200 })
    const { tree: next, summary } = repriceTree(tree([source]), prices({ Лист: 200 }), 5)
    expect(byId(next, 'a')).toBe(source)
    expect(summary.changed).toBe(0)
  })

  it('исходное дерево не меняется — пересчёт годится и для предпросмотра', () => {
    const t = tree([row({ id: 'a', name: 'Полоса', priceCatalog: 100 })])
    repriceTree(t, prices({ Полоса: 120 }), 5)
    expect(byId(t, 'a').priceCatalog).toBe(100)
    expect(t.priceListVersion).toBe(2)
  })

  it('ручная цена остаётся ручной, но отметка ставится: прайс под ней сдвинулся', () => {
    const { tree: next, summary } = repriceTree(
      tree([row({ id: 'a', name: 'Уголок', priceCatalog: 50, priceManual: 70 })]),
      prices({ Уголок: 55 }),
      5,
    )
    expect(byId(next, 'a')).toMatchObject({ priceCatalog: 55, priceManual: 70, priceCatalogPrev: 50 })
    expect(summary).toMatchObject({ changed: 1, changedUnderManual: 1 })
  })

  it('договорная труба не трогается: её цена живёт в поле ОЛ', () => {
    const pipe = row({ id: 'p', name: 'Труба СК/НПС-К 3000-0,1-10000', unit: 'м', priceCatalog: null, priceManual: 30000, priceBinding: 'pipePrice' })
    const { tree: next } = repriceTree(tree([pipe]), prices({ 'Труба СК/НПС-К 3000-0,1-10000': 1 }), 5)
    expect(byId(next, 'p')).toBe(pipe)
    expect(isContractualRow(pipe)).toBe(true)
    expect(isContractualRow(row({ priceBinding: 'pumpPrice' }))).toBe(false)
  })

  it('позиции нет в новом прайсе — цена прежняя, строка в сводке', () => {
    const { tree: next, summary } = repriceTree(tree([row({ id: 'a', name: 'Снятая', priceCatalog: 10 })]), prices({}), 5)
    expect(byId(next, 'a')).toMatchObject({ priceCatalog: 10 })
    expect(byId(next, 'a').priceCatalogPrev).toBeUndefined()
    expect(summary.notFound).toBe(1)
  })

  it('строка без цены, которой нет и в новом прайсе, в сводку «не найдено» не идёт', () => {
    const { summary } = repriceTree(tree([row({ id: 'a', name: 'Шкаф', priceCatalog: null })]), prices({}), 5)
    expect(summary.notFound).toBe(0)
  })

  it('появилась цена у строки, которой в прайсе не было, — отметка «было: нет цены»', () => {
    const { tree: next } = repriceTree(tree([row({ id: 'a', name: 'Новая', priceCatalog: null })]), prices({ Новая: 900 }), 5)
    expect(byId(next, 'a')).toMatchObject({ priceCatalog: 900, priceCatalogPrev: null })
    expect(hasPriceDelta(byId(next, 'a'))).toBe(true)
  })

  it('ФОТ-спутники получают новую ставку без отметок — её сдвиг в сводке', () => {
    const fot = row({ id: 'f', kind: 'ФОТ', category: 'ФОТ', name: 'ФОТ', unit: 'чел. ч', priceCatalog: 1207.8, parentId: 'op' })
    const { tree: next, summary } = repriceTree(tree([fot]), prices({ ФОТ: 1250 }), 5)
    expect(byId(next, 'f').priceCatalog).toBe(1250)
    expect(byId(next, 'f').priceCatalogPrev).toBeUndefined()
    expect(summary).toMatchObject({ changed: 0, fotRate: { from: 1207.8, to: 1250 } })
  })

  it('два пересчёта подряд помнят самую раннюю цену; вернулась к ней — отметка снимается', () => {
    const first = repriceTree(tree([row({ id: 'a', name: 'Полоса', priceCatalog: 100 })]), prices({ Полоса: 120 }), 5).tree
    const second = repriceTree(first, prices({ Полоса: 130 }), 6).tree
    expect(byId(second, 'a')).toMatchObject({ priceCatalog: 130, priceCatalogPrev: 100 })
    const back = repriceTree(second, prices({ Полоса: 100 }), 7).tree
    expect(byId(back, 'a').priceCatalog).toBe(100)
    expect(hasPriceDelta(byId(back, 'a'))).toBe(false)
  })
})

describe('отметка «цена была» при пересборке', () => {
  it('цена сдвинулась — отметка с прежней ценой; не сдвинулась — нет', () => {
    expect(priceMarkAfter(row({ priceCatalog: 100 }), 120)).toBe(100)
    expect(priceMarkAfter(row({ priceCatalog: 100 }), 100)).toBeUndefined()
  })

  it('непринятая прежняя отметка переносится как есть', () => {
    expect(priceMarkAfter(row({ priceCatalog: 120, priceCatalogPrev: 100 }), 120)).toBe(100)
  })

  it('у ФОТ-спутника и договорной трубы отметок не бывает', () => {
    expect(priceMarkAfter(row({ kind: 'ФОТ', priceCatalog: 1207.8 }), 1250)).toBeUndefined()
    expect(priceMarkAfter(row({ priceBinding: 'servicePipePrice', priceCatalog: null }), 5)).toBeUndefined()
  })
})

// План_устранения, 1.2: версию прайса поднимает и правка одной цены — к
// пересчёту зовёт расхождение цен, а не номер версии.
describe('пересчёт что-то изменит', () => {
  const summary: RepriceSummary = { changed: 0, changedUnderManual: 0, notFound: 0, fotRate: null, rateShifts: [] }

  it('сменится цена строки или ставка ФОТ — да', () => {
    expect(hasPriceDrift({ ...summary, changed: 1 })).toBe(true)
    expect(hasPriceDrift({ ...summary, changed: 1, changedUnderManual: 1 })).toBe(true)
    expect(hasPriceDrift({ ...summary, fotRate: { from: 1207.8, to: 1250 } })).toBe(true)
  })

  it('сдвинется ставка экономики или её источник — да', () => {
    const shift = { key: 'overheadRub' as const, from: 1584.73, to: 1584.73, fromFallback: true, toFallback: false }
    expect(hasPriceDrift({ ...summary, rateShifts: [shift] })).toBe(true)
  })

  it('позиций нет в прайсе, а остальное совпадает — нет: их цена не изменится', () => {
    expect(hasPriceDrift(summary)).toBe(false)
    expect(hasPriceDrift({ ...summary, notFound: 3 })).toBe(false)
  })

  it('прайс с новыми позициями, но прежними ценами строк — нет', () => {
    const tree = {
      priceListVersion: 2,
      sections: [{ id: 's', code: '1', title: 'Корпус', enabled: true, components: [
        { id: 'c', title: 'Узел', enabled: true, rows: [row({ id: 'a', name: 'Лист', priceCatalog: 200 })] },
      ] }],
    } as unknown as CalcTree
    const prices: PriceLookup = (_c, name) => ({ Лист: 200, Швеллер: 900 } as Record<string, number>)[name] ?? null

    expect(hasPriceDrift(repriceTree(tree, prices, 3).summary)).toBe(false)
  })
})

// План_устранения, 1.3: ставки экономики — в дереве; пересчёт берёт их из
// того же прайса, что и цены строк, и показывает сдвиг каждой.
describe('ставки экономики при пересчёте', () => {
  const V2 = { fotRub: 1000, overheadRub: 1500, acetoneRub: 100, ppeRub: 120 }
  const V5 = { ФОТ: 1300, 'Накладные расходы': 1500, Ацетон: 110, 'СИЗ и РМ': 120 }

  it('дерево получает ставки нового прайса; сдвинувшиеся — в сводке', () => {
    const { tree: next, summary } = repriceTree({ ...tree([]), rates: V2 }, prices(V5), 5)

    expect(next.rates).toEqual({ fotRub: 1300, overheadRub: 1500, acetoneRub: 110, ppeRub: 120 })
    expect(summary.rateShifts).toEqual([
      { key: 'fotRub', from: 1000, to: 1300, fromFallback: false, toFallback: false },
      { key: 'acetoneRub', from: 100, to: 110, fromFallback: false, toFallback: false },
    ])
    expect(hasPriceDrift(summary)).toBe(true)
  })

  it('дерево без ставок считалось по действующему прайсу — сдвига нет, ставки ставятся', () => {
    const { tree: next, summary } = repriceTree(tree([]), prices(V5), 5)

    expect(summary.rateShifts).toEqual([])
    expect(next.rates?.fotRub).toBe(1300)
  })

  it('позиция ставки появилась в прайсе — источник сменился, даже если число то же', () => {
    const prev = { ...V2, overheadRub: FALLBACK_RATES.overheadRub, fallback: ['overheadRub' as const] }
    const shifts = rateShifts(prev, { ...V2, overheadRub: FALLBACK_RATES.overheadRub })

    expect(shifts).toEqual([
      { key: 'overheadRub', from: FALLBACK_RATES.overheadRub, to: FALLBACK_RATES.overheadRub, fromFallback: true, toFallback: false },
    ])
  })
})
