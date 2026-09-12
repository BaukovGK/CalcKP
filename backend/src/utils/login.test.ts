/**
 * Логин — латиницей: адрес в русской раскладке не заводится, иначе учётная
 * запись выглядит настоящей, а войти в неё нельзя (поле входа кириллицу не
 * принимает).
 */
import { describe, expect, it } from 'vitest'
import { isLatinLogin } from './login'

describe('логин латиницей', () => {
  it('обычные адреса проходят', () => {
    expect(isLatinLogin('admin@ntt.local')).toBe(true)
    expect(isLatinLogin('user.name+tag-1@sub.example.com')).toBe(true)
  })

  it('кириллица — нет, даже одна буква', () => {
    expect(isLatinLogin('админ@ntt.local')).toBe(false)
    expect(isLatinLogin('аdmin@ntt.local')).toBe(false) // первая «а» русская
    expect(isLatinLogin('admin@ntt.локал')).toBe(false)
  })

  it('пробел и пустая строка — нет', () => {
    expect(isLatinLogin('ad min@ntt.local')).toBe(false)
    expect(isLatinLogin('')).toBe(false)
  })
})
