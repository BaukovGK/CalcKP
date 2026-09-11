import { beforeEach, describe, expect, it } from 'vitest'
import { computeRow } from './row'
import { recalcFotSatellites } from './fot'
import type { NozzleNorm } from './formulas'
import { __resetIds, flattenRows, sectionEnabledFor, type CalcTree, type MaterializeContext } from './template-kns'
import { PRESSURE_PIPE_KITS } from './pressure-pipe-kit'
import { EMK_SECTIONS, KOL_SECTIONS, STRAPPING_ITEMS, type EmkSurveyParams, type KolSurveyParams } from './template-emk-kol'
import { materializeEmk, materializeKol } from './materialize'
import {
  computeEmkGeometry,
  computeKolGeometry,
  ellipticBottomsVolumeM3,
  matrixLengthBucketMm,
  neckCoverMassKg,
  tankMaterial,
  tankPipeLengthMm,
} from './survey-emk-kol'

// Наименования — ДОСЛОВНО из настоящего НН (prisma/seed-data/prices.json).
const PRICES: Record<string, number> = {
  'ФОТ|ФОТ|чел. ч': 1207.8,
  'Собственное производство|Придание изделию товарного вида|чел. ч': 1207.8,
  'Собственное производство|Механическая формовка плоского днища|кг': 214.4,
  'Собственное производство|Механическая формовка эллиптических днищ|кг': 214.4,
  'Собственное производство|Ламинация днища (косые и центральный стыки)|кг': 214.4,
  'Собственное производство|Ламинирование эллиптического днища к корпусу|кг': 310.2,
  'Собственное производство|Ламинирование дна к фальшполу|кг': 310.2,
  'Собственное производство|Формовка гильз|кг': 310.2,
  'Собственное производство|Прорезка отверстия под гильзу входящего патрубка|чел. ч': 1207.8,
  'Собственное производство|Прорезка отверстия под гильзу напорного патрубка (ов)|чел. ч': 1207.8,
  'Собственное производство|Изготовление Сороудерживающей корзины|чел. ч': 1207.8,
  'Собственное производство|Монтаж Сороудерживающей корзины|чел. ч': 1207.8,
  'Собственное производство|Изготовление направляющих корзины|чел. ч': 1207.8,
  'Собственное производство|Монтаж направляющих корзины|чел. ч': 1207.8,
  'Собственное производство|Механическая формовка горловины к корпусу|кг': 214.4,
  'Собственное производство|Ламинирование горловины к корпусу емкости|кг': 310.2,
  'Собственное производство|Прорезка отверстия для горловины обслуживания|чел. ч': 1207.8,
  'Собственное производство|Ручная формовка шахты обслуживания к корпусу|кг': 310.2,
  'Собственное производство|Ламинирование шахты обслуживания к корпусу|кг': 310.2,
  'Собственное производство|Прорезка отверстия шахты обслуживания|чел. ч': 1207.8,
  'Прочие материалы|Теплоизоляция - Изофом ППЭ ОР 15 1,5х40|м²': 750,
  'Собственное производство|Защитный слой ламинации 5 мм на теплоизоляцию|кг': 310.2,
  'Собственное производство|Защитный слой ламинации 4 мм на теплоизоляцию|кг': 310.2,
  'Собственное производство|Монтаж теплоизоляции|чел. ч': 1207.8,
  'Собственное производство|Изготовление Лестницы|чел. ч': 1207.8,
  'Собственное производство|Монтаж Лестницы|чел. ч': 1207.8,
}

const WEIGHTS: Record<string, number> = {
  '2000|0.6|5000': 507.9,
  '2000|0.6|2500': 400,
  '1500|0.6|2500': 250,
  // Реальных жёсткостей две — 5000 и 10000, поэтому неглубокий КОЛ теперь
  // приходит с SN 5000, а не 2500. Вес — из справочника (DN 1500; 0,6; 5000).
  '1500|0.6|5000': 224.3,
}

// Нормы простых патрубков, лист «Для расчетов» (seed-data/engineering.json):
// Мф по Ø — от неё ламинирование гильз, шахты и горловины к корпусу.
const NORMS: NozzleNorm[] = [
  { dn: 250, odMm: null, minLengthMm: null, moldingMassKg: 0.6, h1Mm: null, s1Mm: null, flangeMassKg: 2.3, bolt: 'М24х100', boltCount: 12 },
  { dn: 300, odMm: null, minLengthMm: null, moldingMassKg: 0.6, h1Mm: null, s1Mm: null, flangeMassKg: 3.1, bolt: 'М24х100', boltCount: 12 },
  { dn: 400, odMm: null, minLengthMm: null, moldingMassKg: 1.1, h1Mm: null, s1Mm: null, flangeMassKg: 4.6, bolt: 'М24х100', boltCount: 16 },
  { dn: 500, odMm: null, minLengthMm: null, moldingMassKg: 1.9, h1Mm: null, s1Mm: null, flangeMassKg: 6.4, bolt: 'М27х110', boltCount: 20 },
  { dn: 1000, odMm: null, minLengthMm: null, moldingMassKg: 7.2, h1Mm: null, s1Mm: null, flangeMassKg: 23, bolt: null, boltCount: null },
  { dn: 1200, odMm: null, minLengthMm: null, moldingMassKg: 10.3, h1Mm: null, s1Mm: null, flangeMassKg: 36, bolt: null, boltCount: null },
]

/** Мс при PN 4 — значение, которое эталон берёт для стыков (лист «Для расчетов»). */
const JOINT_LAYER_MASS: Record<number, number> = { 3000: 112, 2000: 35 }

/**
 * Ячейки матрицы «Формовка эллиптических днищ» (лист «Для расчетов»,
 * prisma/seed-data/engineering.json): одно днище, кг, и его толщина, мм.
 */
const ELLIPTIC: Record<string, { massKg: number; thicknessMm: number }> = {
  '2000|5000': { massKg: 133, thicknessMm: 16 },
  '2000|6000': { massKg: 144, thicknessMm: 17 },
  '2000|6500': { massKg: 149, thicknessMm: 17 },
  '2000|12000': { massKg: 196, thicknessMm: 23 },
  '3000|12000': { massKg: 586, thicknessMm: 34 },
}

const ctx: MaterializeContext = {
  priceOf: (c, n, u) => PRICES[`${c}|${n}|${u}`] ?? null,
  pipeWeightOf: (dn, pn, sn) => WEIGHTS[`${dn}|${pn}|${sn}`] ?? null,
  nozzleNormOf: (dn) => NORMS.find((n) => n.dn === dn) ?? null,
  jointLayerMassOf: (d) => JOINT_LAYER_MASS[d] ?? null,
  // Строка длины — тем же правилом, что в сторе (stores/calcTree.ts).
  ellipticBottomOf: (dn, lengthMm) => ELLIPTIC[`${dn}|${matrixLengthBucketMm(lengthMm)}`] ?? null,
  priceListVersion: 1,
}

/** Тот же контекст без справочника Мс — для проверки поведения при промахе. */
const ctxNoJoint: MaterializeContext = { ...ctx, jointLayerMassOf: () => null }

beforeEach(() => __resetIds())

// ─────────────────────────────────────────────────────────────────────────────
// Геометрия ЕМК
// ─────────────────────────────────────────────────────────────────────────────

