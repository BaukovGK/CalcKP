import { describe, expect, it } from 'vitest'
import { calcRingStiffnessPa } from './ring-stiffness'

describe('calcRingStiffnessPa — матрица глубина×МВК', () => {
  it('глубина+2 > 7, МВК=false → SN 10000', () => {
    expect(calcRingStiffnessPa(false, 6)).toBe(10000) // 6+2=8 > 7
  })

  it('глубина+2 > 7, МВК=true → SN 12000', () => {
    expect(calcRingStiffnessPa(true, 6)).toBe(12000)
  })

  it('глубина+2 <= 7, МВК=false → SN 5000', () => {
    expect(calcRingStiffnessPa(false, 4)).toBe(5000) // 4+2=6 <= 7
  })

  it('глубина+2 <= 7, МВК=true → SN 8000', () => {
    expect(calcRingStiffnessPa(true, 4)).toBe(8000)
  })

  it('граница: глубина+2 = 7 ровно → ветка «<= 7»', () => {
    expect(calcRingStiffnessPa(false, 5)).toBe(5000) // 5+2=7
    expect(calcRingStiffnessPa(true, 5)).toBe(8000)
  })

  it('чуть выше границы (глубина+2 = 7,001) → ветка «> 7»', () => {
    expect(calcRingStiffnessPa(false, 5.001)).toBe(10000)
    expect(calcRingStiffnessPa(true, 5.001)).toBe(12000)
  })

  it('глубина = 0 → глубина+2 = 2 <= 7', () => {
    expect(calcRingStiffnessPa(false, 0)).toBe(5000)
    expect(calcRingStiffnessPa(true, 0)).toBe(8000)
  })

  it('большая глубина (12 м, как в реальных ОЛ) → ветка «> 7»', () => {
    expect(calcRingStiffnessPa(true, 12)).toBe(12000)
  })

  it('отрицательная глубина → бросает ошибку', () => {
    expect(() => calcRingStiffnessPa(false, -1)).toThrow(/inletPipeDepthM/)
  })
})
