// @vitest-environment jsdom
/**
 * Числовые поля: текст в них не попадает.
 *
 * Держит дефект: поле, которое превращается в число, принимало «двадцать» или
 * «договорная», парсер отвечал null — и ввод молча становился «пусто»:
 * цена трубы пропадала из расчёта, а инженер видел в поле свой текст.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { INVALID_HINT, installNumericGuard, isNumericValid, sanitizeNumeric } from './numeric-input'

describe('sanitizeNumeric', () => {
  it('убирает буквы и прочий текст, оставляя число', () => {
    expect(sanitizeNumeric('12а5,5 руб')).toBe('125,5 ')
    expect(sanitizeNumeric('договорная')).toBe('')
    expect(sanitizeNumeric('≈150')).toBe('150')
  })

  it('не трогает то, что понимает парсер выражений', () => {
    for (const ok of ['12,5', '12.5', '980 000', '1,55*2+2,88*2', '(3+4)/2', '=980 000', '-5']) {
      expect(sanitizeNumeric(ok)).toBe(ok)
    }
    // Неразрывный пробел — его даёт вставка числа, отформатированного ru-RU.
    // Литералом он неотличим от пробела, поэтому записан escape-ом.
    expect(sanitizeNumeric('980\u00A0000')).toBe('980\u00A0000')
    expect(sanitizeNumeric('980\u202F000')).toBe('980\u202F000')
  })
})

describe('isNumericValid', () => {
  it('пусто и числа — допустимо', () => {
    for (const ok of ['', '  ', '12,5', '980 000', '2*3,1', '=5']) expect(isNumericValid(ok)).toBe(true)
  })

  it('то, что не разбирается в число, — нет', () => {
    for (const bad of ['2**3', '(', '1 2', 'abc']) expect(isNumericValid(bad)).toBe(false)
  })
})

describe('installNumericGuard', () => {
  let uninstall: () => void
  let input: HTMLInputElement
  /** Что увидел бы v-model поля: он слушает событие на самом элементе. */
  let seen: string[]

  beforeEach(() => {
    uninstall = installNumericGuard(document)
    input = document.createElement('input')
    input.className = 'num'
    document.body.appendChild(input)
    seen = []
    input.addEventListener('input', () => seen.push(input.value))
  })

  afterEach(() => {
    uninstall()
    input.remove()
  })

  const type = (value: string) => {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('модель получает значение уже без текста', () => {
    type('2а5 000')
    expect(seen).toEqual(['25 000'])
    expect(input.value).toBe('25 000')
  })

  it('буква с клавиатуры не вставляется вовсе', () => {
    const letter = new InputEvent('beforeinput', { data: 'ж', inputType: 'insertText', cancelable: true, bubbles: true })
    const digit = new InputEvent('beforeinput', { data: '7', inputType: 'insertText', cancelable: true, bubbles: true })
    input.dispatchEvent(letter)
    input.dispatchEvent(digit)
    expect(letter.defaultPrevented).toBe(true)
    expect(digit.defaultPrevented).toBe(false)
  })

  it('смесь цифр и букв целиком не отвергается — её вычистит input', () => {
    // Вставка «2а7б000руб» одним куском (буфер, диктовка): отказ целиком
    // потерял бы и цифры. Пропускаем, а лишнее убирает обработчик input.
    const mixed = new InputEvent('beforeinput', { data: '2а7б000руб', inputType: 'insertText', cancelable: true, bubbles: true })
    input.dispatchEvent(mixed)
    expect(mixed.defaultPrevented).toBe(false)
    type('2а7б000руб')
    expect(input.value).toBe('27000')
  })

  it('неразобранное выражение подсвечивается и объясняет, что не так', () => {
    input.title = 'ƒ формула поля'
    type('2**3')
    expect(input.classList.contains('is-invalid')).toBe(true)
    expect(input.title).toBe(INVALID_HINT)

    // Исправили — подсветка уходит, своя подсказка поля возвращается.
    type('6')
    expect(input.classList.contains('is-invalid')).toBe(false)
    expect(input.title).toBe('ƒ формула поля')
  })

  it('текстовые поля не трогает', () => {
    const text = document.createElement('input')
    document.body.appendChild(text)
    text.value = 'АО «ГК «ЕКС»'
    text.dispatchEvent(new Event('input', { bubbles: true }))
    expect(text.value).toBe('АО «ГК «ЕКС»')
    text.remove()
  })

  it('поле с data-numeric стережётся так же, как с классом num', () => {
    const cf = document.createElement('input')
    cf.dataset.numeric = ''
    document.body.appendChild(cf)
    cf.value = 'пять5'
    cf.dispatchEvent(new Event('input', { bubbles: true }))
    expect(cf.value).toBe('5')
    cf.remove()
  })
})
