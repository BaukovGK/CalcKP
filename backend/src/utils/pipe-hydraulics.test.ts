import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  calcDischargePipeDiameterMm,
  DEFAULT_DESIGN_VELOCITY_MS,
  innerDiameterMm,
  PE_SDR17_SIZES,
  selectPressurePiping,
  STANDARD_PE_OD_MM,
  type PePipeSize,
} from './pipe-hydraulics'

describe('ряд ПЭ-труб', () => {
  // Ряд продублирован в модуле, чтобы расчёт оставался чистой функцией без БД.
  // Дубль без сверки разошёлся бы с каталогом молча — и подбор начал бы
  // предлагать трубу, которой в прайсе нет.
  it('совпадает с каталогом сида по DN, наружному диаметру и стенке', () => {
    const raw = JSON.parse(
      readFileSync(join(__dirname, '../../prisma/seed-data/pipe-weights-pe.json'), 'utf8'),
    ) as Array<{ dn: number; odMm: number; wallMm: string | null }>

    const fromSeed = raw
      .map((p) => ({
        dn: p.dn,
        odMm: p.odMm,
        wallMm: Number(String(p.wallMm).replace(/[^0-9,.]/g, '').replace(',', '.')),
      }))
      .sort((a, b) => a.odMm - b.odMm)

    expect([...PE_SDR17_SIZES].sort((a, b) => a.odMm - b.odMm)).toEqual(fromSeed)
  })

  it('внутренний диаметр = наружный − две стенки', () => {
    const dn150 = PE_SDR17_SIZES.find((p) => p.odMm === 160)!
    // Ровно то же число, что в листе «Гидравл. расчет»: B12 = 0,16 − 2·0,0095.
    expect(innerDiameterMm(dn150)).toBeCloseTo(141, 9)
  })
})

