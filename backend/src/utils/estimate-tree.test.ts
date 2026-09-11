import { describe, expect, it } from 'vitest'
import { treePriceListVersion } from './estimate-tree'

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
