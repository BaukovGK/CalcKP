/**
 * ФИО в документах — правило то же, что на сервере
 * (`backend/src/utils/person.ts`): экран настроек показывает сотруднику, как
 * его имя будет напечатано в КП, и обещать он должен ровно то, что напечатает
 * бэкенд.
 */
import { describe, expect, it } from 'vitest'
import { shortName } from './person-name'

describe('ФИО для документа', () => {
  it('фамилия и инициалы', () => {
    expect(shortName('Иванов Сергей Владимирович')).toBe('Иванов С.В.')
    expect(shortName('Князев Владимир Алексеевич')).toBe('Князев В.А.')
    expect(shortName('Иванов Сергей')).toBe('Иванов С.')
  })

  it('уже сокращённое и не-ФИО остаются как есть', () => {
    expect(shortName('Иванов С.В.')).toBe('Иванов С.В.')
    expect(shortName('Администратор')).toBe('Администратор')
  })

  it('пусто и лишние пробелы', () => {
    expect(shortName(null)).toBeNull()
    expect(shortName('   ')).toBeNull()
    expect(shortName('  Иванов   Сергей  Владимирович ')).toBe('Иванов С.В.')
  })
})