describe('ЕМК: габариты из объёма (Реверс §5)', () => {
  it('длина трубы = CEILING(4V/(π·D²)·1000; 100)', () => {
    // V = 50 м³, DN 2000 -> 4·50/(π·2²) = 15,915 м -> 15 915 -> 16 000 мм
    expect(tankPipeLengthMm(50, 2000)).toBe(16000)
  })

  it('округляется ВВЕРХ до 100 мм', () => {
    const l = tankPipeLengthMm(10, 2000)!
    expect(l % 100).toBe(0)
    // Точное значение 3183 мм -> 3200
    expect(l).toBe(3200)
  })

  it('нулевой объём или DN не дают длины', () => {
    expect(tankPipeLengthMm(0, 2000)).toBeNull()
    expect(tankPipeLengthMm(50, 0)).toBeNull()
  })

  // Лист «для шапки», F6/G7: у горизонтальной часть объёма дают два
  // эллиптических днища, π·D³/15, — трубы на их объём меньше.
  it('горизонтальная: из объёма вычитаются днища — образец листа 13 400 мм', () => {
    expect(tankPipeLengthMm(100, 3000, true)).toBe(13400)
    expect(tankPipeLengthMm(100, 3000)).toBe(14200)
    // V 50 м³, DN 2000: (50 − 1,6755) → 15 382 → 15 400 мм.
    expect(tankPipeLengthMm(50, 2000, true)).toBe(15400)
    // Объём не больше объёма днищ — трубы нет, длину вводят вручную.
    expect(tankPipeLengthMm(1, 2000, true)).toBeNull()
  })

  it('габарит горизонтальной — труба плюс 1,5 м под днища, у вертикальной — труба', () => {
    const h = computeEmkGeometry({ volumeM3: 50, dn: 2000, placement: 'горизонтальное', installation: 'подземная', hasShaft: false })
    const v = computeEmkGeometry({ volumeM3: 50, dn: 2000, placement: 'вертикальное', installation: 'подземная', hasShaft: false })
    expect(h.pipeLengthMm).toBe(15400)
    expect(h.overallLengthMm).toBe(16900)
    expect(v.overallLengthMm).toBe(v.pipeLengthMm)
  })

  it('ручная длина из ОЛ перекрывает расчётную — и габарит, и SN следуют за ней', () => {
    const g = computeEmkGeometry({ volumeM3: 50, dn: 2000, placement: 'горизонтальное', installation: 'подземная', pipeLengthMm: 5000, hasShaft: false })
    expect(g.pipeLengthMm).toBe(5000)
    expect(g.overallLengthMm).toBe(6500)
    const calc = computeEmkGeometry({ volumeM3: 50, dn: 2000, placement: 'горизонтальное', installation: 'подземная', hasShaft: false })
    expect(g.sn).not.toBe(calc.sn)
  })

  // Строки матриц «Для расчетов» — «До 3 м», «До 3,5» … «До 7 м», «До 12»
  // (эталон H4 листа «Калькулятор ЕМК»).
  it('строка матрицы по длине: до 3 м, шагом 0,5 м до 7 м, дальше «До 12»', () => {
    expect(matrixLengthBucketMm(1800)).toBe(3000)
    expect(matrixLengthBucketMm(3000)).toBe(3000)
    expect(matrixLengthBucketMm(3001)).toBe(3500)
    expect(matrixLengthBucketMm(6400)).toBe(6500)
    expect(matrixLengthBucketMm(7000)).toBe(7000)
    expect(matrixLengthBucketMm(7001)).toBe(12000)
    expect(matrixLengthBucketMm(16000)).toBe(12000)
  })

  it('объём двух эллиптических днищ = π·(DN/1000)³/15', () => {
    expect(ellipticBottomsVolumeM3(2000)).toBeCloseTo((Math.PI * 8) / 15, 9)
  })

  it('подземная установка даёт возвышение 300 мм, наземная — 0', () => {
    const p = computeEmkGeometry({ volumeM3: 50, dn: 2000, placement: 'вертикальное', installation: 'подземная', hasShaft: false })
    const n = computeEmkGeometry({ volumeM3: 50, dn: 2000, placement: 'вертикальное', installation: 'наземная', hasShaft: false })
    expect(p.elevationMm).toBe(300)
    expect(n.elevationMm).toBe(0)
  })

  it('шахта обслуживания появляется только по флагу', () => {
    const withShaft = computeEmkGeometry({ volumeM3: 50, dn: 2000, placement: 'вертикальное', installation: 'подземная', hasShaft: true })
    const without = computeEmkGeometry({ volumeM3: 50, dn: 2000, placement: 'вертикальное', installation: 'подземная', hasShaft: false })
    expect(withShaft.shaftDiameterMm).toBe(1200)
    expect(withShaft.shaftHeightMm).toBe(2300) // подземная выше наземной
    expect(withShaft.shaftCount).toBe(1)
    expect(without.shaftDiameterMm).toBe(0)
    expect(without.shaftCount).toBe(0)
  })

  it('число шахт из ОЛ; пустое — одна', () => {
    const base = { volumeM3: 50, dn: 2000, placement: 'горизонтальное' as const, installation: 'подземная' as const, hasShaft: true }
    expect(computeEmkGeometry({ ...base, shaftCount: 2 }).shaftCount).toBe(2)
    expect(computeEmkGeometry({ ...base, shaftCount: null }).shaftCount).toBe(1)
    expect(computeEmkGeometry({ ...base, shaftCount: 0 }).shaftCount).toBe(1)
  })

  it('размеры шахты из ОЛ перекрывают типовые', () => {
    const g = computeEmkGeometry({
      volumeM3: 50, dn: 2000, placement: 'вертикальное', installation: 'подземная',
      hasShaft: true, shaftDiameterMm: 1500, shaftHeightMm: 3000,
    })
    expect(g.shaftDiameterMm).toBe(1500)
    expect(g.shaftHeightMm).toBe(3000)
  })
})

