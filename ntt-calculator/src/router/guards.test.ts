/**
 * Заслон обязательной смены пароля (План_устранения 2.1).
 */
import { describe, expect, it } from 'vitest'
import { homeRedirect, passwordGate } from './guards'

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

// План_устранения 3.7: снабженец входит в прайс, но проекты открывает сам —
// прежде роутер отбрасывал его с проектов обратно в прайс, и заявку по чужому
// расчёту было не найти.
describe('домашний экран роли', () => {
  const dash = { name: 'dashboard' }
  const fromLogin = { name: 'login', matched: [{}] } as never
  const firstLoad = { name: undefined, matched: [] } as never
  const fromPrices = { name: 'prices', matched: [{}] } as never

  it('снабженец после входа и при первой загрузке — в прайс', () => {
    expect(homeRedirect('BUYER', dash, fromLogin)).toEqual({ name: 'prices' })
    expect(homeRedirect('BUYER', dash, firstLoad)).toEqual({ name: 'prices' })
  })

  it('снабженец из прайса в проекты — пускает', () => {
    expect(homeRedirect('BUYER', dash, fromPrices)).toBeNull()
  })

  it('технологу проекты бесполезны — всегда в шаблоны; остальным — проекты', () => {
    expect(homeRedirect('TECHNOLOG', dash, fromPrices)).toEqual({ name: 'templates' })
    expect(homeRedirect('ENGINEER', dash, fromLogin)).toBeNull()
    expect(homeRedirect('BUYER', { name: 'prices' }, fromLogin)).toBeNull()
  })
})
