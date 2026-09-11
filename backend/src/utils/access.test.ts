/**
 * Правила ролей (ТЗ §2). Держит решение Р8 (План_устранения 3.7): снабженец
 * читает любой расчёт и видит все проекты — заявка на закупку открывается по
 * чужому расчёту, — но править их не может.
 */
import { describe, expect, it } from 'vitest'
import { canAccessEstimate, canReadEstimate, seesAllEstimates, seesAllProjects } from './access'

describe('доступ к расчётам и проектам', () => {
  it('снабженец читает чужой расчёт, но не правит его', () => {
    expect(canReadEstimate('BUYER', 'author', 'buyer')).toBe(true)
    expect(canAccessEstimate('BUYER', 'author', 'buyer')).toBe(false)
  })

  it('снабженец и наблюдатель видят все расчёты и проекты', () => {
    for (const role of ['ADMIN', 'MANAGER', 'VIEWER', 'BUYER']) {
      expect(seesAllEstimates(role)).toBe(true)
      expect(seesAllProjects(role)).toBe(true)
    }
    expect(seesAllEstimates('ENGINEER')).toBe(false)
    expect(seesAllProjects('TECHNOLOG')).toBe(false)
  })

  it('инженер — только свои расчёты; менеджер — все', () => {
    expect(canReadEstimate('ENGINEER', 'other', 'me')).toBe(false)
    expect(canAccessEstimate('ENGINEER', 'me', 'me')).toBe(true)
    expect(canAccessEstimate('MANAGER', 'other', 'me')).toBe(true)
  })
})
