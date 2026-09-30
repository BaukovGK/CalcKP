import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  calcDischargePipeDiameterMm,
  checkOutletPipe,
  DEFAULT_DESIGN_VELOCITY_MS,
  ECONOMIC_VELOCITY_MS,
  innerDiameterMm,
  NOZZLE_DN_SERIES,
  PE_NOZZLE_SIZES,
  PE_SDR17_SIZES,
  selectPressurePiping,
  STANDARD_PE_OD_MM,
  velocityMs,
  type PePipeSize,
} from './pipe-hydraulics'

/** ОЛ3487 «КНС Пехотная»: 25,13 л/с = 90,468 м³/ч, два рабочих насоса, две напорные DN150. */
const OL3487 = { flowM3h: 90.468, workingPumps: 2, outletCount: 2, outletDn: 150 }

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

describe('ряд подбора — DN патрубков мастер-книги', () => {
  it('в подбор идут только DN, которые опросный лист пропускает в поле', () => {
    for (const s of PE_NOZZLE_SIZES) expect(NOZZLE_DN_SERIES).toContain(s.dn)
  })

  // DN125 и DN180 есть в ряду ПЭ, но не в ряду патрубков: поле заменило бы
  // 125 на 150, а задвижек и комплектов нитки на них нет в прайсе.
  it('DN125 и DN180 подбор больше не предлагает', () => {
    const dns = PE_NOZZLE_SIZES.map((s) => s.dn)
    expect(dns).not.toContain(125)
    expect(dns).not.toContain(180)
    expect(dns).toEqual(expect.arrayContaining([50, 65, 80, 100, 150, 200, 250, 300]))
  })

  it('на каждый DN ряда — одна труба: подбор однозначен', () => {
    const dns = PE_NOZZLE_SIZES.map((s) => s.dn)
    expect(new Set(dns).size).toBe(dns.length)
  })
})