describe('calcDischargePipeDiameterMm — напорный участок насоса', () => {
  // ОЛ3487: приток 90,468 м³/ч на 2 рабочих насоса = 45,234 м³/ч на насос.
  it('общий приток на 2 насоса ↔ уже поделённый расход дают один результат', () => {
    const total = calcDischargePipeDiameterMm(90.468, 2)
    const perPump = calcDischargePipeDiameterMm(45.234, 1)
    expect(total.flowPerPumpM3h).toBeCloseTo(45.234, 9)
    expect(total.diameterMm).toBe(perPump.diameterMm)
    expect(total.theoreticalDiameterMm).toBeCloseTo(perPump.theoreticalDiameterMm, 9)
  })

  // Подбор идёт по ПРОХОДУ. Требуемый диаметр потока — 103,3 мм; у Ø110 проход
  // всего 96,8 мм (стенка 6,6), поэтому подходит только Ø125 с проходом 110,2.
  //
  // Прежняя редакция округляла требуемый проход до НАРУЖНОГО диаметра и
  // выдавала Ø110: труба в полтора раза уже нужной по сечению, а скорость в
  // ней 1,71 м/с против целевых 1,5 — при этом функция рапортовала 1,32 м/с,
  // потому что считала скорость по наружному.
  it('ОЛ3487, 45,234 м³/ч на насос → ⌀125 (проход 110,2 мм), а не ⌀110', () => {
    const r = calcDischargePipeDiameterMm(45.234)
    expect(r.theoreticalDiameterMm).toBeCloseTo(103.2739233933953, 9)
    expect(r.diameterMm).toBe(125)
    expect(r.dn).toBe(125)
    expect(r.innerDiameterMm).toBeCloseTo(110.2, 9)
    expect(r.velocityMs).toBeLessThanOrEqual(DEFAULT_DESIGN_VELOCITY_MS)
  })

  it('скорость считается по проходу, а не по наружному диаметру', () => {
    const r = calcDischargePipeDiameterMm(45.234)
    const flowM3s = 45.234 / 3600
    const byInner = (4 * flowM3s) / (Math.PI * (r.innerDiameterMm / 1000) ** 2)
    expect(r.velocityMs).toBeCloseTo(byInner, 9)
  })

  it('расход точно на границе прохода → берётся именно этот размер', () => {
    // Проход Ø125 — 110,2 мм. Расход, дающий ровно 1,5 м/с в нём.
    const q = (Math.PI / 4) * 0.1102 ** 2 * 1.5 * 3600
    const r = calcDischargePipeDiameterMm(q)
    expect(r.diameterMm).toBe(125)
  })

  it('2 рабочих насоса вдвое уменьшают расход на насос → диаметр не больше', () => {
    const onePump = calcDischargePipeDiameterMm(90.468, 1)
    const twoPumps = calcDischargePipeDiameterMm(90.468, 2)
    expect(twoPumps.flowPerPumpM3h).toBe(onePump.flowPerPumpM3h / 2)
    expect(twoPumps.diameterMm).toBeLessThanOrEqual(onePump.diameterMm)
  })

  it('workingPumps по умолчанию = 1', () => {
    expect(calcDischargePipeDiameterMm(90.468)).toEqual(calcDischargePipeDiameterMm(90.468, 1))
  })

  it('нестандартная целевая скорость (2,5 м/с) уменьшает подобранный диаметр', () => {
    const r15 = calcDischargePipeDiameterMm(90.468, 1, 1.5)
    const r25 = calcDischargePipeDiameterMm(90.468, 1, 2.5)
    expect(r25.diameterMm).toBeLessThan(r15.diameterMm)
    expect(r25.designVelocityMs).toBe(2.5)
  })

  it('свой ряд типоразмеров (вместо каталога ПЭ)', () => {
    const sizes: PePipeSize[] = [
      { dn: 100, odMm: 100, wallMm: 0 },
      { dn: 200, odMm: 200, wallMm: 0 },
    ]
    // Требуемый проход ~103 мм в стомиллиметровую не влезает — берём 200.
    expect(calcDischargePipeDiameterMm(45.234, 1, 1.5, sizes).diameterMm).toBe(200)
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

  it('дробное число насосов → бросает ошибку', () => {
    expect(() => calcDischargePipeDiameterMm(90.468, 1.5)).toThrow(/workingPumps/)
  })
})

describe('selectPressurePiping — стояк, коллектор, выходной патрубок', () => {
  // ОЛ3487: приток 90,468 м³/ч, 2 рабочих насоса, 2 напорных трубопровода.
  it('стояк идёт по расходу одного насоса, коллектор — по полному', () => {
    const r = selectPressurePiping(90.468, 2, 2)
    expect(r.riser.flowM3h).toBeCloseTo(45.234, 9)
    expect(r.collector.flowM3h).toBeCloseTo(90.468, 9)
    expect(r.collector.innerDiameterMm).toBeGreaterThan(r.riser.innerDiameterMm)
    expect(r.collectorWiderThanRiser).toBe(true)
  })

  it('два выхода делят полный расход пополам — выход уже коллектора', () => {
    const r = selectPressurePiping(90.468, 2, 2)
    expect(r.outlet.flowM3h).toBeCloseTo(45.234, 9)
    expect(r.outlet.dn).toBe(r.riser.dn)
    expect(r.outlet.innerDiameterMm).toBeLessThan(r.collector.innerDiameterMm)
  })

  it('один выход на два насоса — выход равен коллектору', () => {
    const r = selectPressurePiping(90.468, 2, 1)
    expect(r.outlet.flowM3h).toBeCloseTo(90.468, 9)
    expect(r.outlet.dn).toBe(r.collector.dn)
  })

  // Один насос — сборки нет: собирать нечего, все три участка одинаковы.
  it('единственный рабочий насос: стояк, коллектор и выход совпадают', () => {
    const r = selectPressurePiping(45.234, 1, 1)
    expect(r.riser.dn).toBe(r.collector.dn)
    expect(r.collector.dn).toBe(r.outlet.dn)
    expect(r.collectorWiderThanRiser).toBe(false)
  })

  it('все три участка держат целевую скорость', () => {
    const r = selectPressurePiping(90.468, 2, 1)
    for (const s of [r.riser, r.collector, r.outlet]) {
      expect(s.velocityMs).toBeLessThanOrEqual(DEFAULT_DESIGN_VELOCITY_MS)
    }
  })

  it('стояк совпадает с отдельным расчётом напорного участка насоса', () => {
    const piping = selectPressurePiping(90.468, 2, 2)
    const direct = calcDischargePipeDiameterMm(90.468, 2)
    expect(piping.riser.dn).toBe(direct.dn)
    expect(piping.riser.velocityMs).toBeCloseTo(direct.velocityMs, 9)
  })

  it('нулевое число выходов → бросает ошибку', () => {
    expect(() => selectPressurePiping(90.468, 2, 0)).toThrow(/outletCount/)
  })
})
