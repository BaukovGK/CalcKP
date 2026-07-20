import { beforeEach, describe, expect, it } from 'vitest'
import { computeRow } from './row'
import type { NozzleNorm } from './formulas'
import { __resetIds, flattenRows, type MaterializeContext } from './template-kns'
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
}

const NORMS: NozzleNorm[] = [
  { dn: 250, odMm: null, minLengthMm: null, moldingMassKg: 0.6, h1Mm: null, s1Mm: null, flangeMassKg: 2.3, bolt: 'М24х100', boltCount: 12 },
  { dn: 400, odMm: null, minLengthMm: null, moldingMassKg: 1.1, h1Mm: null, s1Mm: null, flangeMassKg: 4.6, bolt: 'М24х100', boltCount: 16 },
]

const ctx: MaterializeContext = {
  priceOf: (c, n, u) => PRICES[`${c}|${n}|${u}`] ?? null,
  pipeWeightOf: (dn, pn, sn) => WEIGHTS[`${dn}|${pn}|${sn}`] ?? null,
  nozzleNormOf: (dn) => NORMS.find((n) => n.dn === dn) ?? null,
  priceListVersion: 1,
}

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

  // Масса эллиптических днищ берётся из матрицы f(Dн, L), которая сюда не
  // выведена: молча подставить число хуже пустой строки.
  it('масса эллиптических днищ НЕ выдумывается', () => {
    const rows = flattenRows(materializeEmk(ctx, { ...EMK, placement: 'горизонтальное' }))
    const row = rows.find((r) => r.name === 'Механическая формовка эллиптических днищ')!
    expect(row.qtyCalc).toBeNull()
    expect(row.note).toContain('матрицы «Для расчетов»')
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

  it('длина трубы учитывает горловину', () => {
    const pipe = flattenRows(materializeKol(ctx, KOL)).find((r) => r.name.startsWith('Труба СК'))!
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
