// @vitest-environment jsdom
/**
 * Логин вводится латиницей: кириллица в поле не попадает, а поле объясняет,
 * что дело в раскладке.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  hasNonLatin,
  installLatinGuard,
  LATIN_BLOCKED_EVENT,
  sanitizeLatin,
} from './latin-input'

let uninstall: (() => void) | null = null

afterEach(() => {
  uninstall?.()
  uninstall = null
  document.body.innerHTML = ''
})

/** Поле логина под правилом, с записью событий «ввод отклонён». */
function field() {
  uninstall = installLatinGuard(document)
  document.body.innerHTML = '<input data-latin />'
  const el = document.body.querySelector('input')!
  const blocked: boolean[] = []
  el.addEventListener(LATIN_BLOCKED_EVENT, (e) => blocked.push((e as CustomEvent<{ blocked: boolean }>).detail.blocked))
  return { el, blocked }
}

/** Набор символа с клавиатуры: beforeinput, а следом — input, если пропустили. */
function type(el: HTMLInputElement, text: string) {
  const ev = new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true })
  el.dispatchEvent(ev)
  if (ev.defaultPrevented) return
  el.value += text
  el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }))
}

describe('логин — только латиница', () => {
  it('лишние символы вычищаются, латиница и знаки адреса остаются', () => {
    expect(sanitizeLatin('admin@ntt.local')).toBe('admin@ntt.local')
    expect(sanitizeLatin('фвьшт@тее.дщсфд')).toBe('@.')
    expect(sanitizeLatin('ad min')).toBe('admin')
    expect(sanitizeLatin('user.name+tag-1@sub.example.com')).toBe('user.name+tag-1@sub.example.com')
  })

  it('нелатиница узнаётся в строке', () => {
    expect(hasNonLatin('admin@ntt.local')).toBe(false)
    expect(hasNonLatin('админ@ntt.local')).toBe(true)
  })

  it('кириллица с клавиатуры в поле не появляется', () => {
    const { el, blocked } = field()
    type(el, 'ф')
    expect(el.value).toBe('')
    expect(blocked).toEqual([true])
  })

  it('латиница печатается и снимает отметку об отклонении', () => {
    const { el, blocked } = field()
    type(el, 'ф')
    type(el, 'a')
    expect(el.value).toBe('a')
    expect(blocked).toEqual([true, false])
  })

  it('смесь при вставке чистится, а не отбрасывается целиком', () => {
    const { el, blocked } = field()
    el.value = 'adminф@ntt.local'
    el.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }))
    expect(el.value).toBe('admin@ntt.local')
    expect(blocked).toEqual([true])
  })

  it('каждая верная буква не шлёт событие заново — подсказке не от чего мигать', () => {
    const { el, blocked } = field()
    for (const ch of 'admin') type(el, ch)
    expect(el.value).toBe('admin')
    expect(blocked).toEqual([])
  })

  it('поля без пометки правило не трогает — пароль остаётся любым', () => {
    uninstall = installLatinGuard(document)
    document.body.innerHTML = '<input type="password" />'
    const el = document.body.querySelector('input')!
    type(el, 'пароль')
    expect(el.value).toBe('пароль')
  })
})
