import { describe, expect, it } from 'vitest'
import { defaultTerms, deliveryFromSurvey, deliveryPlace, priceTerm } from './kp-terms'

const issued = new Date('2026-11-17T10:00:00Z')
const env = { KP_WAREHOUSE: 'г. Пересвет, ул. Тестовая, 1' } as NodeJS.ProcessEnv

/** Опросный лист КНС с итогом раздела «Доставка». */
const survey = (delivery: Record<string, unknown>, form: Record<string, unknown> = {}) => ({ delivery, form })

describe('КП: пункт 1 о доставке', () => {
  it('стоимость по тарифам — включает доставку до выбранного города', () => {
    const d = deliveryFromSurvey(survey({ city: 'Москва', costRub: 287900, manualRub: null }))
    expect(d).toEqual({ included: true, to: 'г. Москва' })
    const terms = defaultTerms(issued, { deliveryTo: 'Объект', delivery: d, env })
    expect(priceTerm(terms)).toBe(
      'Цены приведены с учётом НДС 22 %. Стоимость включает доставку со склада поставщика ' +
        '(г. Пересвет, ул. Тестовая, 1) до г. Москва.',
    )
  })

  it('своя стоимость — доставка до введённого адреса', () => {
    const d = deliveryFromSurvey(
      survey({ city: 'Санкт-Петербург', costRub: 650000, manualRub: 650000 }, { deliveryAddress: 'г. Колпино, ул. Заводская, 5' }),
    )
    expect(d).toEqual({ included: true, to: 'г. Колпино, ул. Заводская, 5' })
  })

  it('своя стоимость без адреса — до города', () => {
    expect(deliveryFromSurvey(survey({ city: 'Тула', costRub: 1, manualRub: 1 }))).toEqual({ included: true, to: 'г. Тула' })
  })

  it('город не выбран — доставка не входит', () => {
    const d = deliveryFromSurvey(survey({ city: null, costRub: null, manualRub: null }))
    expect(d).toEqual({ included: false, to: null })
    expect(priceTerm(defaultTerms(issued, { delivery: d, env }))).toBe(
      'Цены приведены с учётом НДС 22 %. Доставка в стоимость не входит: отгрузка со склада поставщика ' +
        '(г. Пересвет, ул. Тестовая, 1), стоимость доставки до объекта рассчитывается отдельно по запросу.',
    )
  })

  it('город выбран, но ставки нет и суммы нет — не входит', () => {
    expect(deliveryFromSurvey(survey({ city: 'Тюмень', costRub: null, manualRub: null }))?.included).toBe(false)
  })

  it('листа без раздела «Доставка» — прежняя формулировка слово в слово', () => {
    expect(deliveryFromSurvey({ form: {} })).toBeNull()
    const terms = defaultTerms(issued, { deliveryTo: 'ГКБ №52, ул. Пехотная, 3', delivery: null, env })
    expect(terms.deliveryIncluded).toBeNull()
    expect(priceTerm(terms)).toBe(
      'Цены приведены с учётом НДС 22 % и доставкой на объект: ГКБ №52, ул. Пехотная, 3. ' +
        'Стоимость самовывоза со склада поставщика (г. Пересвет, ул. Тестовая, 1) в цену не входит.',
    )
  })

  it('«г.» — только к городу, не к области, краю и станции', () => {
    expect(deliveryPlace('Москва')).toBe('г. Москва')
    expect(deliveryPlace('Новый Уренгой')).toBe('г. Новый Уренгой')
    expect(deliveryPlace('Пермский край')).toBe('Пермский край')
    expect(deliveryPlace('Солнечногорск, МО')).toBe('Солнечногорск, МО')
    expect(deliveryPlace('Ириклинская ГРЭС')).toBe('Ириклинская ГРЭС')
    expect(deliveryPlace('Санкт-Петербург - Пересвет')).toBe('Санкт-Петербург - Пересвет')
    expect(deliveryPlace('г. Тверь')).toBe('г. Тверь')
  })
})