describe('лист «Гидравл. расчет» эталона — скорости воспроизводятся', () => {
  // Шаблон 3.0: Q = ОЛ!E51/3,6 = 22,36 л/с — весь приток, «работа на 1 нитку».
  const qM3h = 22.36 * 3.6

  it('G19: вне КНС, ПЭ Ø160×9,5 (проход 141 мм) — 1,4320 м/с', () => {
    expect(velocityMs(qM3h, 141)).toBeCloseTo(1.4320022242481882, 12)
    expect(checkOutletPipe(qM3h, 150, 2)!.velocityMs).toBeCloseTo(1.4320022242481882, 12)
  })

  it('G18: в КНС, сталь 159×4,5 (B10 = 0,159 − 2·0,0045 − 0,001) — 1,2824 м/с', () => {
    expect(velocityMs(qM3h, 149)).toBeCloseTo(1.2823582820718995, 12)
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

  // Требуемый при 1,5 м/с проход — 103,3 мм. Из ряда патрубков ближе всего к
  // целевой скорости DN100 (1,71 м/с); DN150 дал бы 0,80 м/с — ниже
  // самоочищающей. В проекте ОЛ3487 стояк именно DN100.
  //
  // Прежняя редакция подбирала по всему ряду ПЭ и выдавала ⌀125 «DN125» —
  // такого DN нет ни в ряду патрубков, ни в прайсе задвижек.
  it('ОЛ3487, 45,234 м³/ч на насос → DN100 (⌀110, проход 96,8 мм, 1,71 м/с), как в проекте', () => {
    const r = calcDischargePipeDiameterMm(45.234)
    expect(r.theoreticalDiameterMm).toBeCloseTo(103.2739233933953, 9)
    expect(r.dn).toBe(100)
    expect(r.diameterMm).toBe(110)
    expect(r.innerDiameterMm).toBeCloseTo(96.8, 9)
    expect(r.velocityMs).toBeCloseTo(1.707, 3)
    expect(r.warnings).toEqual([])
  })

  it('скорость считается по проходу, а не по наружному диаметру', () => {
    const r = calcDischargePipeDiameterMm(45.234)
    const flowM3s = 45.234 / 3600
    const byInner = (4 * flowM3s) / (Math.PI * (r.innerDiameterMm / 1000) ** 2)
    expect(r.velocityMs).toBeCloseTo(byInner, 9)
  })

  it('берётся DN, где скорость ближе всего к целевой; при равенстве — крупнее', () => {
    // Расход, при котором DN100 и DN150 одинаково далеки от 1,5 м/с:
    // q·(a + b) = 2·1,5, где a и b — 4/(π·d²) проходов 96,8 и 141 мм.
    const k = (d: number) => 4 / (Math.PI * (d / 1000) ** 2)
    const tie = ((2 * DEFAULT_DESIGN_VELOCITY_MS) / (k(96.8) + k(141))) * 3600
    expect(calcDischargePipeDiameterMm(tie * 0.999).dn).toBe(100)
    expect(calcDischargePipeDiameterMm(tie * 1.001).dn).toBe(150)
  })

  it('2 рабочих насоса вдвое уменьшают расход на насос → диаметр не больше', () => {
    const onePump = calcDischargePipeDiameterMm(90.468, 1)
    const twoPumps = calcDischargePipeDiameterMm(90.468, 2)
    expect(twoPumps.flowPerPumpM3h).toBe(onePump.flowPerPumpM3h / 2)
    expect(twoPumps.diameterMm).toBeLessThanOrEqual(onePump.diameterMm)
  })

  it('диаметр не убывает с расходом', () => {
    let prev = 0
    for (let q = 1; q <= 3000; q *= 1.07) {
      const d = calcDischargePipeDiameterMm(q).innerDiameterMm
      expect(d).toBeGreaterThanOrEqual(prev)
      prev = d
    }
  })

  it('workingPumps по умолчанию = 1', () => {
    expect(calcDischargePipeDiameterMm(90.468)).toEqual(calcDischargePipeDiameterMm(90.468, 1))
  })

  it('целевая скорость выше — диаметр не больше (2,5 м/с: DN80 вместо DN100)', () => {
    const r15 = calcDischargePipeDiameterMm(45.234, 1, 1.5)
    const r25 = calcDischargePipeDiameterMm(45.234, 1, 2.5)
    expect(r25.dn).toBe(80)
    expect(r25.diameterMm).toBeLessThan(r15.diameterMm)
    expect(r25.designVelocityMs).toBe(2.5)
  })

  it('свой ряд типоразмеров (вместо ряда патрубков)', () => {
    const sizes: PePipeSize[] = [
      { dn: 100, odMm: 100, wallMm: 0 },
      { dn: 200, odMm: 200, wallMm: 0 },
    ]
    // В стомиллиметровой 1,6 м/с, в двухсотой 0,4 — ближе к 1,5 первая.
    expect(calcDischargePipeDiameterMm(45.234, 1, 1.5, sizes).diameterMm).toBe(100)
  })

  it('расход больше максимума каталога → берётся максимум с предупреждением', () => {
    const r = calcDischargePipeDiameterMm(100000)
    expect(r.diameterMm).toBe(STANDARD_PE_OD_MM[STANDARD_PE_OD_MM.length - 1])
    expect(r.warnings.map((w) => w.code)).toEqual(['DIAMETER_ABOVE_CATALOG'])
    expect(r.velocityMs).toBeGreaterThan(DEFAULT_DESIGN_VELOCITY_MS)
  })

  it('малый расход: даже в DN50 скорость ниже диапазона — предупреждение об осадке', () => {
    const r = calcDischargePipeDiameterMm(2)
    expect(r.dn).toBe(50)
    expect(r.velocityMs).toBeLessThan(ECONOMIC_VELOCITY_MS.min)
    expect(r.warnings.map((w) => w.code)).toEqual(['VELOCITY_BELOW_RANGE'])
  })

  it('flowM3h = 0 → бросает ошибку', () => {
    expect(() => calcDischargePipeDiameterMm(0)).toThrow(/flowM3h/)
  })

  it('дробное число насосов → бросает ошибку', () => {
    expect(() => calcDischargePipeDiameterMm(90.468, 1.5)).toThrow(/workingPumps/)
  })
})

describe('selectPressurePiping — стояк, коллектор, напорная линия', () => {
  it('стояк идёт по расходу одного насоса, коллектор — по полному', () => {
    const r = selectPressurePiping(OL3487.flowM3h, OL3487.workingPumps, OL3487.outletCount)
    expect(r.riser.flowM3h).toBeCloseTo(45.234, 9)
    expect(r.collector.flowM3h).toBeCloseTo(90.468, 9)
    expect(r.collector.innerDiameterMm).toBeGreaterThan(r.riser.innerDiameterMm)
    expect(r.collectorWiderThanRiser).toBe(true)
  })

  // Проект ОЛ3487: стояк DN100, коллектор и напорные DN150.
  it('ОЛ3487 → стояк DN100 (1,71 м/с), коллектор и напорная DN150 (1,61 м/с), как в проекте', () => {
    const r = selectPressurePiping(OL3487.flowM3h, OL3487.workingPumps, OL3487.outletCount)
    expect(r.riser.dn).toBe(100)
    expect(r.collector.dn).toBe(150)
    expect(r.outlet.dn).toBe(150)
    expect(r.riser.velocityMs).toBeCloseTo(1.707, 3)
    expect(r.collector.velocityMs).toBeCloseTo(1.609, 3)
    for (const s of [r.riser, r.collector, r.outlet]) {
      expect(s.velocityMs).toBeGreaterThanOrEqual(ECONOMIC_VELOCITY_MS.min)
      expect(s.velocityMs).toBeLessThanOrEqual(ECONOMIC_VELOCITY_MS.max)
      expect(s.warnings).toEqual([])
    }
  })

  // Лист «Гидравл. расчет» — «работа на 1 нитку»: весь приток через одну
  // линию, пока вторая отключена. Раньше линия считалась на половину притока
  // и выходила DN125 (которого нет в ряду) при 0,80 м/с в проектной DN150.
  it('напорная линия считается на весь приток — работа на одну нитку', () => {
    const r = selectPressurePiping(OL3487.flowM3h, OL3487.workingPumps, OL3487.outletCount)
    expect(r.outlet.flowM3h).toBeCloseTo(90.468, 9)
    expect(r.outlet.dn).toBe(r.collector.dn)
    expect(r.outletCount).toBe(2)
    // Когда работают обе — приток пополам, скорость вдвое ниже.
    expect(r.outletParallelVelocityMs).toBeCloseTo(r.outlet.velocityMs / 2, 9)
  })

  it('одна напорная — скорость при параллельной работе та же', () => {
    const r = selectPressurePiping(90.468, 2, 1)
    expect(r.outletParallelVelocityMs).toBeCloseTo(r.outlet.velocityMs, 12)
  })

  // Один насос — сборки нет: собирать нечего, все три участка одинаковы.
  it('единственный рабочий насос: стояк, коллектор и выход совпадают', () => {
    const r = selectPressurePiping(45.234, 1, 1)
    expect(r.riser.dn).toBe(r.collector.dn)
    expect(r.collector.dn).toBe(r.outlet.dn)
    expect(r.collectorWiderThanRiser).toBe(false)
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

describe('checkOutletPipe — скорость в напорном DN из опросного листа', () => {
  it('ОЛ3487, DN150: 1,61 м/с на одну нитку, 0,80 м/с, когда работают обе', () => {
    const c = checkOutletPipe(OL3487.flowM3h, OL3487.outletDn, OL3487.outletCount)!
    expect(c.diameterMm).toBe(160)
    expect(c.innerDiameterMm).toBeCloseTo(141, 9)
    expect(c.flowM3h).toBe(90.468)
    expect(c.velocityMs).toBeCloseTo(1.609, 3)
    expect(c.parallelVelocityMs).toBeCloseTo(0.805, 3)
    expect(c.warnings).toEqual([])
  })

  it('DN мал для притока → предупреждение о скорости выше диапазона', () => {
    const c = checkOutletPipe(OL3487.flowM3h, 100, 2)!
    expect(c.velocityMs).toBeCloseTo(3.415, 3)
    expect(c.warnings.map((w) => w.code)).toEqual(['VELOCITY_ABOVE_RANGE'])
  })

  it('DN велик для притока → предупреждение об осадке', () => {
    const c = checkOutletPipe(OL3487.flowM3h, 300, 2)!
    expect(c.velocityMs).toBeLessThan(ECONOMIC_VELOCITY_MS.min)
    expect(c.warnings.map((w) => w.code)).toEqual(['VELOCITY_BELOW_RANGE'])
  })

  it('DN вне ряда или без ПЭ-трубы → null: проверять не по чему', () => {
    expect(checkOutletPipe(90.468, 125, 2)).toBeNull()
    expect(checkOutletPipe(90.468, 650, 2)).toBeNull()
  })

  it('некорректный вход → бросает ошибку', () => {
    expect(() => checkOutletPipe(0, 150, 2)).toThrow(/flowM3h/)
    expect(() => checkOutletPipe(90.468, 150, 0)).toThrow(/outletCount/)
  })
})
