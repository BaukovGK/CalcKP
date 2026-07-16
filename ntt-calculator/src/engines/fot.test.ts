import { describe, expect, it } from 'vitest'
import { fotCoeffByName, fotHoursFromMass, recalcFotSatellites, resolveFotK } from './fot'
import type { EngineRow } from './types'

const op = (o: Partial<EngineRow> = {}): EngineRow => ({
  id: 'op1',
  kind: 'ОПЕРАЦИЯ',
  category: 'Собственное производство',
  name: 'Механическое формованное дно',
  unit: 'кг',
  qtyCalc: 262.8,
  qtyManual: null,
  priceCatalog: 214.4,
  priceManual: null,
  ...o,
})

const fot = (o: Partial<EngineRow> = {}): EngineRow => ({
  id: 'fot1',
  kind: 'ФОТ',
  category: 'ФОТ',
  name: 'ФОТ',
  unit: 'чел. ч',
  qtyCalc: 0,
  qtyManual: null,
  priceCatalog: 1207.8,
  priceManual: null,
  parentId: 'op1',
  ...o,
})

describe('fotCoeffByName', () => {
  it('«мех» → 0,28', () => {
    expect(fotCoeffByName('Механическое формованное дно')).toBe(0.28)
    expect(fotCoeffByName('мех. формовка плоского днища')).toBe(0.28)
  })

  it('«ламин» → 0,56', () => {
    expect(fotCoeffByName('Ламинирование дна к фальшполу')).toBe(0.56)
  })

  it('прочее → 1,0', () => {
    expect(fotCoeffByName('Придание изделию товарного вида')).toBe(1.0)
  })

  // Регрессия: прежний engines/cost.ts возвращал 0,28 на любое вхождение
  // «формов», из-за чего «Ручная формовка» получала 0,28 вместо 1,0
  // (§9.3: 0,28 — только механическая формовка).
  it('«Ручная формовка» → 1,0, а не 0,28', () => {
    expect(fotCoeffByName('Ручная формовка стеклокомпозитного фланца')).toBe(1.0)
    expect(fotCoeffByName('Формовка гильз')).toBe(1.0)
  })

  it('«мех» имеет приоритет над «ламин»', () => {
    expect(fotCoeffByName('Мех. формовка с ламинированием')).toBe(0.28)
  })
})

describe('resolveFotK', () => {
  it('явный fotK каталога выигрывает у эвристики', () => {
    expect(resolveFotK(op({ name: 'Ламинирование особое', fotK: 1.0 }))).toBe(1.0)
  })

  it('без явного — эвристика по наименованию', () => {
    expect(resolveFotK(op({ name: 'Ламинирование дна' }))).toBe(0.56)
  })
})

describe('fotHoursFromMass', () => {
  // Контрольные значения из README хендоффа (сборка «Корпус»).
  it('262,8 кг × 0,28 → 73,6 чел.ч', () => {
    expect(fotHoursFromMass(262.8, 0.28)).toBe(73.6)
  })

  it('78,9 кг × 0,56 → 44,2 чел.ч', () => {
    expect(fotHoursFromMass(78.9, 0.56)).toBe(44.2)
  })

  it('округляет ВВЕРХ до 0,1', () => {
    expect(fotHoursFromMass(10, 0.28)).toBe(2.8)
    expect(fotHoursFromMass(10.1, 0.28)).toBe(2.9) // 2.828 → 2.9
  })
})

describe('recalcFotSatellites', () => {
  it('считает спутник от массы родителя', () => {
    const rows = recalcFotSatellites([op(), fot()])
    expect(rows[1]!.qtyCalc).toBe(73.6) // 262.8 × 0.28
  })

  it('реагирует на ИТОГОВОЕ кол-во родителя, а не на qtyCalc (Механика §6)', () => {
    const rows = recalcFotSatellites([op({ qtyManual: '100' }), fot()])
    expect(rows[1]!.qtyCalc).toBe(28) // 100 × 0.28, а не 262.8 × 0.28
  })

  it('выключенный родитель обнуляет спутник', () => {
    const rows = recalcFotSatellites([op({ enabled: false }), fot()])
    expect(rows[1]!.qtyCalc).toBe(0)
  })

  it('не трогает ручной override спутника', () => {
    const rows = recalcFotSatellites([op(), fot({ qtyManual: '50' })])
    expect(rows[1]!.qtyManual).toBe('50')
  })

  it('не мутирует входной массив', () => {
    const input = [op(), fot()]
    const snapshot = JSON.stringify(input)
    recalcFotSatellites(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('строка без родителя остаётся как есть', () => {
    const orphan = fot({ parentId: 'нет-такого' })
    expect(recalcFotSatellites([orphan])[0]).toEqual(orphan)
  })

  it('самостоятельная ФОТ-строка (без parentId) не пересчитывается', () => {
    const standalone = fot({ parentId: undefined, qtyCalc: 4.2 })
    expect(recalcFotSatellites([standalone])[0]!.qtyCalc).toBe(4.2)
  })
})
