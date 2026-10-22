import { describe, expect, it } from 'vitest'
import { purchaseEstimateView } from './purchase-view'

const row = (category: string, extra: Record<string, unknown> = {}) => ({
  id: category, kind: 'МАТЕРИАЛ', category, name: 'x', unit: 'шт',
  qtyCalc: 2, qtyManual: null, priceCatalog: 100, priceManual: 150, ...extra,
})

const estimate = {
  id: 'e1', totalRub: 1_000_000, projectId: 'p1', snapshots: [{ version: 3 }],
  surveyData: {
    pumpPrice: 500_000,
    surveyRev: 4, treeSurveyRev: 3,
    totals: { salePriceRub: 1_000_000, markup: 0.43 },
    tree: {
      deviceType: 'KNS', survey: { pipePrice: 9000 }, rates: { fot: 800 }, lostEdits: [{ section: '1' }],
      sections: [{ id: 's1', components: [{ id: 'c1', rows: [
        row('Насосы'),
        row('ФОТ'),
        row('Покупное', { kind: 'ОПЕРАЦИЯ' }),
      ] }] }],
    },
  },
}

describe('расчёт глазами снабженца', () => {
  const view = purchaseEstimateView(estimate)
  const sd = view.surveyData as { tree: { survey: unknown; rates?: unknown; lostEdits?: unknown; sections: Array<{ components: Array<{ rows: Array<Record<string, unknown>> }> }> } }
  const rows = sd.tree.sections[0].components[0].rows

  it('без итогов, проекта, слепков и параметров ОЛ', () => {
    expect(view.totalRub).toBeNull()
    expect(view.projectId).toBeNull()
    expect(view.snapshots).toEqual([])
    expect(Object.keys(view.surveyData as object).sort()).toEqual(['surveyRev', 'tree', 'treeSurveyRev'])
    expect(sd.tree.survey).toEqual({})
    expect(sd.tree.rates).toBeUndefined()
    expect(sd.tree.lostEdits).toBeUndefined()
  })

  it('ревизии равны — фронт не пересобирает дерево', () => {
    expect((view.surveyData as Record<string, unknown>).surveyRev).toBe(3)
    expect((view.surveyData as Record<string, unknown>).treeSurveyRev).toBe(3)
  })

  it('закупаемая строка — только цена прайса; незакупаемая и операция — без цен', () => {
    expect(rows[0]).toMatchObject({ priceCatalog: 100, priceManual: null, qtyCalc: 2 })
    expect(rows[1]).toMatchObject({ priceCatalog: null, priceManual: null })
    expect(rows[2]).toMatchObject({ priceCatalog: null, priceManual: null })
  })

  it('исходный расчёт не меняется', () => {
    expect(estimate.surveyData.tree.sections[0].components[0].rows[0].priceManual).toBe(150)
  })

  it('расчёт без дерева — пустой ОЛ', () => {
    expect(purchaseEstimateView({ surveyData: { totals: {} } }).surveyData).toEqual({})
  })
})
