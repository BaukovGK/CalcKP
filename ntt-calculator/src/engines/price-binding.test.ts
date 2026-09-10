/**
 * Цены трубы и насоса из сохранённого дерева — для полей ОЛ.
 *
 * Дефект, который держат эти тесты: у расчётов, где цену трубы вводили в
 * самом расчёте до появления поля ОЛ, первый пересчёт из ОЛ собирал дерево с
 * пустым полем — цена трубы пропадала, итог падал на сотни тысяч.
 */
import { describe, expect, it } from 'vitest'
import { boundPricesFromTree } from './price-binding'
import { stableStringify } from '@/composables/useSurveySync'

const pipeRow = (priceManual: number | null, extra: Record<string, unknown> = {}) => ({
  kind: 'МАТЕРИАЛ', category: 'Собственное производство', name: 'Труба СК/НПС-К 3000-0,1-12000',
  unit: 'м', bucket: 'Труба, муфта', priceManual, ...extra,
})

describe('boundPricesFromTree', () => {
  it('берёт цену строк, помеченных связью', () => {
    const tree = {
      sections: [
        { code: '1', components: [{ rows: [pipeRow(21_313, { priceBinding: 'pipePrice' })] }] },
        { code: '7', components: [{ rows: [{ category: 'Насосы, АТМ', unit: 'шт', priceManual: 250_000, priceBinding: 'pumpPrice' }] }] },
      ],
    }
    expect(boundPricesFromTree(tree)).toEqual({ pipePrice: '21313', pumpPrice: '250000' })
  })

  it('узнаёт трубу и насос в дереве, построенном до появления связи', () => {
    // Сегменты «трубы частями» — та же труба с тем же именем: брать надо
    // первую строку раздела 1, трубу корпуса, а не сегмент.
    const tree = {
      sections: [
        {
          code: '1',
          components: [
            { rows: [pipeRow(21_313), { kind: 'ОПЕРАЦИЯ', unit: 'чел. ч', priceManual: null }] },
            { rows: [pipeRow(12_321), pipeRow(1_231)] },
          ],
        },
        { code: '7', components: [{ rows: [{ category: 'Насосы, АТМ', unit: 'шт', priceManual: 12_312 }] }] },
      ],
    }
    expect(boundPricesFromTree(tree)).toEqual({ pipePrice: '21313', pumpPrice: '12312' })
  })

  it('цена трубы шахты или горловины — своё поле, не цена корпуса', () => {
    const shaft = (extra: Record<string, unknown> = {}) => ({ ...pipeRow(9_800), name: 'Труба СК/НПС-К 1200-0,1-5000', ...extra })
    const marked = {
      sections: [{
        code: '1',
        components: [
          { nodeCode: 'A1', rows: [pipeRow(21_313, { priceBinding: 'pipePrice' })] },
          { nodeCode: 'A8', rows: [shaft({ priceBinding: 'servicePipePrice' })] },
        ],
      }],
    }
    expect(boundPricesFromTree(marked)).toEqual({ pipePrice: '21313', servicePipePrice: '9800' })

    // Дерево до появления связи: трубу шахты узнаём по узлу A8, и труба
    // корпуса остаётся первой строкой раздела.
    const legacy = {
      sections: [{
        code: '1',
        components: [
          { nodeCode: 'A1', rows: [pipeRow(21_313)] },
          { nodeCode: 'A8', rows: [shaft()] },
        ],
      }],
    }
    expect(boundPricesFromTree(legacy)).toEqual({ pipePrice: '21313', servicePipePrice: '9800' })
  })

  it('пустые цены в поля не переносит', () => {
    const tree = { sections: [{ code: '1', components: [{ rows: [pipeRow(null)] }] }] }
    expect(boundPricesFromTree(tree)).toEqual({})
  })

  it('на мусоре не падает', () => {
    expect(boundPricesFromTree(null)).toEqual({})
    expect(boundPricesFromTree({})).toEqual({})
    expect(boundPricesFromTree({ sections: [{ code: '1' }] })).toEqual({})
  })
})

describe('stableStringify — подпись нагрузки ОЛ', () => {
  it('не зависит от порядка ключей: jsonb хранит их по-своему', () => {
    // Без этого ОЛ сохранял бы себя при каждом открытии: сохранённое и то же
    // самое, собранное формой, давали бы разные строки.
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }))
      .toBe(stableStringify({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }))
  })

  it('различает разные значения', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }))
    expect(stableStringify({ a: '1' })).not.toBe(stableStringify({ a: 1 }))
  })

  it('отсутствующий ключ и undefined — одно и то же', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }))
  })
})
