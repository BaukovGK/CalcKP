/**
 * ФИО в документах: инициалы выводятся из имени учётной записи, а уже
 * сокращённое имя не переставляется.
 */
import { describe, expect, it } from 'vitest'
import { shortName, signatureName } from './person'

describe('ФИО в документах', () => {
  it('исполнитель — фамилия и инициалы, подпись — инициалы и фамилия', () => {
    expect(shortName('Иванов Сергей Владимирович')).toBe('Иванов С.В.')
    expect(signatureName('Иванов Сергей Владимирович')).toBe('С.В. Иванов')
    expect(shortName('Князев Владимир Алексеевич')).toBe('Князев В.А.')
  })

  it('имя без отчества сокращается по тому же правилу', () => {
    expect(shortName('Иванов Сергей')).toBe('Иванов С.')
    expect(signatureName('Иванов Сергей')).toBe('С. Иванов')
  })

  it('уже сокращённое имя остаётся как есть', () => {
    expect(shortName('Иванов С.В.')).toBe('Иванов С.В.')
    expect(signatureName('С.В. Иванов')).toBe('С.В. Иванов')
  })

  it('одно слово — не ФИО: «Администратор» не превращается в «А.»', () => {
    expect(shortName('Администратор')).toBe('Администратор')
    expect(signatureName('Администратор')).toBe('Администратор')
  })

  it('пусто и лишние пробелы', () => {
    expect(shortName(null)).toBeNull()
    expect(shortName('   ')).toBeNull()
    expect(shortName('  Иванов   Сергей  Владимирович ')).toBe('Иванов С.В.')
  })
})
