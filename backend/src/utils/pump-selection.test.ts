import { describe, expect, it } from 'vitest'
import { DEFAULT_PUMPS, selectPump } from './pump-selection'

describe('selectPump — каталог по умолчанию (6 позиций)', () => {
  it('каталог содержит ровно 6 насосов', () => {
    expect(DEFAULT_PUMPS.length).toBe(6)
  })

  it('диапазоны производительности не перекрываются и без пропусков (5…700 м³/ч)', () => {
    const sorted = [...DEFAULT_PUMPS].sort((a, b) => a.capacityMinM3h - b.capacityMinM3h)
    expect(sorted[0]!.capacityMinM3h).toBe(5)
    expect(sorted[sorted.length - 1]!.capacityMaxM3h).toBe(700)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.capacityMinM3h).toBe(sorted[i - 1]!.capacityMaxM3h)
    }
  })

  it('15,012 м³/ч (КНС Бирюлевская, 1 насос) → GROSSEN GS 65', () => {
    const r = selectPump(15.012, 65)
    expect(r.name).toBe('GROSSEN GS 65')
    expect(r.warnings).toEqual([])
  })

  it('23,508 м³/ч (ОЛ3462 КНС 2500, 1 насос) → GROSSEN GS 65 (верхняя граница диапазона)', () => {
    const r = selectPump(23.508, 65)
    expect(r.name).toBe('GROSSEN GS 65')
  })

  it('39,168 м³/ч (ОЛ3462 ЛНС 2500, 1 насос) → GROSSEN GS 80', () => {
    const r = selectPump(39.168, 80)
    expect(r.name).toBe('GROSSEN GS 80')
  })

  it('45,234 м³/ч (ОЛ3487, 1 насос) → GROSSEN GS 100', () => {
    const r = selectPump(45.234, 100)
    expect(r.name).toBe('GROSSEN GS 100')
  })

  it('375 м³/ч (Ол №3429, 1 насос) → GROSSEN GS 200', () => {
    const r = selectPump(375, 200)
    expect(r.name).toBe('GROSSEN GS 200')
  })

  it('601,56 м³/ч (ДНС Пехотная, 1 насос) → GROSSEN GS 250', () => {
    const r = selectPump(601.56, 250)
    expect(r.name).toBe('GROSSEN GS 250')
  })

  it('612 м³/ч (ОЛ3460, 1 насос) → GROSSEN GS 250', () => {
    const r = selectPump(612, 250)
    expect(r.name).toBe('GROSSEN GS 250')
  })

  it('расход вне всех диапазонов (например, 5000 м³/ч) → null + предупреждение NO_CAPACITY_MATCH', () => {
    const r = selectPump(5000, 250)
    expect(r.name).toBeNull()
    expect(r.pump).toBeNull()
    expect(r.warnings.map((w) => w.code)).toContain('NO_CAPACITY_MATCH')
  })

  it('расход попадает в диапазон, но патрубок не совпадает → null + предупреждение NO_NOZZLE_MATCH', () => {
    // 15,012 м³/ч покрывается GS 65 (⌀65), а не ⌀100.
    const r = selectPump(15.012, 100)
    expect(r.name).toBeNull()
    expect(r.warnings.map((w) => w.code)).toContain('NO_NOZZLE_MATCH')
  })

  it('пограничное значение ровно на стыке диапазонов (24 м³/ч) — принадлежит обоим включительно, берётся первый по каталогу', () => {
    const r65 = selectPump(24, 65)
    const r80 = selectPump(24, 80)
    expect(r65.name).toBe('GROSSEN GS 65')
    expect(r80.name).toBe('GROSSEN GS 80')
  })

  it('свой (пользовательский) каталог вместо дефолтного', () => {
    const custom = [{ name: 'Тестовый насос', capacityMinM3h: 0, capacityMaxM3h: 1000, nozzleDiameterMm: 50 }]
    const r = selectPump(500, 50, custom)
    expect(r.name).toBe('Тестовый насос')
  })

  it('несколько насосов подходят одновременно → предупреждение MULTIPLE_MATCHES, берётся первый', () => {
    const custom = [
      { name: 'Насос A', capacityMinM3h: 0, capacityMaxM3h: 100, nozzleDiameterMm: 50 },
      { name: 'Насос B', capacityMinM3h: 0, capacityMaxM3h: 100, nozzleDiameterMm: 50 },
    ]
    const r = selectPump(50, 50, custom)
    expect(r.name).toBe('Насос A')
    expect(r.warnings.map((w) => w.code)).toContain('MULTIPLE_MATCHES')
  })

  it('flowM3h = 0 → бросает ошибку', () => {
    expect(() => selectPump(0, 65)).toThrow(/flowM3h/)
  })

  it('nozzleDiameterMm = 0 → бросает ошибку', () => {
    expect(() => selectPump(15, 0)).toThrow(/nozzleDiameterMm/)
  })
})
