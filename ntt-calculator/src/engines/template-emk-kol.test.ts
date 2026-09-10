import { beforeEach, describe, expect, it } from 'vitest'
import { computeRow } from './row'
import type { NozzleNorm } from './formulas'
import { __resetIds, flattenRows, type MaterializeContext } from './template-kns'
import { PRESSURE_PIPE_KITS } from './pressure-pipe-kit'
import {
  EMK_SECTIONS,
  KOL_SECTIONS,
  materializeEmk,
  materializeKol,
  type EmkSurveyParams,
  type KolSurveyParams,
} from './template-emk-kol'
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

const NORMS: NozzleNorm[] = [
  { dn: 250, odMm: null, minLengthMm: null, moldingMassKg: 0.6, h1Mm: null, s1Mm: null, flangeMassKg: 2.3, bolt: 'М24х100', boltCount: 12 },
  { dn: 400, odMm: null, minLengthMm: null, moldingMassKg: 1.1, h1Mm: null, s1Mm: null, flangeMassKg: 4.6, bolt: 'М24х100', boltCount: 16 },
]

/** Мс при PN 4 — значение, которое эталон берёт для стыков (лист «Для расчетов»). */
const JOINT_LAYER_MASS: Record<number, number> = { 3000: 112, 2000: 35 }

/**
 * Ячейки матрицы «Формовка эллиптических днищ» (лист «Для расчетов»,
 * prisma/seed-data/engineering.json): одно днище, кг, и его толщина, мм.
 */
const ELLIPTIC: Record<string, { massKg: number; thicknessMm: number }> = {
  '2000|5000': { massKg: 133, thicknessMm: 16 },
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

  it('горизонтальная получает +1,5 м под эллиптические днища', () => {
    const h = computeEmkGeometry({ volumeM3: 50, dn: 2000, placement: 'горизонтальное', installation: 'подземная', hasShaft: false })
    const v = computeEmkGeometry({ volumeM3: 50, dn: 2000, placement: 'вертикальное', installation: 'подземная', hasShaft: false })
    expect(h.overallLengthMm! - v.overallLengthMm!).toBe(1500)
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
    expect(without.shaftDiameterMm).toBe(0)
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

  it('эллиптические: строка матрицы следует за длиной — V 20 м³ → 6 400 мм → «До 6,5 м»', () => {
    const rows = flattenRows(materializeEmk(ctx, { ...EMK, volumeM3: 20, placement: 'горизонтальное' }))
    const row = rows.find((r) => r.name === 'Механическая формовка эллиптических днищ')!
    expect(row.qtyCalc).toBe(2 * 149)
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
    expect(rows.find((r) => r.name.startsWith('Труба СК/НПС-К 2000'))!.qtyCalc).toBe(16)
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
    expect(pipe.qtyCalc).toBe(17.5)
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

  it('без горловины глубина равна рабочей части', () => {
    const g = computeKolGeometry({ ...KOL, hasNeck: false })
    expect(g.totalDepthMm).toBe(2500)
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
    expect(withNeck.some((r) => r.name === 'Механическая формовка горловины к корпусу')).toBe(true)
    expect(without.some((r) => r.name === 'Механическая формовка горловины к корпусу')).toBe(false)
  })

  it('горловина — отрезок трубы своего DN, длиной в свою высоту', () => {
    const rows = flattenRows(materializeKol(ctx, KOL))
    const neckPipe = rows.find((r) => r.name.startsWith('Труба СК/НПС-К 1000-'))
    expect(neckPipe).toBeDefined()
    expect(neckPipe!.unit).toBe('м')
    expect(neckPipe!.qtyCalc).toBeCloseTo(0.8, 6) // h 800 мм
    expect(neckPipe!.priceCatalog).toBeNull()
  })

  it('длина трубы учитывает горловину', () => {
    // DN в поиске обязателен: труба корпуса и труба горловины различаются
    // только им, и без него нашлась бы первая попавшаяся.
    const pipe = flattenRows(materializeKol(ctx, KOL)).find((r) => r.name.startsWith('Труба СК/НПС-К 1500-'))!
    expect(pipe.qtyCalc).toBeCloseTo(3.5, 6) // 3500 мм
    expect(pipe.note).toContain('с горловиной')
  })

  // У колодца защитный слой 4 мм, у КНС/ЕМК — 5 мм (Реверс §4.3).
  // Это РАЗНЫЕ позиции прайса, и ошибка дала бы «красную» строку.
  it('защитный слой теплоизоляции — 4 мм, а не 5', () => {
    const rows = flattenRows(materializeKol(ctx, { ...KOL, insulationEnabled: true, insulationDepthMm: 1500 }))
    expect(rows.some((r) => r.name === 'Защитный слой ламинации 4 мм на теплоизоляцию')).toBe(true)
    expect(rows.some((r) => r.name === 'Защитный слой ламинации 5 мм на теплоизоляцию')).toBe(false)
  })

  it('у ЕМК тот же слой — 5 мм', () => {
    const rows = flattenRows(materializeEmk(ctx, EMK))
    expect(rows.some((r) => r.name === 'Защитный слой ламинации 5 мм на теплоизоляцию')).toBe(true)
  })

  it('гильзы патрубков считаются из норм: DN150 → Ø250 → 0,6 кг', () => {
    const sleeve = flattenRows(materializeKol(ctx, KOL)).find((r) => r.name === 'Формовка гильз')!
    expect(sleeve.qtyCalc).toBeCloseTo(0.6, 6)
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
