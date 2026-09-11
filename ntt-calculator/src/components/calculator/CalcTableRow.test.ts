// @vitest-environment jsdom
/**
 * Ячейки ввода строки расчёта. Первый тест UI-слоя: баг «арифметика в колонке
 * Цена не работает» жил именно здесь — движок и его тесты были исправны, а
 * обработчик цены разбирал ввод через Number() в обход движка.
 *
 * Коммит ввода делается ОДНИМ `setValue`: он уже инициирует `change`, на
 * котором висит обработчик. Добавлять `trigger('change')` нельзя — получится
 * второй коммит, читающий уже пересинхронизированное поле.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { computeRow } from '@/engines/row'
import CalcTableRow from './CalcTableRow.vue'

const QTY_CALC = 6
const PRICE_CATALOG = 100

function makeRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'r1',
    kind: 'МАТЕРИАЛ',
    category: 'Труба',
    name: 'Труба GRP DN300',
    unit: 'м',
    qtyCalc: QTY_CALC,
    qtyManual: null,
    priceCatalog: PRICE_CATALOG,
    priceManual: null,
    enabled: true,
    isCustom: false,
    note: null,
    parentId: null,
    ...over,
  }
}

function mountRow(over: Partial<Record<string, unknown>> = {}) {
  const row = makeRow(over)
  return mount(CalcTableRow, {
    props: {
      row: row as never,
      res: computeRow(row as never),
      conflict: false,
      prevCalc: null,
      fotK: null,
      disabled: false,
    },
  })
}

const qtyCell = (w: ReturnType<typeof mountRow>) => w.findAll('input')[0]!
const priceCell = (w: ReturnType<typeof mountRow>) => w.findAll('input')[1]!
const value = (el: Element) => (el as HTMLInputElement).value

/** Единственное значение, ушедшее наверх событием `price`. */
async function enterPrice(text: string) {
  const w = mountRow()
  await priceCell(w).setValue(text)
  const events = w.emitted('price')
  expect(events, 'ожидался ровно один коммит цены').toHaveLength(1)
  return events![0]![1] as number | null
}

describe('CalcTableRow — ячейка цены', () => {
  it('принимает обычное число', async () => {
    expect(await enterPrice('1200')).toBe(1200)
  })

  it('принимает арифметическое выражение', async () => {
    expect(await enterPrice('1200*2')).toBe(2400)
    expect(await enterPrice('1200+300')).toBe(1500)
    expect(await enterPrice('(1000+200)*2')).toBe(2400)
  })

  it('принимает запятую как десятичный разделитель', async () => {
    expect(await enterPrice('1200,5')).toBe(1200.5)
    expect(await enterPrice('1200,5*2')).toBe(2401)
  })

  it('принимает ведущий «=» и разряды из отформатированного вывода', async () => {
    expect(await enterPrice('=1200*2')).toBe(2400)
    expect(await enterPrice('1 200')).toBe(1200)
    expect(await enterPrice(`1${' '}200*2`)).toBe(2400)
  })

  it('пустая строка сбрасывает override к цене прайса', async () => {
    expect(await enterPrice('')).toBeNull()
  })

  // План_устранения, 1.5: прежде «мусор» уходил наверх как null — цена молча
  // возвращалась к прайсу, а минус уменьшал себестоимость.
  it('неразобранная и отрицательная цена наверх не уходят — ячейка объясняет отказ', async () => {
    for (const [text, why] of [['abc', '«abc» не разобрано'], ['1200*', '«1200*» не разобрано'], ['-100', 'меньше нуля']]) {
      const w = mountRow()
      await priceCell(w).setValue(text)
      expect(w.emitted('price'), text).toBeUndefined()
      expect(priceCell(w).classes()).toContain('is-bad')
      expect(w.find('.c-note').text()).toBe(`цена не принята: ${why}`)
    }
  })

  it('следующий верный ввод снимает отметку отказа', async () => {
    const w = mountRow()
    await priceCell(w).setValue('-1')
    await priceCell(w).setValue('120')
    expect(w.emitted('price')).toEqual([['r1', 120]])
    expect(priceCell(w).classes()).not.toContain('is-bad')
  })

  it('сценарий со скриншота: «80000*2» в строке ФОТ', async () => {
    const w = mountRow({ unit: 'чел. ч', qtyCalc: 25.9, priceCatalog: 1207.8 })
    await priceCell(w).setValue('80000*2')
    expect(w.emitted('price')![0]![1]).toBe(160000)
  })
})

/**
 * Отвергнутый ввод обычно НЕ меняет состояние (null был и остался), поэтому
 * перерисовки не происходит и напечатанное застревает в поле — со скриншота:
 * «80000*2» осталось текстом, а сумма считалась по цене прайса.
 */
describe('CalcTableRow — поле не оставляет отвергнутый ввод', () => {
  it('мусор в цене откатывается к цене прайса', async () => {
    const w = mountRow()
    const cell = priceCell(w)
    await cell.setValue('abc')
    await flushPromises()
    expect(value(cell.element)).toBe('100')
  })

  it('мусор в количестве откатывается к расчётному', async () => {
    const w = mountRow()
    const cell = qtyCell(w)
    await cell.setValue('не число')
    await flushPromises()
    expect(value(cell.element)).toBe('6')
  })
})

