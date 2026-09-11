import { describe, expect, it } from 'vitest'
import {
  isRowNegative,
  rowsWithNegativeSum,
  treeBuiltinRevision,
  treePriceListVersion,
  treeRateFallbacks,
  treeTemplateVersion,
} from './estimate-tree'

describe('версия прайса сохранённого дерева', () => {
  // Расчёт, собранный по прайсу v2 и не пересчитанный после импорта v5,
  // уходил в КП с подписью «прайс v5» при ценах v2.
  it('берётся из дерева — версия, по которой посчитаны цены строк', () => {
    expect(treePriceListVersion({ tree: { priceListVersion: 2, sections: [] } })).toBe(2)
  })

  it('без дерева или без версии — null: снапшот возьмёт действующую', () => {
    expect(treePriceListVersion(null)).toBeNull()
    expect(treePriceListVersion({})).toBeNull()
    expect(treePriceListVersion({ bundles: [] })).toBeNull()
    expect(treePriceListVersion({ tree: { sections: [] } })).toBeNull()
  })

  it('мусор вместо версии не принимается', () => {
    expect(treePriceListVersion({ tree: { priceListVersion: '3' } })).toBeNull()
    expect(treePriceListVersion({ tree: { priceListVersion: 0 } })).toBeNull()
    expect(treePriceListVersion({ tree: { priceListVersion: 2.5 } })).toBeNull()
  })
})

describe('версия шаблона сохранённого дерева', () => {
  it('0 — встроенный шаблон, N — опубликованная технологом версия', () => {
    expect(treeTemplateVersion({ tree: { templateVersion: 0, sections: [] } })).toBe(0)
    expect(treeTemplateVersion({ tree: { templateVersion: 3, sections: [] } })).toBe(3)
  })

  it('дерево до редактора шаблонов и мусор — null', () => {
    expect(treeTemplateVersion({ tree: { sections: [] } })).toBeNull()
    expect(treeTemplateVersion({ tree: { templateVersion: -1 } })).toBeNull()
    expect(treeTemplateVersion({ tree: { templateVersion: '2' } })).toBeNull()
    expect(treeTemplateVersion(null)).toBeNull()
  })
})

describe('редакция встроенного шаблона сохранённого дерева', () => {
  it('берётся из дерева — редакция кода, которым собран состав', () => {
    expect(treeBuiltinRevision({ tree: { builtinRevision: 3, templateVersion: 0, sections: [] } })).toBe(3)
  })

  it('дерево до учёта редакций и мусор — null', () => {
    expect(treeBuiltinRevision({ tree: { templateVersion: 2, sections: [] } })).toBeNull()
    expect(treeBuiltinRevision({ tree: { builtinRevision: 0 } })).toBeNull()
    expect(treeBuiltinRevision({ tree: { builtinRevision: 1.5 } })).toBeNull()
    expect(treeBuiltinRevision({ tree: { builtinRevision: '4' } })).toBeNull()
    expect(treeBuiltinRevision(undefined)).toBeNull()
  })
})

// План_устранения, 1.3 / решение Р5: КП не выпускается по ставкам, взятым
// константами программы, — сервер видит их по отметке в дереве.
describe('ставки экономики не из прайса', () => {
  it('отметки дерева читаются', () => {
    expect(treeRateFallbacks({ tree: { rates: { fotRub: 1, fallback: ['overheadRub', 'ppeRub'] } } })).toEqual(['overheadRub', 'ppeRub'])
  })

  it('нет ставок, нет отметок или мусор — пусто', () => {
    expect(treeRateFallbacks(null)).toEqual([])
    expect(treeRateFallbacks({ tree: { sections: [] } })).toEqual([])
    expect(treeRateFallbacks({ tree: { rates: { fotRub: 1 } } })).toEqual([])
    expect(treeRateFallbacks({ tree: { rates: { fallback: ['другое', 7, 'acetoneRub'] } } })).toEqual(['acetoneRub'])
  })
})

// План_устранения, 1.5 / решение Р4: строка с отрицательной суммой уменьшала
// себестоимость и пропадала из печатной спецификации — КП с ней не выпускается.
describe('строки с отрицательной суммой', () => {
  it('минус в количестве или в цене — отрицательная сумма', () => {
    expect(isRowNegative({ id: 'a', name: 'Скидка', unit: 'шт', qtyResolved: -5, priceCatalog: 100 })).toBe(true)
    expect(isRowNegative({ id: 'b', name: 'Задвижка', unit: 'шт', qtyCalc: 2, priceManual: -100 })).toBe(true)
    expect(isRowNegative({ id: 'c', name: 'Болт', unit: 'шт', qtyManual: '-3', priceCatalog: 6 })).toBe(true)
  })

  it('нулевые, без цены, выключенные и обычные строки — нет', () => {
    expect(isRowNegative({ id: 'a', name: 'Болт', unit: 'шт', qtyCalc: 0, priceCatalog: 6 })).toBe(false)
    expect(isRowNegative({ id: 'b', name: 'Шкаф', unit: 'шт', qtyCalc: 1, priceCatalog: null })).toBe(false)
    expect(isRowNegative({ id: 'c', name: 'Скидка', unit: 'шт', qtyResolved: -5, priceCatalog: 100, enabled: false })).toBe(false)
    expect(isRowNegative({ id: 'd', name: 'Болт', unit: 'шт', qtyCalc: 4, priceCatalog: 6 })).toBe(false)
  })

  it('в выключенном разделе строка в итог не входит', () => {
    const surveyData = {
      tree: {
        sections: [
          { enabled: false, components: [{ rows: [{ id: 'off', name: 'Скидка', unit: 'шт', qtyResolved: -1, priceCatalog: 10 }] }] },
          { components: [{ rows: [{ id: 'on', name: 'Скидка', unit: 'шт', qtyResolved: -1, priceCatalog: 10 }] }] },
        ],
      },
    }
    expect(rowsWithNegativeSum(surveyData).map((r) => r.id)).toEqual(['on'])
  })
})
