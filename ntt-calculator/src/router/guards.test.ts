/**
 * Заслон обязательной смены пароля (План_устранения 2.1).
 */
import { describe, expect, it } from 'vitest'
import { passwordGate } from './guards'

describe('заслон обязательной смены пароля', () => {
  it('пароль задан не самим пользователем — любой экран ведёт на смену и помнит, куда шли', () => {
    expect(passwordGate(true, { name: 'project', fullPath: '/projects/p1' })).toEqual({ name: 'password', query: { redirect: '/projects/p1' } })
    expect(passwordGate(true, { name: 'dashboard', fullPath: '/' })).toEqual({ name: 'password', query: {} })
  })

  it('на экране смены — остаётся', () => {
    expect(passwordGate(true, { name: 'password', fullPath: '/password' })).toBeNull()
  })

  it('пароль свой — экран смены без повода ведёт на главный, остальные открыты', () => {
    expect(passwordGate(false, { name: 'password', fullPath: '/password' })).toEqual({ name: 'dashboard' })
    expect(passwordGate(false, { name: 'prices', fullPath: '/prices' })).toBeNull()
  })
})
