// @vitest-environment jsdom
/**
 * Сноски v-hint: когда появляются, когда прячутся и что показывают.
 */
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, withDirectives } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HINT_DELAY_MS, HINT_ID, hideHint, hintView, toHint, vHint, type HintValue } from './hint'

function host(tag: string, value: () => HintValue, modifiers: Record<string, boolean> = {}) {
  return defineComponent({
    setup() {
      return () => withDirectives(h(tag, { class: 'anchor' }, 'Подпись'), [[vHint, value(), '', modifiers]])
    },
  })
}

const pointer = (type: string, init: PointerEventInit = {}) =>
  new PointerEvent(type, { bubbles: false, pointerType: 'mouse', clientX: 40, ...init })

describe('сноска v-hint', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    hideHint()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('пункт: появляется после паузы и прячется при уходе указателя', async () => {
    const w = mount(host('span', () => 'Глубина от поверхности до лотка'), { attachTo: document.body })
    const el = w.find('.anchor').element
    el.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(HINT_DELAY_MS.item - 1)
    expect(hintView.hint).toBeNull()
    vi.advanceTimersByTime(1)
    expect(hintView.hint?.text).toBe('Глубина от поверхности до лотка')
    expect(el.getAttribute('aria-describedby')).toBe(HINT_ID)

    el.dispatchEvent(pointer('pointerleave'))
    expect(hintView.hint).toBeNull()
    expect(el.hasAttribute('aria-describedby')).toBe(false)
    w.unmount()
  })

  it('указатель ушёл до паузы — сноска не появляется', () => {
    const w = mount(host('span', () => 'текст'), { attachTo: document.body })
    const el = w.find('.anchor').element
    el.dispatchEvent(pointer('pointerenter'))
    el.dispatchEvent(pointer('pointerleave'))
    vi.advanceTimersByTime(HINT_DELAY_MS.row * 2)
    expect(hintView.hint).toBeNull()
    w.unmount()
  })

  // На сенсорном экране касание — это нажатие: сноска закрыла бы то, что нажимают.
  it('касание пальцем сноску не открывает', () => {
    const w = mount(host('span', () => 'текст'), { attachTo: document.body })
    w.find('.anchor').element.dispatchEvent(pointer('pointerenter', { pointerType: 'touch' }))
    vi.advanceTimersByTime(HINT_DELAY_MS.row)
    expect(hintView.hint).toBeNull()
    w.unmount()
  })

  it('строка: пауза длиннее и считается от остановки указателя', () => {
    const w = mount(host('div', () => ({ title: 'Строка' }), { row: true }), { attachTo: document.body })
    const el = w.find('.anchor').element
    el.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(HINT_DELAY_MS.row - 100)
    el.dispatchEvent(pointer('pointermove', { clientX: 300 }))
    vi.advanceTimersByTime(HINT_DELAY_MS.row - 100)
    expect(hintView.hint).toBeNull()
    vi.advanceTimersByTime(100)
    expect(hintView.hint?.title).toBe('Строка')
    expect(hintView.mode).toBe('row')
    expect(hintView.pointerX).toBe(300)
    w.unmount()
  })

  // Кнопка ↺ внутри строки расчёта: её сноска, а не сноска строки.
  it('кнопка со своей сноской внутри строки — показывается сноска кнопки', () => {
    const Row = defineComponent({
      setup() {
        return () =>
          withDirectives(h('div', { class: 'row' }, [withDirectives(h('button', { class: 'btn' }, '↺'), [[vHint, 'вернуть расчётное']])]), [
            [vHint, { title: 'Строка' }, '', { row: true }],
          ])
      },
    })
    const w = mount(Row, { attachTo: document.body })
    const btn = w.find('.btn').element
    w.find('.row').element.dispatchEvent(pointer('pointerenter'))
    btn.dispatchEvent(pointer('pointerenter'))
    // Движение над кнопкой всплывает к строке.
    btn.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: 50 }))
    vi.advanceTimersByTime(HINT_DELAY_MS.row)
    expect(hintView.hint?.text).toBe('вернуть расчётное')
    btn.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: 52 }))
    vi.advanceTimersByTime(HINT_DELAY_MS.row)
    expect(hintView.hint?.text).toBe('вернуть расчётное')
    w.unmount()
  })

  it('нажатие кнопки мыши, ввод с клавиатуры и прокрутка прячут сноску', () => {
    const w = mount(host('span', () => 'текст'), { attachTo: document.body })
    const el = w.find('.anchor').element
    for (const hideBy of [
      () => document.dispatchEvent(new PointerEvent('pointerdown')),
      () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })),
      () => document.dispatchEvent(new Event('scroll')),
    ]) {
      el.dispatchEvent(pointer('pointerenter'))
      vi.advanceTimersByTime(HINT_DELAY_MS.item)
      expect(hintView.hint).not.toBeNull()
      hideBy()
      expect(hintView.hint).toBeNull()
    }
    w.unmount()
  })

  // ОЛ пересчитывается при каждом вводе — открытая сноска показывает свежее.
  it('открытая сноска следует за изменившимся пояснением, пустое — прячет', async () => {
    const text = ref<string | null>('было')
    const w = mount(host('span', () => text.value), { attachTo: document.body })
    const el = w.find('.anchor').element
    el.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(HINT_DELAY_MS.item)
    text.value = 'стало'
    await nextTick()
    expect(hintView.hint?.text).toBe('стало')
    text.value = null
    await nextTick()
    expect(hintView.hint).toBeNull()
    w.unmount()
  })

  it('пункт исчез с экрана — его сноска тоже', () => {
    const w = mount(host('span', () => 'текст'), { attachTo: document.body })
    w.find('.anchor').element.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(HINT_DELAY_MS.item)
    w.unmount()
    expect(hintView.hint).toBeNull()
  })

  it('без пояснения нет ни сноски, ни пунктира', () => {
    const w = mount(host('span', () => ''), { attachTo: document.body })
    const el = w.find('.anchor')
    el.element.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(HINT_DELAY_MS.row)
    expect(hintView.hint).toBeNull()
    expect(el.attributes('data-hint')).toBeUndefined()
    expect(el.attributes('data-hint-mark')).toBeUndefined()
    w.unmount()
  })

  // Пунктир — знак сноски у подписи; у строк и кнопок его нет.
  it('пунктир — у текста; у строки, кнопки и с .plain — нет', () => {
    const mark = (tag: string, modifiers: Record<string, boolean> = {}) => {
      const w = mount(host(tag, () => 'текст', modifiers))
      const has = w.find('.anchor').attributes('data-hint-mark') !== undefined
      w.unmount()
      return has
    }
    expect(mark('span')).toBe(true)
    expect(mark('dt')).toBe(true)
    expect(mark('button')).toBe(false)
    expect(mark('div', { row: true })).toBe(false)
    expect(mark('span', { plain: true })).toBe(false)
    expect(mark('div', { mark: true })).toBe(true)
  })
})

describe('toHint', () => {
  it('пустые значения — сноски нет', () => {
    expect(toHint('')).toBeNull()
    expect(toHint('   ')).toBeNull()
    expect(toHint(null)).toBeNull()
    expect(toHint(false)).toBeNull()
    expect(toHint({ text: [' '], formula: [] })).toBeNull()
  })

  it('строка — текст сноски, объект — как есть', () => {
    expect(toHint('текст')).toEqual({ text: 'текст' })
    const hint = { title: 'SN', formula: 'SN = …' }
    expect(toHint(hint)).toBe(hint)
  })
})
