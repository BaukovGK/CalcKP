import { describe, expect, it } from 'vitest'
import { MIN_PASSWORD_LENGTH, passwordChangeErrorText, passwordFormError } from './password-form'

describe('форма смены пароля', () => {
  const ok = { current: 'старый-пароль', next: 'новый-пароль', repeat: 'новый-пароль' }

  it('заполненная верно форма уходит на сервер', () => {
    expect(passwordFormError(ok)).toBeNull()
  })

  it('без текущего пароля — нельзя', () => {
    expect(passwordFormError({ ...ok, current: '' })).toBe('Введите текущий пароль')
  })

  it('новый пароль короче минимума сервера — нельзя', () => {
    const short = 'x'.repeat(MIN_PASSWORD_LENGTH - 1)
    expect(passwordFormError({ ...ok, next: short, repeat: short })).toMatch(/не короче 8/)
  })

  it('повтор не совпал — нельзя', () => {
    expect(passwordFormError({ ...ok, repeat: 'новый-парол' })).toBe('Новый пароль и повтор не совпадают')
  })

  it('новый совпадает с текущим — нельзя', () => {
    expect(passwordFormError({ current: 'один-и-тот-же', next: 'один-и-тот-же', repeat: 'один-и-тот-же' })).toBe(
      'Новый пароль совпадает с текущим',
    )
  })
})

describe('ответ сервера на смену пароля', () => {
  const httpError = (data: unknown) => ({ response: { data } })

  it('коды сервера — словами пользователя', () => {
    expect(passwordChangeErrorText(httpError({ code: 'WRONG_PASSWORD', message: 'x' }))).toBe('Текущий пароль неверен')
    expect(passwordChangeErrorText(httpError({ code: 'SAME_PASSWORD' }))).toBe('Новый пароль совпадает с текущим')
  })

  it('прочее — текст сервера, а без ответа — про соединение', () => {
    expect(passwordChangeErrorText(httpError({ message: 'Ошибка валидации' }))).toBe('Ошибка валидации')
    expect(passwordChangeErrorText(new Error('Network Error'))).toMatch(/соединение/)
  })
})
