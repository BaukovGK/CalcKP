import { describe, expect, it } from 'vitest'
import {
  calcDischargePipeDiameterMm,
  DEFAULT_DESIGN_VELOCITY_MS,
  STANDARD_PE_OD_MM,
} from './pipe-hydraulics'

describe('calcDischargePipeDiameterMm', () => {
  it('ОЛ3487: общий приток 90,468 м³/ч на 2 насоса ↔ 45,234 м³/ч на 1 насос — одинаковый результат (⌀110 мм)', () => {
    // Внутренний напорный трубопровод в КНС считается по притоку НА ОДИН
    // насос (лист «Гидравл. расчет», B4 = E51/(3.6·E55)) — деление общего
    // притока на число рабочих насосов должно давать то же число, что и
    // прямая подача уже поделённого расхода.
    const total = calcDischargePipeDiameterMm(90.468, 2)
    const perPump = calcDischargePipeDiameterMm(45.234, 1)
    expect(total.flowPerPumpM3h).toBeCloseTo(45.234, 9)
    expect(total.diameterMm).toBe(perPump.diameterMm)
    expect(total.theoreticalDiameterMm).toBeCloseTo(perPump.theoreticalDiameterMm, 9)
    expect(total.diameterMm).toBe(110)
    // Реальный лист поставил здесь трубу Ø160×9,5мм (F10) — крупнее расчётной:
    // это уже инженерный запас поверх чистой экономической скорости 1,5 м/с,
    // а не часть этой функции (см. заголовок модуля).
  })

  it('45,234 м³/ч (приток на 1 насос ОЛ3487) → ⌀110 мм', () => {
    const r = calcDischargePipeDiameterMm(45.234)
    expect(r.diameterMm).toBe(110)
    expect(r.theoreticalDiameterMm).toBeCloseTo(103.2739233933953, 9)
    expect(r.flowPerPumpM3h).toBe(45.234)
  })

  it('10 м³/ч → ⌀50 мм', () => {
    const r = calcDischargePipeDiameterMm(10)
    expect(r.diameterMm).toBe(50)
  })

  it('601,56 м³/ч (ДНС Пехотная, приток на 1 насос) → ⌀400 мм', () => {
    const r = calcDischargePipeDiameterMm(601.56)
    expect(r.diameterMm).toBe(400)
  })

  it('фактическая скорость при выбранном (округлённом) диаметре не превышает целевую больше чем на типовой шаг каталога', () => {
    const r = calcDischargePipeDiameterMm(45.234)
    // Скорость при округлённом вверх диаметре всегда ≤ целевой (труба не меньше расчётной).
    expect(r.velocityMs).toBeLessThanOrEqual(DEFAULT_DESIGN_VELOCITY_MS)
  })

  it('расход точно на границе типоразмера → берётся именно этот размер, не следующий', () => {
    // D=110мм при V=1,5м/с соответствует Q = π/4 * 0.11^2 * 1.5 * 3600 м3/ч.
    const qForExactly110 = (Math.PI / 4) * 0.11 ** 2 * 1.5 * 3600
    const r = calcDischargePipeDiameterMm(qForExactly110)
    expect(r.diameterMm).toBe(110)
  })

  it('2 рабочих насоса вдвое уменьшают расход на насос → диаметр не больше, чем при 1 насосе', () => {
    const onePump = calcDischargePipeDiameterMm(90.468, 1)
    const twoPumps = calcDischargePipeDiameterMm(90.468, 2)
    expect(twoPumps.flowPerPumpM3h).toBe(onePump.flowPerPumpM3h / 2)
    expect(twoPumps.diameterMm).toBeLessThanOrEqual(onePump.diameterMm)
  })

  it('workingPumps по умолчанию = 1 (весь приток — на один насос, как до появления параметра)', () => {
    const withDefault = calcDischargePipeDiameterMm(90.468)
    const explicit = calcDischargePipeDiameterMm(90.468, 1)
    expect(withDefault).toEqual(explicit)
  })

  it('нестандартная целевая скорость (2,5 м/с) уменьшает подобранный диаметр', () => {
    const r15 = calcDischargePipeDiameterMm(90.468, 1, 1.5)
    const r25 = calcDischargePipeDiameterMm(90.468, 1, 2.5)
    expect(r25.diameterMm).toBeLessThan(r15.diameterMm)
    expect(r25.designVelocityMs).toBe(2.5)
  })

  it('свой ряд стандартных диаметров (вместо каталога ПЭ)', () => {
    const r = calcDischargePipeDiameterMm(45.234, 1, 1.5, [100, 200, 300])
    expect(r.diameterMm).toBe(200) // теоретический ~103мм не влезает в 100, берём 200
  })

  it('расход больше максимума каталога → берётся максимум с предупреждением', () => {
    const r = calcDischargePipeDiameterMm(100000)
    expect(r.diameterMm).toBe(STANDARD_PE_OD_MM[STANDARD_PE_OD_MM.length - 1])
    expect(r.warnings.map((w) => w.code)).toContain('DIAMETER_ABOVE_CATALOG')
    expect(r.velocityMs).toBeGreaterThan(DEFAULT_DESIGN_VELOCITY_MS)
  })

  it('flowM3h = 0 → бросает ошибку', () => {
    expect(() => calcDischargePipeDiameterMm(0)).toThrow(/flowM3h/)
  })

  it('flowM3h < 0 → бросает ошибку', () => {
    expect(() => calcDischargePipeDiameterMm(-5)).toThrow(/flowM3h/)
  })

  it('workingPumps = 0 → бросает ошибку', () => {
    expect(() => calcDischargePipeDiameterMm(10, 0)).toThrow(/workingPumps/)
  })

  it('workingPumps дробное → бросает ошибку', () => {
    expect(() => calcDischargePipeDiameterMm(10, 1.5)).toThrow(/workingPumps/)
  })

  it('designVelocityMs = 0 → бросает ошибку', () => {
    expect(() => calcDischargePipeDiameterMm(10, 1, 0)).toThrow(/designVelocityMs/)
  })
})