describe('CalcTableRow — непринятое количество видно', () => {
  it('неразобранное выражение: как введено, ошибкой, в примечании — что в расчёте', () => {
    const w = mountRow({ qtyManual: '1,5*' })
    expect(value(qtyCell(w).element)).toBe('1,5*')
    expect(qtyCell(w).classes()).toContain('is-bad')
    expect(w.find('.c-note').text()).toBe('не разобрано · в расчёте 6')
    // ↺ — убрать непринятый ввод.
    expect(w.find('.c-qty .rst').exists()).toBe(true)
  })

  it('отрицательное количество не принято', () => {
    const w = mountRow({ qtyManual: '-5' })
    expect(value(qtyCell(w).element)).toBe('-5')
    expect(w.find('.c-note').text()).toBe('меньше нуля не принято · в расчёте 6')
  })

  it('ручная цена меньше нуля из сохранённого расчёта — отметка и ↺', () => {
    const w = mountRow({ priceManual: -100 })
    expect(priceCell(w).classes()).toContain('is-bad')
    expect(w.find('.c-note').text()).toBe('цена меньше нуля не принята · в расчёте 100')
    expect(w.find('.c-price .rst').exists()).toBe(true)
  })
})

describe('CalcTableRow — ячейка количества (регрессия)', () => {
  it('показывает расчётное значение и отдаёт наверх сырое выражение', async () => {
    const w = mountRow()
    const cell = qtyCell(w)
    expect(value(cell.element)).toBe('6')

    await cell.setValue('1,55*2+2,88*2')
    // Наверх уходит ВЫРАЖЕНИЕ — его хранит стор (Механика §5.1).
    expect(w.emitted('qty')![0]).toEqual(['r1', '1,55*2+2,88*2'])
  })

  it('после применения override ячейка показывает отформатированный результат', async () => {
    const w = mountRow({ qtyManual: '1,55*2+2,88*2' })
    expect(value(qtyCell(w).element)).toBe('8,86')
  })
})

/**
 * Отметка «цена была» — пересчёт по новой версии прайса сдвинул цену строки
 * (engines/reprice.ts). Инженер принимает новую цену или оставляет прежнюю.
 */
describe('CalcTableRow — цена сдвинулась при пересчёте по новому прайсу', () => {
  function mountDelta(over: Partial<Record<string, unknown>> = {}, props: Record<string, unknown> = {}) {
    const row = makeRow({ priceCatalog: 120, priceCatalogPrev: 100, ...over })
    return mount(CalcTableRow, {
      props: {
        row: row as never,
        res: computeRow(row as never),
        conflict: false,
        prevCalc: null,
        fotK: null,
        disabled: false,
        priceDelta: true,
        pricePrev: 100,
        ...props,
      },
    })
  }
  const button = (w: ReturnType<typeof mountDelta>, label: string) => w.find(`button[aria-label="${label}"]`)

  it('показывает прежнюю цену; ✓ принимает новую, ↶ оставляет прежнюю', async () => {
    const w = mountDelta()
    expect(w.text()).toContain('было 100 ₽')
    expect(priceCell(w as never).classes()).toContain('is-repriced')

    await button(w, 'Принять новую цену').trigger('click')
    await button(w, 'Оставить прежнюю цену').trigger('click')

    expect(w.emitted('acceptPrice')).toEqual([['r1']])
    expect(w.emitted('keepPrice')).toEqual([['r1']])
  })

  it('при ручной цене оставлять прежнюю нечего — только принять отметку', () => {
    const w = mountDelta({ priceManual: 90 })
    expect(button(w, 'Принять новую цену').exists()).toBe(true)
    expect(button(w, 'Оставить прежнюю цену').exists()).toBe(false)
    // Применяется ручная цена — ячейка синяя, а не отмеченная.
    expect(priceCell(w as never).classes()).toContain('is-ovr')
    expect(priceCell(w as never).classes()).not.toContain('is-repriced')
  })

  it('раньше цены не было — «было» без числа и без «оставить прежнюю»', () => {
    const w = mountDelta({ priceCatalogPrev: null }, { pricePrev: null })
    expect(w.text()).toContain('было —')
    expect(button(w, 'Оставить прежнюю цену').exists()).toBe(false)
  })

  it('наблюдателю видна отметка, но не действия', () => {
    const w = mountDelta({}, { readonly: true })
    expect(w.text()).toContain('было 100 ₽')
    expect(button(w, 'Принять новую цену').exists()).toBe(false)
  })
})

// План_устранения, 1.1: правки перенесены на строку с новым наименованием —
// ячейка конфликта называет прежнее наименование, а не число.
describe('строка со сменившимся наименованием', () => {
  it('показывает прежнее наименование и кнопки решения', () => {
    const row = makeRow({ priceManual: 41000, renamedFrom: 'Труба GRP DN250' })
    const w = mount(CalcTableRow, {
      props: { row: row as never, res: computeRow(row as never), conflict: true, prevCalc: null, fotK: null, disabled: false },
    })
    expect(w.find('.was').text()).toBe('было «Труба GRP DN250»')
    expect(w.findAll('button').some((b) => b.text() === 'Оставить моё')).toBe(true)
    expect(w.findAll('button').some((b) => b.text() === 'Принять новое')).toBe(true)
  })
})
