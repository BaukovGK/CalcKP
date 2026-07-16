import { describe, expect, it } from 'vitest'
import { roundUp, roundUpHours, roundUpPrice } from './rounding'

describe('roundUp — совместимость с Excel ROUNDUP', () => {
  it('округляет вверх до целого', () => {
    expect(roundUp(922.3, 0)).toBe(923)
    expect(roundUp(923, 0)).toBe(923) // точное значение не поднимается
    expect(roundUp(0.0001, 0)).toBe(1)
  })

  it('округляет вверх до 0,1', () => {
    expect(roundUp(56.3909, 1)).toBe(56.4)
    expect(roundUp(56.4, 1)).toBe(56.4)
    expect(roundUp(56.41, 1)).toBe(56.5)
  })

  it('округляет вверх до 100', () => {
    expect(roundUp(16592919.2, -2)).toBe(16593000)
    expect(roundUp(16593000, -2)).toBe(16593000)
    expect(roundUp(16592900.01, -2)).toBe(16593000)
  })

  it('округляет от нуля для отрицательных (как Excel)', () => {
    expect(roundUp(-4.4, 0)).toBe(-5)
    expect(roundUp(-56.3909, 1)).toBe(-56.4)
  })

  it('не портит ноль и нечисловые значения', () => {
    expect(roundUp(0, 1)).toBe(0)
    expect(roundUp(Number.NaN, 1)).toBeNaN()
    expect(roundUp(Number.POSITIVE_INFINITY, 1)).toBe(Number.POSITIVE_INFINITY)
  })

  // Регрессия: наивная реализация Math.ceil(x * 10**d) / 10**d завышает
  // результат на 0,1 из-за двоичной погрешности. Все случаи ниже — реальные
  // входы ФОТ-спутника (масса × k, §9.3), найденные перебором.
  describe('двоичная погрешность не завышает результат', () => {
    const cases: Array<[mass: number, k: number, expected: number]> = [
      [2.5, 0.28, 0.7], // 0.7000000000000001 → наивно 0.8
      [2.5, 0.56, 1.4], // 1.4000000000000001 → наивно 1.5
      [5, 0.28, 1.4],
      [5, 0.56, 2.8], // 2.8000000000000003 → наивно 2.9
      [10, 0.28, 2.8],
      [10, 0.56, 5.6], // 5.6000000000000005 → наивно 5.7
    ]

    it.each(cases)('масса %s кг × k=%s → %s чел.ч', (mass, k, expected) => {
      expect(roundUpHours(mass * k)).toBe(expected)
    })

    it('классический 0.1 + 0.2 не поднимается до 0,4', () => {
      expect(roundUp(0.1 + 0.2, 1)).toBe(0.3)
    })
  })
})

describe('псевдонимы', () => {
  it('roundUpHours — шаг 0,1', () => {
    expect(roundUpHours(620.3 / 11)).toBe(56.4) // ПЗР эталона
  })

  it('roundUpPrice — шаг 100 ₽', () => {
    expect(roundUpPrice(11603440 * 1.43)).toBe(16593000) // цена продажи ОЛ3487
  })
})
