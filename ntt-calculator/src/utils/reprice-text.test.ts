import { describe, expect, it } from 'vitest'
import { costShiftText, pluralRu, repricedToastText, repriceSummaryText, type RepricePreview } from './reprice-text'

/** Разряды ru-RU разделены неразрывными пробелами — сравниваем с обычными. */
const plain = (t: string) => t.replace(/[\u00a0\u202f]/g, ' ')

type PreviewOver = Omit<Partial<RepricePreview>, 'summary'> & { summary?: Partial<RepricePreview['summary']> }

const preview = (over: PreviewOver = {}): RepricePreview => ({
  costBefore: 1_000_000,
  costAfter: 1_020_000,
  saleBefore: 1_430_000,
  saleAfter: 1_458_600,
  ...over,
  summary: { changed: 0, changedUnderManual: 0, notFound: 0, fotRate: null, ...over.summary },
})

describe('тексты пересчёта по новому прайсу', () => {
  it('сколько строк сменит цену и что будет с итогами', () => {
    const t = plain(repriceSummaryText(preview({ summary: { changed: 37 } })))
    expect(t).toContain('Изменится цена 37 строк')
    expect(t).toContain('себестоимость 1 000 000 ₽ → 1 020 000 ₽ (+2 %)')
    expect(t).toContain('цена продажи 1 430 000 ₽ → 1 458 600 ₽')
  })

  it('сдвиг ставки ФОТ, ручные цены и позиции, которых нет в новом прайсе', () => {
    const t = plain(
      repriceSummaryText(preview({ summary: { changed: 2, changedUnderManual: 1, notFound: 3, fotRate: { from: 1207.8, to: 1250 } } })),
    )
    expect(t).toContain('цена 2 строк и ставка ФОТ 1 207,8 → 1 250 ₽')
    expect(t).toContain('У 1 из них стоит ручная цена — она останется.')
    expect(t).toContain('3 позиций нет в новом прайсе')
  })

  it('цены не сдвинулись — пересчёт только отметит версию', () => {
    expect(repriceSummaryText(preview({ costAfter: 1_000_000 }))).toContain('пересчёт только отметит версию')
  })

  it('крошечный сдвиг не выдаётся за «+0 %»', () => {
    expect(costShiftText(4_948_826, 4_948_946)).toBe('рост менее 0,1 %')
    expect(costShiftText(100, 90)).toBe('−10 %'.replace('−', '-'))
    expect(costShiftText(100, 100)).toBe('без изменений')
  })

  it('склонения и тост', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => pluralRu(n, 'строки', 'строк', 'строк'))).toEqual([
      'строки', 'строк', 'строк', 'строк', 'строки', 'строк', 'строк',
    ])
    expect(repricedToastText(1, 5)).toBe('Цены пересчитаны по прайсу v5: изменилась цена 1 строки')
    expect(repricedToastText(0, 5)).toBe('Расчёт отмечен прайсом v5: цены строк не изменились')
  })
})
