import { describe, expect, it } from 'vitest'
import { hasPriceDelta, isContractualRow, priceMarkAfter, repriceTree, type PriceLookup } from './reprice'
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
