import { describe, expect, it } from 'vitest'
import { DEFAULT_PUMPS, selectPump } from './pump-selection'

/**
 * Контрольные точки — реальные «рабочие точки» насосов Vandjord VSL из томов
 * проекта («Работа/Примеры/Проекты», паспорта VJ Select и спецификации).
 * Дают уверенность, что диапазоны каталога действительно накрывают то, что
 * встречается в реальных проектах, а не только круглые числа из паспорта.
 */
describe('selectPump — каталог по умолчанию (6 реальных моделей Vandjord VSL)', () => {
  it('каталог содержит ровно 6 насосов', () => {
    expect(DEFAULT_PUMPS.length).toBe(6)
  })

  it('ОЛ1: Q=8,19 л/с (29,48 м³/ч); H=13,66 м → VSL.50.22.2.5.0D (1397-ПТ-08/04-ПД-ТХ1)', () => {
    const r = selectPump(29.48, 13.66)
    expect(r.name).toBe('Vandjord VSL.50.22.2.5.0D')
    expect(r.warnings).toEqual([])
  })

  it('ОЛ (МДБЛ): Q=4,17 л/с (15,01 м³/ч); H=20,2 м → VSL.50.22.2.5.0D (другая точка той же модели)', () => {
    const r = selectPump(15.01, 20.2)
    expect(r.name).toBe('Vandjord VSL.50.22.2.5.0D')
  })

  it('ОЛ2: Q=9,77 л/с (35,17 м³/ч); H=17,67 м → VSL.65.30.2.5.0D (1397-ПТ-08/04-ПД-ТХ2)', () => {
    const r = selectPump(35.17, 17.67)
    expect(r.name).toBe('Vandjord VSL.65.30.2.5.0D')
  })

  it('ДУДС31и: Q=41,65 м³/ч; H=12,96 м → VSL.80.37.4.5.0D (рабочая точка)', () => {
    const r = selectPump(41.65, 12.96)
    expect(r.name).toBe('Vandjord VSL.80.37.4.5.0D')
  })

  it('ДУДС31и: Q=41 м³/ч; H=12,5 м → VSL.80.37.4.5.0D (параметры системы, граница диапазона)', () => {
    const r = selectPump(41, 12.5)
    expect(r.name).toBe('Vandjord VSL.80.37.4.5.0D')
  })

  it('РД-618: Q=50,59 м³/ч; H=16,47 м → попадает и в VSL.80.37, и в VSL.100.55 (прямоугольная аппроксимация — известное ограничение, см. заголовок модуля)', () => {
    const r = selectPump(50.59, 16.47)
    expect(['Vandjord VSL.80.37.4.5.0D', 'Vandjord VSL.100.55.4.5.0D']).toContain(r.name)
    expect(r.warnings.map((w) => w.code)).toContain('MULTIPLE_MATCHES')
  })

  it('РД-618: Q=45,23 м³/ч; H=12,9 м → попадает и в VSL.80.37, и в VSL.100.55', () => {
    const r = selectPump(45.23, 12.9)
    expect(['Vandjord VSL.80.37.4.5.0D', 'Vandjord VSL.100.55.4.5.0D']).toContain(r.name)
    expect(r.warnings.map((w) => w.code)).toContain('MULTIPLE_MATCHES')
  })

  it('ДУДС24и: Q=318,84 м³/ч; H=13,29 м → VSL.200.190.4.5.1D (рабочая точка)', () => {
    const r = selectPump(318.84, 13.29)
    expect(r.name).toBe('Vandjord VSL.200.190.4.5.1D')
  })

  it('СТ 1_12-25: Q=71,1 л/с (255,96 м³/ч); H=18,7 м → VSL.200.220.4.5.1D (рабочая точка)', () => {
    const r = selectPump(255.96, 18.7)
    expect(r.name).toBe('Vandjord VSL.200.220.4.5.1D')
  })

  it('расход вне всех диапазонов (5000 м³/ч) → null + предупреждение NO_CAPACITY_MATCH', () => {
    const r = selectPump(5000, 20)
    expect(r.name).toBeNull()
    expect(r.pump).toBeNull()
    expect(r.warnings.map((w) => w.code)).toContain('NO_CAPACITY_MATCH')
  })

  it('расход попадает в диапазон, но напор нет → null + предупреждение NO_HEAD_MATCH', () => {
    // 29,48 м³/ч покрывается VSL.50.22 (H 13,5…20,5), а требуемые 50 м — нет.
    const r = selectPump(29.48, 50)
    expect(r.name).toBeNull()
    expect(r.warnings.map((w) => w.code)).toContain('NO_HEAD_MATCH')
  })

  it('пересечение диапазонов расхода двух моделей DN200 → предупреждение MULTIPLE_MATCHES', () => {
    // 300...525 м³/ч при H=18...19 м подходит и VSL.200.190, и VSL.200.220.
    const r = selectPump(320, 18.5)
    expect(r.warnings.map((w) => w.code)).toContain('MULTIPLE_MATCHES')
    expect(r.name).not.toBeNull()
  })

  it('свой (пользовательский) каталог вместо дефолтного', () => {
    const custom = [{ name: 'Тестовый насос', capacityMinM3h: 0, capacityMaxM3h: 1000, headMinM: 0, headMaxM: 100, nozzleDiameterMm: 50 }]
    const r = selectPump(500, 50, custom)
    expect(r.name).toBe('Тестовый насос')
  })

  it('flowM3h = 0 → бросает ошибку', () => {
    expect(() => selectPump(0, 10)).toThrow(/flowM3h/)
  })

  it('headM = 0 → бросает ошибку', () => {
    expect(() => selectPump(15, 0)).toThrow(/headM/)
  })
})