describe('ЕМК: материал зависит от среды (эталон D8)', () => {
  it('химстойкая → СК/ВЭС', () => {
    expect(tankMaterial('Химстойкая')).toBe('СК/ВЭС')
  })

  it('остальные типы → СК/НПС', () => {
    for (const t of ['Накопительная', 'Аккумулирующая', 'Питьевая', 'С насосным оборудованием'] as const) {
      expect(tankMaterial(t)).toBe('СК/НПС')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Материализация ЕМК
// ─────────────────────────────────────────────────────────────────────────────

const EMK: EmkSurveyParams = {
  dn: 2000,
  volumeM3: 50,
  placement: 'вертикальное',
  installation: 'подземная',
  tankType: 'Накопительная',
  pnSurvey: 0.1,
  hasShaft: true,
  inletDn: 150,
  inletCount: 1,
  outletDn: 150,
  outletCount: 1,
  hasPumps: false,
  pumpsWorking: 0,
  pumpsReserve: 0,
  hasBasket: true,
  insulationEnabled: true,
  insulationDepthMm: 2000,
}

describe('материализация ЕМК', () => {
  it('создаётся ВОСЕМЬ разделов — у ёмкости их больше, чем у КНС', () => {
    const tree = materializeEmk(ctx, EMK)
    expect(tree.sections).toHaveLength(8)
    expect(tree.sections.map((s) => s.title)).toEqual(EMK_SECTIONS.map((s) => s.title))
    expect(tree.deviceType).toBe('EMK')
  })

  it('порядок разделов ЕМК отличается от КНС: корзина идёт второй', () => {
    const tree = materializeEmk(ctx, EMK)
    expect(tree.sections[1]!.title).toBe('Корзина')
    expect(tree.sections[2]!.title).toBe('Лестница')
  })

  it('вертикальная ёмкость получает ПЛОСКОЕ днище', () => {
    const rows = flattenRows(materializeEmk(ctx, EMK))
    expect(rows.some((r) => r.name === 'Механическая формовка плоского днища')).toBe(true)
    expect(rows.some((r) => r.name === 'Механическая формовка эллиптических днищ')).toBe(false)
  })

  it('горизонтальная ёмкость получает ЭЛЛИПТИЧЕСКИЕ днища', () => {
    const rows = flattenRows(materializeEmk(ctx, { ...EMK, placement: 'горизонтальное' }))
    expect(rows.some((r) => r.name === 'Механическая формовка эллиптических днищ')).toBe(true)
    expect(rows.some((r) => r.name === 'Механическая формовка плоского днища')).toBe(false)
  })

  // Днищ два — по одному на каждом конце трубы. Масса одного — ячейка
  // матрицы «Формовка эллиптических днищ» по DN и строке длины: V 50 м³ при
  // DN 2000 даёт трубу 16 000 мм → строка «До 12».
  it('эллиптические: масса 2 днищ — из матрицы по DN и длине трубы', () => {
    const rows = flattenRows(materializeEmk(ctx, { ...EMK, placement: 'горизонтальное' }))
    const row = rows.find((r) => r.name === 'Механическая формовка эллиптических днищ')!
    expect(row.qtyCalc).toBe(2 * 196)
    expect(row.note).toContain('2 днища × 196 кг')
    expect(row.note).toContain('L до 12 м')
    expect(row.note).toContain('толщина 23 мм')
  })

  it('эллиптические: строка матрицы следует за длиной — V 20 м³ → 5 900 мм → «До 6 м»', () => {
    const rows = flattenRows(materializeEmk(ctx, { ...EMK, volumeM3: 20, placement: 'горизонтальное' }))
    const row = rows.find((r) => r.name === 'Механическая формовка эллиптических днищ')!
    expect(row.qtyCalc).toBe(2 * 144)
  })

  // Крепление к трубе — ламинирование по Мс: масса формованных слоёв стыка
  // по DN трубы при минимальном PN. Стыков два — по днищу на каждом конце.
  it('эллиптические: ламинирование к корпусу = 2 × Мс (DN трубы, минимальное PN)', () => {
    const rows = flattenRows(materializeEmk(ctx, { ...EMK, placement: 'горизонтальное' }))
    const row = rows.find((r) => r.name === 'Ламинирование эллиптического днища к корпусу')!
    expect(row.qtyCalc).toBe(2 * 35)
    expect(row.note).toContain('Мс 35 кг')
    // Цена — из прайса, ФОТ — спутником с коэффициентом ламинирования.
    expect(row.priceCatalog).toBe(310.2)
    const fot = rows[rows.indexOf(row) + 1]!
    expect(fot.name).toBe('ФОТ')
    expect(fot.fotK).toBe(0.56)
  })

  it('эллиптические: труба — ровно на корпус, без прибавки', () => {
    const rows = flattenRows(materializeEmk(ctx, { ...EMK, placement: 'горизонтальное' }))
    // V 50 м³ за вычетом днищ → 15 400 мм.
    expect(rows.find((r) => r.name.startsWith('Труба СК/НПС-К 2000'))!.qtyCalc).toBe(15.4)
    expect(rows.some((r) => r.name === 'Ламинация днища (косые и центральный стыки)')).toBe(false)
  })

  // Матрица дискретна: DN вне её — пустое количество с подсказкой, а не
  // интерполяция и не выдуманное число.
  it('эллиптические: без ячейки матрицы масса не выдумывается', () => {
    const noMatrix: MaterializeContext = { ...ctx, ellipticBottomOf: () => null }
    const rows = flattenRows(materializeEmk(noMatrix, { ...EMK, placement: 'горизонтальное' }))
    const row = rows.find((r) => r.name === 'Механическая формовка эллиптических днищ')!
    expect(row.qtyCalc).toBeNull()
    expect(row.note).toContain('введите вручную')
  })

  // Цилиндрические — концы из той же трубы (эталон «новый способ»): трубы
  // больше на 1,5 м, стыки косые и центральный, лист «Калькулятор ЕМК»,
  // строки 13 и 25.
  it('цилиндрические: ламинация стыков = (Мс/0,707 + Мс/2)·2', () => {
    const rows = flattenRows(materializeEmk(ctx, { ...EMK, dn: 3000, placement: 'горизонтальное', bottomType: 'цилиндрические' }))
    const row = rows.find((r) => r.name === 'Ламинация днища (косые и центральный стыки)')!
    // Мс(3000) = 112 кг → 428,83 кг, ровно как в эталоне.
    expect(row.qtyCalc).toBeCloseTo(428.83, 2)
    expect(row.note).toContain('Мс 112 кг')
    expect(rows.some((r) => r.name === 'Механическая формовка эллиптических днищ')).toBe(false)
    expect(rows.some((r) => r.name === 'Ламинирование эллиптического днища к корпусу')).toBe(false)
  })

  it('цилиндрические: трубы на 1,5 м больше — днища из неё же', () => {
    const rows = flattenRows(materializeEmk(ctx, { ...EMK, placement: 'горизонтальное', bottomType: 'цилиндрические' }))
    const pipe = rows.find((r) => r.name.startsWith('Труба СК/НПС-К 2000'))!
    // 15 400 мм корпуса + 1,5 м на днища.
    expect(pipe.qtyCalc).toBe(16.9)
    expect(pipe.note).toContain('+ 1,5 м на цилиндрические днища')
    const tree = materializeEmk(ctx, { ...EMK, placement: 'горизонтальное', bottomType: 'цилиндрические' })
    const titles = tree.sections.flatMap((s) => s.components.map((c) => c.title))
    expect(titles).toContain('Днища цилиндрические ×2')
  })

  it('без справочника Мс ламинация просит ручной ввод, а не выдумывает число', () => {
    const cyl = flattenRows(materializeEmk(ctxNoJoint, { ...EMK, dn: 3000, placement: 'горизонтальное', bottomType: 'цилиндрические' }))
    const row = cyl.find((r) => r.name === 'Ламинация днища (косые и центральный стыки)')!
    expect(row.qtyCalc).toBeNull()
    expect(row.note).toContain('введите вручную')
    const ell = flattenRows(materializeEmk(ctxNoJoint, { ...EMK, placement: 'горизонтальное' }))
    expect(ell.find((r) => r.name === 'Ламинирование эллиптического днища к корпусу')!.qtyCalc).toBeNull()
  })

  it('у вертикальной тумблер днищ ни на что не влияет: дно плоское, трубы — на корпус', () => {
    const rows = flattenRows(materializeEmk(ctx, { ...EMK, bottomType: 'цилиндрические' }))
    expect(rows.some((r) => r.name === 'Механическая формовка плоского днища')).toBe(true)
    expect(rows.some((r) => r.name === 'Ламинация днища (косые и центральный стыки)')).toBe(false)
    expect(rows.find((r) => r.name.startsWith('Труба СК/НПС-К 2000'))!.qtyCalc).toBe(16)
  })

  // Раньше ОЛ показывал ручные длину и SN, а расчёт считал трубу по объёму.
  it('ручные длина трубы и SN из ОЛ доходят до расчёта', () => {
    const rows = flattenRows(materializeEmk(ctx, { ...EMK, placement: 'горизонтальное', pipeLengthMm: 5000, sn: 10000 }))
    const pipe = rows.find((r) => r.name.startsWith('Труба СК/НПС-К 2000'))!
    expect(pipe.name).toBe('Труба СК/НПС-К 2000-0,1-10000')
    expect(pipe.qtyCalc).toBe(5)
    expect(pipe.note).toContain('из ОЛ')
    // Строка матрицы днищ — по той же длине: 5 000 мм → «До 5 м».
    expect(rows.find((r) => r.name === 'Механическая формовка эллиптических днищ')!.qtyCalc).toBe(2 * 133)
  })

  // Раньше тумблеры «Лестница» и «Вентиляция» ОЛ до расчёта не доходили:
  // разделы строились всегда, а превью листа считало их выключенными.
  it('лестница и вентстояк следуют за тумблерами ОЛ', () => {
    const tree = materializeEmk(ctx, { ...EMK, hasLadder: false, ventilation: false })
    const ladder = tree.sections.find((s) => s.title === 'Лестница')!.components[0]!
    const vent = tree.sections.find((s) => s.code === '5')!.components[0]!
    expect(ladder.title).toBe('Лестница нержавеющая')
    expect([ladder.enabled, ladder.enabledCalc]).toEqual([false, false])
    expect([vent.enabled, vent.enabledCalc]).toEqual([false, false])
  })

  it('без ответов ОЛ (расчёт до появления полей) лестница и стояк включены', () => {
    const tree = materializeEmk(ctx, EMK)
    const ladder = tree.sections.find((s) => s.code === '3')!.components[0]!
    const vent = tree.sections.find((s) => s.code === '5')!.components[0]!
    expect([ladder.enabled, ladder.enabledCalc]).toEqual([true, true])
    expect([vent.enabled, vent.enabledCalc]).toEqual([true, true])
  })

  // Лестница горизонтальной ёмкости ведёт через шахту на дно: DN + h шахты
  // (эталон I114). Раньше бралась длина корпуса — 17,5 м вместо 4,3 м.
  it('лестница горизонтальной ёмкости — на диаметр плюс высоту шахты', () => {
    const rows = flattenRows(materializeEmk(ctx, { ...EMK, placement: 'горизонтальное' }))
    // DN 2000 + h шахты 2300 (типовая у подземной) = 4,3 м → 1,25 × 4,3.
    expect(rows.find((r) => r.name === 'Изготовление Лестницы')!.qtyCalc).toBeCloseTo(5.375, 9)
    const noShaft = flattenRows(materializeEmk(ctx, { ...EMK, placement: 'горизонтальное', hasShaft: false }))
    expect(noShaft.find((r) => r.name === 'Изготовление Лестницы')!.qtyCalc).toBeCloseTo(2.5, 9)
  })

  it('лестница вертикальной ёмкости — во всю высоту корпуса', () => {
    const rows = flattenRows(materializeEmk(ctx, EMK))
    // V 50 м³ при DN 2000 — корпус 16 000 мм → 1,25 × 16.
    expect(rows.find((r) => r.name === 'Изготовление Лестницы')!.qtyCalc).toBeCloseTo(20, 9)
  })

  it('химстойкая ёмкость меняет марку трубы на СК/ВЭС', () => {
    const rows = flattenRows(materializeEmk(ctx, { ...EMK, tankType: 'Химстойкая' }))
    expect(rows.some((r) => r.name.startsWith('Труба СК/ВЭС-К'))).toBe(true)
  })

  it('шахта обслуживания появляется только по флагу ОЛ', () => {
    const withShaft = flattenRows(materializeEmk(ctx, EMK))
    const without = flattenRows(materializeEmk(ctx, { ...EMK, hasShaft: false }))
    expect(withShaft.some((r) => r.name.includes('шахты обслуживания'))).toBe(true)
    expect(without.some((r) => r.name.includes('шахты обслуживания'))).toBe(false)
  })

  it('шахта — отрезок трубы своего DN, длиной в свою высоту', () => {
    const rows = flattenRows(materializeEmk(ctx, EMK))
    // Труб в расчёте две: корпус DN 2000 и шахта DN 1200.
    const shaftPipe = rows.find((r) => r.name.startsWith('Труба СК/НПС-К 1200-'))
    expect(shaftPipe).toBeDefined()
    expect(shaftPipe!.unit).toBe('м')
    expect(shaftPipe!.qtyCalc).toBe(2.3) // h 2300 мм
    // Цена трубы договорная — как у корпуса.
    expect(shaftPipe!.priceCatalog).toBeNull()
  })

  it('цена трубы шахты — своё поле ОЛ, связанное со строкой', () => {
    const rows = flattenRows(materializeEmk(ctx, { ...EMK, pipePriceRub: 48_000, servicePipePriceRub: 21_000 }))
    const shaftPipe = rows.find((r) => r.name.startsWith('Труба СК/НПС-К 1200-'))!
    const corpusPipe = rows.find((r) => r.name.startsWith('Труба СК/НПС-К 2000-'))!
    expect(shaftPipe.priceBinding).toBe('servicePipePrice')
    expect(shaftPipe.priceManual).toBe(21_000)
    // Цена корпуса на трубу шахты не переезжает: диаметры разные.
    expect(corpusPipe.priceManual).toBe(48_000)
  })

  it('DN шахты из ОЛ попадает в наименование трубы', () => {
    const rows = flattenRows(materializeEmk(ctx, { ...EMK, shaftDiameterMm: 1500, shaftHeightMm: 3000 }))
    const shaftPipe = rows.find((r) => r.name.startsWith('Труба СК/НПС-К 1500-'))
    expect(shaftPipe?.qtyCalc).toBe(3)
  })

  it('без насосов напорный трубопровод пуст, с насосами — наполнен', () => {
    const noPumps = materializeEmk(ctx, EMK)
    const withPumps = materializeEmk(ctx, { ...EMK, hasPumps: true, pumpsWorking: 2, pumpsReserve: 1 })
    const sec = (t: ReturnType<typeof materializeEmk>) => t.sections.find((s) => s.code === '6')!
    expect(sec(noPumps).components).toHaveLength(0)
    expect(sec(withPumps).components.length).toBeGreaterThan(0)
  })

  it('корзина выключается флагом, но строки остаются призраками', () => {
    const off = materializeEmk(ctx, { ...EMK, hasBasket: false })
    const basket = off.sections.find((s) => s.code === '2')!.components[0]!
    expect(basket.enabled).toBe(false)
    expect(basket.rows.length).toBeGreaterThan(0)
  })

  // Прежде корзина была четырьмя строками работ с нормами «уточните».
  it('корзина — по листу ёмкости: металл, подвес и работы', () => {
    const tree = materializeEmk(ctx, { ...EMK, inletTrayDepthMm: 2400 })
    const basket = tree.sections.find((s) => s.code === '2')!.components[0]!
    expect(basket.rows).toHaveLength(10)
    expect(basket.rows.find((r) => r.name.startsWith('Цепь'))?.qtyCalc).toBe(4)
    expect(basket.rows.some((r) => r.note?.includes('уточните'))).toBe(false)
  })

  it('у ёмкости узла дробилки нет — в листе его нет тоже', () => {
    const tree = materializeEmk(ctx, EMK)
    const titles = tree.sections.flatMap((s) => s.components.map((c) => c.title))
    expect(titles.some((t) => t.startsWith('Дробилка'))).toBe(false)
  })

  it('труба ёмкости рождается «красной»: цена договорная', () => {
    const pipe = flattenRows(materializeEmk(ctx, EMK)).find((r) => r.name.startsWith('Труба СК'))!
    expect(computeRow(pipe).missingPrice).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Материализация КОЛ
// ─────────────────────────────────────────────────────────────────────────────

const KOL: KolSurveyParams = {
  dn: 1500,
  workingDepthMm: 2500,
  elevationMm: 200,
  pnSurvey: 0.1,
  hasNeck: true,
  neckHeightMm: 800,
  neckDiameterMm: 1000,
  inletDn: 150,
  inletCount: 1,
  outletDn: 150,
  outletCount: 1,
  hasBasket: false,
  underRoadway: false,
  insulationEnabled: false,
  insulationDepthMm: 0,
}

describe('КОЛ: геометрия с горловиной', () => {
  it('горловина добавляется к глубине корпуса (эталон H5/N5)', () => {
    const g = computeKolGeometry(KOL)
    // 2500 + (800 + 200) = 3500
    expect(g.totalDepthMm).toBe(3500)
    expect(g.neckHeightMm).toBe(1000)
  })

  it('с горловиной труба корпуса — рабочая часть, возвышение идёт в горловину', () => {
    const g = computeKolGeometry(KOL)
    expect(g.shellLengthMm).toBe(2500)
    expect(g.neckHeightMm).toBe(1000)
  })

  // Эталон H5 = IF(горловина; глубина; глубина + возвышение).
  it('без горловины возвышение идёт в трубу корпуса', () => {
    const g = computeKolGeometry({ ...KOL, hasNeck: false })
    expect(g.shellLengthMm).toBe(2700)
    expect(g.totalDepthMm).toBe(2700)
    expect(g.neckHeightMm).toBe(0)
    expect(g.neckDiameterMm).toBe(0)
  })

  it('«под проезжей частью» поднимает SN на ступень', () => {
    const plain = computeKolGeometry(KOL)
    const road = computeKolGeometry({ ...KOL, underRoadway: true })
    expect(road.sn!).toBeGreaterThan(plain.sn!)
  })

  it('масса крышки горловины по площади: Ø1000 ≈ 8,7 кг', () => {
    expect(neckCoverMassKg(1000)).toBeCloseTo(Math.PI * 0.5 ** 2 * 0.006 * 1850, 6)
  })
})

describe('материализация КОЛ', () => {
  it('лестница колодца следует за тумблером ОЛ; вентстояк — всегда: вопроса нет', () => {
    const tree = materializeKol(ctx, { ...KOL, hasLadder: false })
    const ladder = tree.sections.find((s) => s.code === '3')!.components[0]!
    const vent = tree.sections.find((s) => s.code === '5')!.components[0]!
    expect([ladder.enabled, ladder.enabledCalc]).toEqual([false, false])
    expect(vent.enabled).toBe(true)
    expect(vent.enabledCalc).toBeUndefined()
  })

  it('лестница колодца — на полную глубину корпуса с горловиной', () => {
    const rows = flattenRows(materializeKol(ctx, KOL))
    // 2500 + (800 + 200) = 3500 мм → 1,25 × 3,5.
    expect(rows.find((r) => r.name === 'Изготовление Лестницы')!.qtyCalc).toBeCloseTo(4.375, 9)
  })

  it('SN из ОЛ, в т. ч. ручной, доходит до трубы корпуса', () => {
    const rows = flattenRows(materializeKol(ctx, { ...KOL, sn: 10000 }))
    expect(rows.some((r) => r.name === 'Труба СК/НПС-К 1500-0,1-10000')).toBe(true)
  })

  it('цена трубы горловины — своё поле ОЛ, связанное со строкой', () => {
    const rows = flattenRows(materializeKol(ctx, { ...KOL, servicePipePriceRub: 15_500 }))
    const neckPipe = rows.find((r) => r.name.startsWith('Труба СК/НПС-К 1000-'))!
    expect(neckPipe.priceBinding).toBe('servicePipePrice')
    expect(neckPipe.priceManual).toBe(15_500)
  })

  it('дробилка колодца — в корпусе и по флагу ОЛ (лист, строки 67–75)', () => {
    const on = materializeKol(ctx, { ...KOL, hasGrinder: true, inletTrayDepthMm: 2000 })
    const grinder = on.sections.find((s) => s.code === '1')!.components.find((c) => c.title.startsWith('Дробилка'))!
    expect(grinder.enabled).toBe(true)
    expect(grinder.rows.find((r) => r.name.startsWith('Цепь'))?.qtyCalc).toBe(3)

    const off = materializeKol(ctx, KOL)
    const ghost = off.sections.find((s) => s.code === '1')!.components.find((c) => c.title.startsWith('Дробилка'))!
    expect(ghost.enabled).toBe(false)
  })

  it('создаётся СЕМЬ разделов — и БЕЗ напорного трубопровода (Реверс §6)', () => {
    const tree = materializeKol(ctx, KOL)
    expect(tree.sections).toHaveLength(7)
    expect(tree.sections.map((s) => s.title)).toEqual(KOL_SECTIONS.map((s) => s.title))
    // Ключевое отличие от ЕМК: насосов в колодце нет.
    expect(tree.sections.some((s) => s.title.includes('Напорный'))).toBe(false)
    expect(tree.deviceType).toBe('KOL')
  })

  it('горловина материализуется по флагу ОЛ', () => {
    const withNeck = flattenRows(materializeKol(ctx, KOL))
    const without = flattenRows(materializeKol(ctx, { ...KOL, hasNeck: false }))
    expect(withNeck.some((r) => r.name === 'Ламинирование горловины к корпусу емкости')).toBe(true)
    expect(without.some((r) => r.name === 'Ламинирование горловины к корпусу емкости')).toBe(false)
  })

  // Лист колодца, N5 = h горловины + возвышение; марка трубы — SN 2500, PN 0,1.
  it('горловина — отрезок трубы своего DN, высотой с возвышением', () => {
    const rows = flattenRows(materializeKol(ctx, KOL))
    const neckPipe = rows.find((r) => r.name.startsWith('Труба СК/НПС-К 1000-'))
    expect(neckPipe?.name).toBe('Труба СК/НПС-К 1000-0,1-2500')
    expect(neckPipe!.unit).toBe('м')
    expect(neckPipe!.qtyCalc).toBeCloseTo(1.0, 6) // h 800 + возвышение 200
    expect(neckPipe!.priceCatalog).toBeNull()
  })

  // Крышка люка — не часть горловины: в листе она в разделе 4.
  it('горловина ламинируется к корпусу по Мф своего диаметра; крышка — в люке', () => {
    const tree = materializeKol(ctx, KOL)
    const neck = tree.sections.find((s) => s.code === '1')!.components.find((c) => c.nodeCode === 'A8')!
    expect(neck.rows.find((r) => r.name === 'Ламинирование горловины к корпусу емкости')!.qtyCalc).toBe(7.2)
    expect(neck.rows.some((r) => r.name.includes('крышки') || r.name.includes('формовка горловины'))).toBe(false)
    const hatch = tree.sections.find((s) => s.code === '4')!.components.find((c) => c.title.startsWith('Люк'))!
    expect(hatch.title).toBe('Люк горловины Ø1000')
    expect(hatch.rows[0]!.qtyCalc).toBeCloseTo(neckCoverMassKg(1000), 9)
  })

  it('труба корпуса — рабочая часть: горловина идёт своей трубой', () => {
    // DN в поиске обязателен: труба корпуса и труба горловины различаются
    // только им, и без него нашлась бы первая попавшаяся.
    const pipe = flattenRows(materializeKol(ctx, KOL)).find((r) => r.name.startsWith('Труба СК/НПС-К 1500-'))!
    expect(pipe.qtyCalc).toBeCloseTo(2.5, 6)
    expect(pipe.note).toContain('горловина своей трубой')
    const noNeck = flattenRows(materializeKol(ctx, { ...KOL, hasNeck: false })).find((r) => r.name.startsWith('Труба СК/НПС-К 1500-'))!
    expect(noNeck.qtyCalc).toBeCloseTo(2.7, 6)
  })

  // У колодца защитный слой 4 мм, у КНС/ЕМК — 5 мм (Реверс §4.3).
  // Это РАЗНЫЕ позиции прайса, и ошибка дала бы «красную» строку.
  it('защитный слой теплоизоляции — 4 мм, а не 5', () => {
    const rows = flattenRows(materializeKol(ctx, { ...KOL, insulationEnabled: true, insulationDepthMm: 1500 }))
    expect(rows.some((r) => r.name === 'Защитный слой ламинации 4 мм на теплоизоляцию')).toBe(true)
    expect(rows.some((r) => r.name === 'Защитный слой ламинации 5 мм на теплоизоляцию')).toBe(false)
  })

  // Лист ЕМК, строка 51: «4 мм» и 0,004·1850 — как у колодца.
  it('у ЕМК слой тоже 4 мм', () => {
    const rows = flattenRows(materializeEmk(ctx, EMK))
    expect(rows.some((r) => r.name === 'Защитный слой ламинации 4 мм на теплоизоляцию')).toBe(true)
    expect(rows.some((r) => r.name === 'Защитный слой ламинации 5 мм на теплоизоляцию')).toBe(false)
  })

  // Лист ЕМК, D37: гильза из трубы — от DN 200; меньше — ручная формовка.
  it('патрубок DN150: ручная формовка 0,5 кг и ламинирование Мф(Ø250)·3/10', () => {
    const rows = flattenRows(materializeKol(ctx, KOL))
    expect(rows.filter((r) => r.name === 'Ручная формовка патрубка').map((r) => r.qtyCalc)).toEqual([0.5, 0.5])
    const lam = rows.filter((r) => r.name === 'Ламинирование патрубка к корпусу')
    expect(lam[0]!.qtyCalc).toBeCloseTo(0.18, 9)
    expect(lam[0]!.fotK).toBe(1)
    expect(rows.some((r) => r.name === 'Формовка гильз')).toBe(false)
    expect(rows.some((r) => r.name.startsWith('Труба СК/НПС-К 250-'))).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Патрубки под стеклокомпозитную трубу
// ─────────────────────────────────────────────────────────────────────────────

// Под стеклокомпозитную трубу патрубок сам стеклопластиковый (уточнение
// завода 11.09.2026): у ёмкости — гильза и фланец, у колодца — гильза и
// муфта. Гильза до DN 300 включительно формуется по норме Мф, крупнее —
// отрезок трубы. В листах эта ветка не работает: у ёмкости материал вписан
// числом «ПЭ», у колодца подводящий ссылается на ячейку своего же листа.
describe('патрубки под стеклокомпозитную трубу', () => {
  const nozzles = (tree: CalcTree) =>
    tree.sections.find((s) => s.code === '1')!.components.filter((c) => c.nodeCode === 'A5')

  it('ёмкость DN300: формованная гильза Ø400 и стеклокомпозитный фланец по DN', () => {
    const [inlet, outlet] = nozzles(materializeEmk(ctx, { ...EMK, inletDn: 300, inletCount: 2, inletMaterial: 'стеклокомпозит' }))
    expect(inlet!.title).toBe('Патрубок подводящий стеклопластиковый DN300 ×2')
    const rows = inlet!.rows
    // Гильза Ø400: Мф 1,1 кг × 2.
    const formed = rows.find((r) => r.name === 'Формовка гильз')!
    expect(formed.qtyCalc).toBeCloseTo(2.2, 9)
    expect(formed.fotK).toBe(1)
    expect(formed.priceCatalog).toBe(310.2)
    // Фланец — по DN трубы: Мф фланца(DN300) 3,1 кг × 2.
    const flange = rows.find((r) => r.name === 'Ручная формовка стеклокомпозитного фланца')!
    expect(flange.qtyCalc).toBeCloseTo(6.2, 9)
    expect(flange.fotK).toBe(1)
    // Фланцевому соединению — болтовой комплект: DN300 — 12 отверстий М24х100 × 2.
    expect(rows.find((r) => r.name === 'Болт М24-6gх100.58.12Х18Н10Т ГОСТ 7798-70 (DIN 931, DIN 933)')!.qtyCalc).toBe(24)
    expect(rows.find((r) => r.name.startsWith('Шайба 2.М24'))!.qtyCalc).toBe(48)
    expect(rows.find((r) => r.name.startsWith('Гайка М24'))!.qtyCalc).toBe(24)
    expect(rows.find((r) => r.name === 'Ламинирование патрубка к корпусу')!.qtyCalc).toBeCloseTo(0.66, 9)
    expect(rows.find((r) => r.name === 'Прорезка отверстия патрубка в корпусе')!.qtyCalc).toBeCloseTo(((400 * Math.PI) / 1000) * 0.5 * 2, 9)
    expect(rows.some((r) => r.name.startsWith('Труба СК') || r.name === 'Ручная формовка патрубка')).toBe(false)
    // ФОТ — у формовки гильз, фланца и ламинирования.
    expect(rows.filter((r) => r.name === 'ФОТ')).toHaveLength(3)
    // Отводящий из ПЭ — гильза под проход трубы, как в листе.
    expect(outlet!.title).toBe('Патрубок отводящий DN150 ×1')
    expect(outlet!.rows.some((r) => r.name === 'Ручная формовка стеклокомпозитного фланца')).toBe(false)
  })

  it('ёмкость DN400: гильза крупнее DN 300 — отрезок трубы, фланец тот же', () => {
    const [, outlet] = nozzles(materializeEmk(ctx, { ...EMK, outletDn: 400, outletMaterial: 'стеклокомпозит' }))
    const rows = outlet!.rows
    // DN400 → гильза Ø500: отрезок трубы 0,5 м с товарным видом.
    expect(rows.find((r) => r.name === 'Труба СК/НПС-К 500-0,1-2500')!.qtyCalc).toBeCloseTo(0.5, 9)
    expect(rows.find((r) => r.name === 'Придание изделию товарного вида')!.qtyCalc).toBeCloseTo((500 / 1300) * 0.5, 9)
    expect(rows.some((r) => r.name === 'Формовка гильз')).toBe(false)
    expect(rows.find((r) => r.name === 'Ручная формовка стеклокомпозитного фланца')!.qtyCalc).toBeCloseTo(4.6, 9)
  })

  it('нормы фланца для DN нет — строка ждёт массу вручную', () => {
    const [inlet] = nozzles(materializeEmk(ctx, { ...EMK, inletMaterial: 'стеклокомпозит' }))
    // DN150: гильза Ø250 по норме есть, фланца DN150 в нормах теста нет.
    expect(inlet!.rows.find((r) => r.name === 'Формовка гильз')!.qtyCalc).toBeCloseTo(0.6, 9)
    const flange = inlet!.rows.find((r) => r.name === 'Ручная формовка стеклокомпозитного фланца')!
    expect(flange.qtyCalc).toBeNull()
    expect(flange.note).toContain('введите массу вручную')
    // И болтов по норме нет — количество не выдумывается.
    const bolt = inlet!.rows.find((r) => r.name === 'Болт фланцевого соединения')!
    expect(bolt.qtyCalc).toBeNull()
    expect(bolt.note).toContain('не найдена')
  })

  // У колодца стеклопластиковый патрубок — муфта: она ставится вместо гильзы
  // и ламинируется к корпусу (уточнение завода 11.09.2026).
  it('колодец: «Муфта-2» по DN трубы вместо гильзы, ламинируется к корпусу', () => {
    const [inlet, outlet] = nozzles(
      materializeKol(ctx, {
        ...KOL,
        inletDn: 250,
        inletMaterial: 'стеклокомпозит',
        outletDn: 400,
        outletCount: 2,
        outletMaterial: 'стеклокомпозит',
      }),
    )
    expect(inlet!.title).toBe('Патрубок подводящий стеклопластиковый DN250 ×1')
    // Гильзы нет — ни формованной, ни из трубы: муфта, её ламинирование и прорезка.
    expect(inlet!.rows.map((r) => r.name)).toEqual([
      'Муфта-2 СК/НПС-К 250-1',
      'Ламинирование проходной муфты к корпусу',
      'ФОТ',
      'Прорезка отверстия патрубка в корпусе',
    ])
    // «Муфта-2» — та же «Муфта-1», только без центрального ограничителя.
    const coupling = inlet!.rows[0]!
    expect(coupling.qtyCalc).toBe(1)
    expect(coupling.unit).toBe('шт')
    // Муфты в прайсе нет — цена договорная, строка «красная», как у «Муфты-1».
    expect(coupling.priceCatalog).toBeNull()
    // Норма ламинирования и прорезка — по Ø гильзы, как в листе: Мф(Ø400) 1,1 × 3/10.
    const lam = inlet!.rows[1]!
    expect(lam.qtyCalc).toBeCloseTo(0.33, 9)
    expect(lam.fotK).toBe(1)
    // DN400 ×2: муфт две, трубы гильзы и товарного вида нет.
    expect(outlet!.rows.find((r) => r.name === 'Муфта-2 СК/НПС-К 400-1')!.qtyCalc).toBe(2)
    expect(outlet!.rows.some((r) => r.name.startsWith('Труба СК') || r.name === 'Придание изделию товарного вида')).toBe(false)
    expect(outlet!.rows.find((r) => r.name === 'Ламинирование проходной муфты к корпусу')!.qtyCalc).toBeCloseTo(1.9 * 0.3 * 2, 9)
  })

  it('прочие материалы — гильза под проход трубы, как в листе', () => {
    for (const material of ['ПЭ', 'ПВХ', 'Корсис'] as const) {
      const [inlet] = nozzles(materializeKol(ctx, { ...KOL, inletMaterial: material }))
      expect(inlet!.title).toBe('Патрубок подводящий DN150 ×1')
      expect(inlet!.rows.find((r) => r.name === 'Ручная формовка патрубка')!.qtyCalc).toBe(0.5)
    }
  })
})

describe('общие узлы переиспользуются всеми тремя изделиями', () => {
  it('лестница и перекрытие есть и у ЕМК, и у КОЛ', () => {
    for (const rows of [flattenRows(materializeEmk(ctx, EMK)), flattenRows(materializeKol(ctx, KOL))]) {
      expect(rows.some((r) => r.name === 'Изготовление Лестницы')).toBe(true)
      expect(rows.some((r) => r.name === 'Механическая формовка верхнего перекрытия')).toBe(true)
    }
  })

  it('ФОТ-спутник есть у каждой операции с ЕИ «кг»', () => {
    for (const tree of [materializeEmk(ctx, EMK), materializeKol(ctx, KOL)]) {
      const rows = flattenRows(tree)
      for (const op of rows.filter((r) => r.kind === 'ОПЕРАЦИЯ' && r.unit === 'кг')) {
        expect(rows.some((r) => r.kind === 'ФОТ' && r.parentId === op.id), `нет спутника у «${op.name}»`).toBe(true)
      }
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Общие узлы КНС, переиспользуемые ёмкостью и колодцем
// ─────────────────────────────────────────────────────────────────────────────

describe('комплекты напорной нитки и крепежа у ЕМК', () => {
  const rows = flattenRows(materializeEmk(ctx, { ...EMK, hasPumps: true, outletDn: 80, outletCount: 1 }))

  it('нитка приходит комплектом того диаметра, что задан в ОЛ', () => {
    const kit = PRESSURE_PIPE_KITS[80]!
    expect(rows.find((r) => r.name === kit.peSleeve.name)!.qtyCalc).toBe(1)
    expect(rows.find((r) => r.name === kit.tee.name)!.qtyCalc).toBeNull()
  })

  // У ёмкости и колодца в опросном листе нет признака аварийного
  // трубопровода, поэтому вечно выключенного блока быть не должно.
  it('блока аварийного трубопровода у ЕМК нет вовсе', () => {
    expect(rows.some((r) => r.name === 'Гайка пожарная ГМ150')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Сверка с листами эталона: подготовка трубы, петли, лестница, насосы
// ─────────────────────────────────────────────────────────────────────────────

describe('ЕМК и КОЛ: строки, которые листы эталона считали всегда', () => {
  const PREP = 'Предварительные работы для подготовки трубы (транспортировка, разметка осей, шлифовка)'

  it('ЕМК: подготовка трубы — у корпуса и у шахты, DN/1200 × L каждой', () => {
    const tree = materializeEmk(ctx, EMK)
    const geo = computeEmkGeometry(EMK)
    const preps = flattenRows(tree).filter((r) => r.name === PREP)
    expect(preps).toHaveLength(2)
    expect(preps[0]!.qtyCalc).toBeCloseTo((2000 / 1200) * (geo.pipeLengthMm! / 1000), 9)
    expect(preps[1]!.qtyCalc).toBeCloseTo((geo.shaftDiameterMm / 1200) * (geo.shaftHeightMm / 1000), 9)
  })

  it('КОЛ: подготовка трубы — у корпуса и у горловины', () => {
    const preps = flattenRows(materializeKol(ctx, KOL)).filter((r) => r.name === PREP)
    expect(preps.map((r) => r.qtyCalc)).toEqual([(1500 / 1200) * 2.5, (1000 / 1200) * 1.0])
  })

  it('петли монтажные: ЕМК DN 2000 — усиленные, КОЛ DN 1500 — простые', () => {
    const loopsOf = (t: ReturnType<typeof materializeEmk>) =>
      t.sections.find((s) => s.code === '1')!.components.find((c) => c.nodeCode === 'A10')!
    expect(loopsOf(materializeEmk(ctx, EMK)).title).toContain('усиленные')
    expect(loopsOf(materializeKol(ctx, KOL)).title).toContain('НТТ 648')
  })

  it('лестница: тетивы 2 × H, ступени у ёмкости из трубы 25×2,5, у колодца 25×2', () => {
    const emkRows = materializeEmk(ctx, EMK).sections.find((s) => s.code === '3')!.components.flatMap((c) => c.rows)
    const kolRows = materializeKol(ctx, KOL).sections.find((s) => s.code === '3')!.components.flatMap((c) => c.rows)
    expect(emkRows.some((r) => r.name === 'Труба 25х2,5мм 12Х18Н10Т (AISI 304) ГОСТ 9941-81')).toBe(true)
    expect(kolRows.find((r) => r.name === 'Труба 25х2 мм 12Х18Н10Т (AISI 304) ГОСТ 9941-81')!.qtyCalc).toBeCloseTo(
      (3.5 * 0.44) / 0.35,
      9,
    )
    expect(kolRows.find((r) => r.name.startsWith('Уголок 40х40'))!.qtyCalc).toBe(7)
  })

  it('крепление и подъём насосов у ёмкости — только при насосах', () => {
    const titles = (t: ReturnType<typeof materializeEmk>) =>
      t.sections.find((s) => s.code === '4')!.components.map((c) => c.title)
    expect(titles(materializeEmk(ctx, EMK))).not.toContain('Крепление насосного оборудования')
    const withPumps = materializeEmk(ctx, { ...EMK, hasPumps: true, pumpsWorking: 2, pumpsReserve: 1 })
    expect(titles(withPumps)).toEqual(expect.arrayContaining(['Крепление насосного оборудования', 'Грузоподъём насосов']))
    // В напорном трубопроводе направляющих больше нет — они в разделе 4.
    const pipeRows = withPumps.sections.find((s) => s.code === '6')!.components.flatMap((c) => c.rows)
    expect(pipeRows.some((r) => r.name.includes('направляющих насосов'))).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Построчная сверка с образцами листов (doc/Шаблон_ЕМК_КОЛ_разбор.md)
// ─────────────────────────────────────────────────────────────────────────────

/** Строки дерева с ФОТ-спутниками и количеством, как в колонке J листа. */
function settled(tree: CalcTree) {
  const enabled = sectionEnabledFor(tree)
  const rows = recalcFotSatellites(flattenRows(tree), { tirage: 1 })
  const qtyOf = (r: (typeof rows)[number]) => computeRow(r, { sectionEnabled: enabled(r), tirage: 1 }).qty
  const named = (n: string) => rows.filter((r) => r.name === n)
  return {
    rows,
    /** Количества всех строк с таким наименованием — по порядку. */
    qty: (n: string) => named(n).map(qtyOf),
    /** ФОТ-спутники строк с таким наименованием. */
    fot: (n: string) => named(n).map((op) => qtyOf(rows.find((r) => r.kind === 'ФОТ' && r.parentId === op.id)!)),
  }
}

describe('сверка с образцом эталона «Калькулятор ЕМК»', () => {
  // ОЛ_ЕМКОСТИ из книги: горизонтальная подземная DN 3000 на 100 м³, SN
  // 10000, две шахты Ø1200 h2000, подводящий DN400 на глубине 2400,
  // два отводящих DN300, насосы 1 + 1, корзина, задвижка на подводящем,
  // шкаф управления, теплоизоляция 2000; днища — «новый способ».
  const REF: EmkSurveyParams = {
    dn: 3000,
    volumeM3: 100,
    placement: 'горизонтальное',
    installation: 'подземная',
    tankType: 'Накопительная',
    bottomType: 'цилиндрические',
    pnSurvey: 0.1,
    sn: 10000,
    hasShaft: true,
    shaftCount: 2,
    shaftDiameterMm: 1200,
    shaftHeightMm: 2000,
    hasLadder: true,
    ventilation: true,
    inletDn: 400,
    inletCount: 1,
    inletTrayDepthMm: 2400,
    outletDn: 300,
    outletCount: 2,
    hasPumps: true,
    pumpsWorking: 1,
    pumpsReserve: 1,
    pumpModel: 'VSL.100.30.2.5.0D',
    valveOnInlet: true,
    hasControlCabinet: true,
    hasLevelSensor: false,
    hasBasket: true,
    insulationEnabled: true,
    insulationDepthMm: 2000,
  }
  const tree = materializeEmk(ctx, REF)
  const { rows, qty, fot } = settled(tree)
  const section = (code: string) => tree.sections.find((s) => s.code === code)!

  it('корпус: труба 14,9 м, товарный вид 34,4, подготовка 37,3, муфта отрезков 1', () => {
    expect(qty('Труба СК/НПС-К 3000-0,1-10000')).toEqual([14.9])
    expect(qty('Муфта соединительная Муфта-1 3000-1')).toEqual([1])
    expect(qty('Ламинация днища (косые и центральный стыки)')[0]).toBeCloseTo(428.83, 2)
    expect(fot('Ламинация днища (косые и центральный стыки)')).toEqual([240.2])
    const body = section('1').components.find((c) => c.nodeCode === 'A1')!.rows
    const q = (n: string) => computeRow(body.find((r) => r.name === n)!).qty
    expect(q('Придание изделию товарного вида')).toBe(34.4)
    expect(q('Предварительные работы для подготовки трубы (транспортировка, разметка осей, шлифовка)')).toBe(37.3)
  })

  it('шахты: труба 4 м SN 5000, товарный вид 3,7, муфт 2, ламинирование 20,6, подготовка 4, прорезка 3,8', () => {
    const shaft = section('1').components.find((c) => c.nodeCode === 'A8')!
    expect(shaft.title).toBe('Шахта обслуживания Ø1200 h2000 ×2')
    const q = (n: string) => computeRow(shaft.rows.find((r) => r.name === n)!).qty
    expect(q('Труба СК/НПС-К 1200-0,1-5000')).toBe(4)
    expect(q('Придание изделию товарного вида')).toBe(3.7)
    expect(q('Муфта соединительная Муфта-1 1200-1')).toBe(2)
    expect(q('Ламинирование шахты обслуживания к корпусу')).toBeCloseTo(20.6, 9)
    expect(fot('Ламинирование шахты обслуживания к корпусу')).toEqual([11.6])
    expect(q('Предварительные работы для подготовки трубы (транспортировка, разметка осей, шлифовка)')).toBe(4)
    expect(q('Прорезка отверстия шахты обслуживания')).toBe(3.8)
    expect(rows.some((r) => r.name === 'Ручная формовка шахты обслуживания к корпусу')).toBe(false)
  })

  it('патрубки: гильзы 0,5 и 1 м трубы, ламинирование 0,57 и 0,66 кг с ФОТ 0,6 и 0,7', () => {
    expect(qty('Труба СК/НПС-К 500-0,1-2500')).toEqual([0.5])
    expect(qty('Труба СК/НПС-К 400-0,1-2500')).toEqual([1])
    expect(qty('Ламинирование патрубка к корпусу').map((v) => +v.toFixed(2))).toEqual([0.57, 0.66])
    expect(fot('Ламинирование патрубка к корпусу')).toEqual([0.6, 0.7])
    // Прорезки — формулой колодца: у ёмкости строки 81–82 сдвинуты.
    expect(qty('Прорезка отверстия патрубка в корпусе')).toEqual([0.8, 1.3])
  })

  it('теплоизоляция: шахты и верх, слой 4 мм', () => {
    const area = Math.PI * 1.2 * 2 * 2 + Math.PI * 1.5 ** 2
    expect(qty('Теплоизоляция - Изофом ППЭ ОР 15 1,5х40')[0]).toBeCloseTo(area, 9)
    expect(qty('Защитный слой ламинации 4 мм на теплоизоляцию')[0]).toBeCloseTo(area * 0.004 * 1850, 9)
  })

  it('лестница: нержавеющая на 5 м и две приставные с монтажом 4 чел.ч', () => {
    expect(qty('Уголок 40х40х3мм 08Х18Н10Т(AISI304) ГОСТ 8509-93')).toEqual([10])
    expect(qty('Изготовление Лестницы')).toEqual([6.3])
    expect(qty('Лестница приставная односекционная 14 ступеней 3,98 м (алюминиевая)')).toEqual([2])
    expect(qty('Монтаж Лестницы')).toEqual([3.2, 4])
  })

  it('раздел 4: без перекрытия и анкеров; люки шахт и ремни к основанию', () => {
    expect(rows.some((r) => r.name === 'Механическая формовка верхнего перекрытия')).toBe(false)
    expect(rows.some((r) => r.name === 'Анкерный болт распорный 20х200')).toBe(false)
    expect(qty('Ручка складная оцинкованная')).toEqual([4])
    expect(qty('Замок натяжной АРТ 8427 А2 115-125')).toEqual([2])
    expect(qty('Концевой выключатель KZ 81-08')).toEqual([2])
    expect(qty('Монтаж складных ручек на болтах М6')).toEqual([2])
    expect(qty('Монтаж замка натяжного, петли и концевого выключателя')).toEqual([2])
    expect(qty(STRAPPING_ITEMS.strap.name)).toEqual([14])
    expect(qty(STRAPPING_ITEMS.anchor.name)).toEqual([28])
    expect(qty(STRAPPING_ITEMS.eyeNut.name)).toEqual([56])
    expect(qty('Монтаж емкости к бетонному основанию ремнями стяжными')).toEqual([7])
  })

  it('вентстояк — на каждую шахту: дефлекторов 2, прорезка 0,4, монтаж 6', () => {
    expect(qty('Дефлектор ПВХ Ду110')).toEqual([2])
    expect(qty('Прорезка отверстия вентиляции в перекрытии')).toEqual([0.4])
    expect(qty('Монтаж вентиляционного стояка')).toEqual([6])
  })

  it('раздел 8: задвижка на подводящем, насосы 2, муфт 2, поплавков 4, шкаф, тренога и газоанализатор', () => {
    const valve = rows.find((r) => r.name.startsWith('Задвижка шиберная'))!
    // Шток — от оси трубы: лоток 2400 − DN/2.
    expect(valve.name).toContain('DN400 PN10 и удлиненным штоком L=2200 мм')
    expect(computeRow(valve).qty).toBe(1)
    expect(qty('Монтаж Задвижки шиберной ножевой')).toEqual([1])
    expect(qty('Насос VSL.100.30.2.5.0D')).toEqual([2])
    expect(qty('Автоматическая трубная муфта')).toEqual([2])
    expect(rows.find((r) => r.name.startsWith('ПОПЛАВКОВЫЙ ВЫКЛЮЧАТЕЛЬ'))!.qtyCalc).toBe(4)
    expect(qty('Монтаж Насосов')).toEqual([4])
    expect(qty('Монтаж Систем автоматической трубной муфты')).toEqual([6])
    expect(qty('Монтаж Поплавковых выключателей')).toEqual([4])
    expect(qty('Шкаф управления насосами (2 шт.)')).toEqual([1])
    expect(qty('Монтаж Шкафа управления')).toEqual([6])
    expect(qty('Переносной газоанализатор (CH4, H2S, CO, O2)')).toEqual([1])
    expect(qty('Тренога перегрузочная ТП-1000 г/п 1000 кг (без тали)')).toEqual([1])
  })
})

describe('сверка с образцом эталона «Калькулятор колодца»', () => {
  // ОЛ_КОЛОДЦА из книги: DN 2000, рабочая часть 4000, возвышение 300, SN
  // 5000, горловина Ø1200 h1800, подводящий DN300 на 2000, два отводящих
  // DN300, корзина, теплоизоляция 2000.
  const REF: KolSurveyParams = {
    dn: 2000,
    workingDepthMm: 4000,
    elevationMm: 300,
    pnSurvey: 0.1,
    sn: 5000,
    hasLadder: true,
    hasNeck: true,
    neckHeightMm: 1800,
    neckDiameterMm: 1200,
    inletDn: 300,
    inletCount: 1,
    inletTrayDepthMm: 2000,
    outletDn: 300,
    outletCount: 2,
    hasBasket: true,
    hasGrinder: false,
    underRoadway: false,
    insulationEnabled: true,
    insulationDepthMm: 2000,
  }
  const tree = materializeKol(ctx, REF)
  const { rows, qty, fot } = settled(tree)
  const neck = tree.sections.find((s) => s.code === '1')!.components.find((c) => c.nodeCode === 'A8')!

  it('корпус: труба 4 м — рабочая часть, товарный вид 6,2, подготовка 6,7', () => {
    expect(qty('Труба СК/НПС-К 2000-0,1-5000')).toEqual([4])
    expect(qty('Придание изделию товарного вида')[0]).toBe(6.2)
    expect(qty('Предварительные работы для подготовки трубы (транспортировка, разметка осей, шлифовка)')).toEqual([6.7, 2.1])
  })

  it('днище: формованное дно 123,36 кг и ламинирование к фальшполу 37,01 кг', () => {
    expect(qty('Механическое формованное дно')[0]).toBeCloseTo(123.3586, 4)
    expect(fot('Механическое формованное дно')).toEqual([34.6])
    expect(qty('Ламинирование дна к фальшполу')[0]).toBeCloseTo(37.0076, 4)
    expect(fot('Ламинирование дна к фальшполу')).toEqual([20.8])
  })

  it('горловина: труба 2,1 м SN 2500, товарный вид 2, муфта 1, ламинирование 10,3, прорезка 1,9', () => {
    const q = (n: string) => computeRow(neck.rows.find((r) => r.name === n)!).qty
    expect(q('Труба СК/НПС-К 1200-0,1-2500')).toBe(2.1)
    expect(q('Придание изделию товарного вида')).toBe(2)
    expect(q('Муфта соединительная Муфта-1 1200-1')).toBe(1)
    expect(q('Ламинирование горловины к корпусу емкости')).toBe(10.3)
    expect(fot('Ламинирование горловины к корпусу емкости')).toEqual([5.8])
    expect(q('Прорезка отверстия для горловины обслуживания')).toBe(1.9)
  })

  it('патрубки: гильзы Ø400 0,5 и 1 м, ламинирование 0,33 и 0,66, прорезки 0,7 и 1,3', () => {
    expect(qty('Труба СК/НПС-К 400-0,1-2500')).toEqual([0.5, 1])
    expect(qty('Ламинирование патрубка к корпусу').map((v) => +v.toFixed(2))).toEqual([0.33, 0.66])
    expect(fot('Ламинирование патрубка к корпусу')).toEqual([0.4, 0.7])
    expect(qty('Прорезка отверстия патрубка в корпусе')).toEqual([0.7, 1.3])
  })

  it('лестница 6,1 м: уголок 12,2, ступени 7,669, работы 7,7 и 3,9, приставная 1 с монтажом 2', () => {
    expect(qty('Уголок 40х40х3мм 08Х18Н10Т(AISI304) ГОСТ 8509-93')).toEqual([12.2])
    expect(qty('Труба 25х2 мм 12Х18Н10Т (AISI 304) ГОСТ 9941-81')[0]).toBeCloseTo(7.6686, 4)
    expect(qty('Изготовление Лестницы')).toEqual([7.7])
    expect(qty('Монтаж Лестницы')).toEqual([3.9, 2])
    expect(qty('Лестница приставная односекционная 14 ступеней 3,98 м (алюминиевая)')).toEqual([1])
  })

  it('перекрытие 10 мм за вычетом крышки люка; прорезки люка в нём нет — она у горловины', () => {
    const slab = Math.PI * (2300 / 2000) ** 2 * 0.01 * 1850 - neckCoverMassKg(1200)
    expect(qty('Механическая формовка верхнего перекрытия')[0]).toBeCloseTo(slab, 9)
    expect(rows.some((r) => r.name === 'Прорезка люков (горловин) в стеклокомпозитном перекрытии')).toBe(false)
    expect(qty('Ручка складная оцинкованная')).toEqual([1])
    expect(qty('Монтаж складных ручек на болтах М6')).toEqual([0.5])
  })

  it('вентстояк один: дефлектор, прорезка 0,2, монтаж 3', () => {
    expect(qty('Дефлектор ПВХ Ду110')).toEqual([1])
    expect(qty('Прорезка отверстия вентиляции в перекрытии')).toEqual([0.2])
    expect(qty('Монтаж вентиляционного стояка')).toEqual([3])
  })
})
