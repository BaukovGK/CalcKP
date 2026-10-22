/**
 * Правила ролей (ТЗ §2). Снабженец ведёт заявку на закупку по любому расчёту
 * (решение Р8), но проекты и цены продажи ему закрыты.
 */
import { describe, expect, it } from 'vitest'
import {
  canAccessEstimate, canReadEstimate, canReadForPurchase, canSeeProjects,
  seesAllEstimates, seesAllProjects,
} from './access'

describe('доступ к расчётам и проектам', () => {
  it('снабженец читает чужой расчёт только для заявки и не правит его', () => {
    expect(canReadForPurchase('BUYER', 'author', 'buyer')).toBe(true)
    expect(canReadEstimate('BUYER', 'author', 'buyer')).toBe(false)
    expect(canAccessEstimate('BUYER', 'author', 'buyer')).toBe(false)
  })

  it('снабженцу проекты закрыты целиком', () => {
    expect(canSeeProjects('BUYER')).toBe(false)
    expect(seesAllProjects('BUYER')).toBe(false)
    for (const role of ['ADMIN', 'MANAGER', 'ENGINEER', 'VIEWER']) expect(canSeeProjects(role)).toBe(true)
  })

  it('наблюдатель видит все расчёты и проекты', () => {
    for (const role of ['ADMIN', 'MANAGER', 'VIEWER']) {
      expect(seesAllEstimates(role)).toBe(true)
      expect(seesAllProjects(role)).toBe(true)
    }
    expect(seesAllEstimates('BUYER')).toBe(true)
    expect(seesAllEstimates('ENGINEER')).toBe(false)
    expect(seesAllProjects('TECHNOLOG')).toBe(false)
  })

  it('инженер — только свои расчёты; менеджер — все', () => {
    expect(canReadEstimate('ENGINEER', 'other', 'me')).toBe(false)
    expect(canAccessEstimate('ENGINEER', 'me', 'me')).toBe(true)
    expect(canAccessEstimate('MANAGER', 'other', 'me')).toBe(true)
  })
})
