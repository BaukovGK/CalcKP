import { describe, expect, it } from 'vitest'
import { DEFAULT_PUMPS, selectPump } from './pump-selection'

/**
 * Контрольные точки для 56 моделей DN80…DN400 — из официальной выгрузки VJ
 * Select (см. заголовок pump-selection.ts). Для DN50/DN65 (5 моделей из
 * вторичных источников) и ряда сквозных проверок — реальные рабочие точки из
 * проектных томов («Работа/Примеры/Проекты»).
 */
describe('selectPump — каталог по умолчанию (61 модель Vandjord VSL, данные VJ Select)', () => {
  it('каталог содержит 61 насос', () => {
    expect(DEFAULT_PUMPS.length).toBe(61)
  })

  it('покрывает весь официальный ряд патрубков DN50…DN400', () => {
    const dns = new Set(DEFAULT_PUMPS.map((p) => p.nozzleDiameterMm))
    expect([...dns].sort((a, b) => a - b)).toEqual([50, 65, 80, 100, 150, 200, 250, 300, 400])
  })

  it('ОЛ1 (1397-ПТ-08/04-ПД-ТХ1): Q=8,19 л/с (29,48 м³/ч); H=13,66 м → VSL.50.22.2.5.0D', () => {
    const r = selectPump(29.48, 13.66)
    expect(r.name).toBe('Vandjord VSL.50.22.2.5.0D')
    expect(r.warnings).toEqual([])
  })

  it('ОЛ (МДБЛ): Q=4,17 л/с (15,01 м³/ч); H=20,2 м → VSL.50.22.2.5.0D', () => {
    const r = selectPump(15.01, 20.2)
    expect(r.name).toBe('Vandjord VSL.50.22.2.5.0D')
  })

  it('ОЛ2 (1397-ПТ-08/04-ПД-ТХ2): Q=9,77 л/с (35,17 м³/ч); H=17,67 м → VSL.65.30.2.5.0D', () => {
    const r = selectPump(35.17, 17.67)
    expect(r.name).toBe('Vandjord VSL.65.30.2.5.0D')
    expect(r.warnings).toEqual([])
  })

  it('РД-618: рабочая точка Q=50,59 м³/ч; H=16,47 м → VSL.80.37.4.5.0D (единственное совпадение)', () => {
    const r = selectPump(50.59, 16.47)
    expect(r.name).toBe('Vandjord VSL.80.37.4.5.0D')
    expect(r.warnings).toEqual([])
  })

  it('Q=65 м³/ч (Qnom VSL.100.55); H=10 м → на самом деле подходит и меньший VSL.80.22 (DN80) — каталог отсортирован по возрастанию DN, при пересечении побеждает более дешёвый патрубок', () => {
    const r = selectPump(65, 10)
    expect(r.pump?.nozzleDiameterMm).toBe(80)
    expect(r.warnings.map((w) => w.code)).toContain('MULTIPLE_MATCHES')
  })

  it('Q=800 м³/ч (Qnom VSL.300.550); H=5 м → накрывается и DN250 (VSL.250.300), он и побеждает как меньший патрубок', () => {
    const r = selectPump(800, 5)
    expect(r.pump?.nozzleDiameterMm).toBe(250)
    expect(r.warnings.map((w) => w.code)).toContain('MULTIPLE_MATCHES')
  })

  it('DN400: Q=1200 м³/ч (Qnom обеих моделей 400-й линейки) — выше макс. расхода всех DN300 (1100) → однозначно DN400, но пересечение двух моделей по мощности', () => {
    const r = selectPump(1200, 5)
    expect(r.pump?.nozzleDiameterMm).toBe(400)
    expect(r.warnings.map((w) => w.code)).toContain('MULTIPLE_MATCHES')
  })

  it('ДУДС24и/ДУДС31и: Q=318,84 м³/ч; H=13,29 м (рабочая точка VSL.200.190) → на самом деле подходит и меньший DN150 (VSL.150.220) — тот и побеждает', () => {
    const r = selectPump(318.84, 13.29)
    expect(r.pump?.nozzleDiameterMm).toBe(150)
    expect(r.warnings.map((w) => w.code)).toContain('MULTIPLE_MATCHES')
  })

  it('известное ограничение прямоугольной аппроксимации: Q=41,65 м³/ч; H=12,96 м (та же формулировка «рабочая точка», что и у РД-618-случая) ниже официального номинала всех DN80/DN65 → NO_CAPACITY_MATCH', () => {
    // Это НЕ баг: 41,65 м³/ч ниже официального «Номинального расхода» (45 м³/ч)
    // всех моделей DN80 и выше диапазона DN65 (макс. 40 м³/ч) — граница между
    // проверенными вторичными данными (DN50/65) и официальными VJ Select
    // (DN80+) оставляет узкую щель. Задокументировано в заголовке модуля.
    const r = selectPump(41.65, 12.96)
    expect(r.name).toBeNull()
    expect(r.warnings.map((w) => w.code)).toContain('NO_CAPACITY_MATCH')
  })

  it('расход вне всех диапазонов (5000 м³/ч, между DN300 и DN400) → null + предупреждение NO_CAPACITY_MATCH', () => {
    const r = selectPump(5000, 20)
    expect(r.name).toBeNull()
    expect(r.warnings.map((w) => w.code)).toContain('NO_CAPACITY_MATCH')
  })

  it('расход попадает в диапазон, но напор нет → null + предупреждение NO_HEAD_MATCH', () => {
    // 29,48 м³/ч покрывается только VSL.50.22 (напор до 21 м), а не 50 м.
    const r = selectPump(29.48, 50)
    expect(r.name).toBeNull()
    expect(r.warnings.map((w) => w.code)).toContain('NO_HEAD_MATCH')
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
