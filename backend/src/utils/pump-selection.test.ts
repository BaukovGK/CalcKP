import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PUMPS, HEAD_MARGIN_MIN_M, HEAD_MARGIN_MAX_M, selectPump, type PumpCatalogEntry } from './pump-selection'
import type { CurvePoint } from './pump-curve'

/**
 * Подбор насоса по паспортной характеристике.
 *
 * Данные: 56 моделей DN80…DN400 с кривыми Q–H из выгрузки VJ Select
 * (`prisma/seed-data/pump-curves.json`) и 5 моделей DN50/DN65 без кривых
 * (вторичные источники). Контрольные рабочие точки — из проектных томов
 * «Работа/Примеры/Проекты».
 *
 * Прежняя версия отбирала по прямоугольной рамке `Qmin…Qmax × 0…Hmax`. Рамка
 * врала в обе стороны, и тесты это фиксировали как «известное ограничение»;
 * теперь эти же случаи решаются правильно — см. блок «что чинит кривая».
 */

const SEED = path.join(__dirname, '..', '..', 'prisma', 'seed-data')
const load = <T>(f: string): T => JSON.parse(readFileSync(path.join(SEED, f), 'utf8')) as T

interface CurveSeed {
  name: string
  minQM3h: number
  maxQM3h: number
  qNomM3h: number
  hNomM: number
  points: CurvePoint[]
}

/** Каталог из сида вместе с кривыми — ровно то, что маршрут берёт из БД. */
const CURVES = new Map(load<CurveSeed[]>('pump-curves.json').map((c) => [c.name, c]))
const CATALOG: PumpCatalogEntry[] = load<PumpCatalogEntry[]>('pumps.json').map((p) => ({
  ...p,
  curve: CURVES.get(p.name)?.points,
}))

const pick = (name: string) => CATALOG.find((p) => p.name === name)!

describe('каталог и кривые', () => {
  it('61 модель, у 56 есть паспортная кривая', () => {
    expect(CATALOG.length).toBe(61)
    expect(CATALOG.filter((p) => p.curve).length).toBe(56)
  })

  it('без кривой остались ровно пять DN50/DN65 из вторичных источников', () => {
    const noCurve = CATALOG.filter((p) => !p.curve)
    expect(noCurve.map((p) => p.nozzleDiameterMm).sort((a, b) => a - b)).toEqual([50, 50, 50, 65, 65])
  })

  it('рабочее окно каталога совпадает с окном из выгрузки производителя', () => {
    // Раньше capacityMinM3h содержал НОМИНАЛЬНЫЙ расход, и отсев по расходу
    // выбрасывал модели, которые производитель для такой точки допускает.
    for (const [name, c] of CURVES) {
      const p = pick(name)
      expect([p.capacityMinM3h, p.capacityMaxM3h], name).toEqual([c.minQM3h, c.maxQM3h])
    }
  })

  it('DEFAULT_PUMPS — зеркало каталога сида', () => {
    expect(DEFAULT_PUMPS.length).toBe(CATALOG.length)
    expect(DEFAULT_PUMPS.map((p) => p.name)).toEqual(CATALOG.map((p) => p.name))
    for (const p of DEFAULT_PUMPS) {
      expect([p.capacityMinM3h, p.capacityMaxM3h], p.name).toEqual([
        pick(p.name).capacityMinM3h,
        pick(p.name).capacityMaxM3h,
      ])
    }
  })

  it('каждая кривая невозрастающая по напору и упорядочена по расходу', () => {
    for (const [name, c] of CURVES) {
      for (let i = 1; i < c.points.length; i++) {
        expect(c.points[i]!.q, `${name}: расход`).toBeGreaterThan(c.points[i - 1]!.q)
        expect(c.points[i]!.h, `${name}: напор`).toBeLessThanOrEqual(c.points[i - 1]!.h + 1e-6)
      }
    }
  })
})

describe('рабочая точка на кривой', () => {
  it('ОЛ3487: 90,468 м³/ч на 2 насоса = 45,234 м³/ч, напор 12,9 м', () => {
    const r = selectPump(90.468, 12.9, 2, CATALOG)

    expect(r.flowPerPumpM3h).toBeCloseTo(45.234, 3)
    expect(r.requiredHeadM).toBe(12.9)
    expect(r.duty!.q).toBeCloseTo(45.234, 3)
    // Кривая обязана давать не меньше требуемого — иначе насос не подобран.
    expect(r.duty!.h).toBeGreaterThanOrEqual(12.9)
    expect(r.headMarginM).toBeCloseTo(r.duty!.h - 12.9, 10)
  })

  it('деление притока на насосы: 90,468 на 2 = то же, что 45,234 на 1', () => {
    const two = selectPump(90.468, 12.9, 2, CATALOG)
    const one = selectPump(45.234, 12.9, 1, CATALOG)

    expect(two.name).toBe(one.name)
    expect(two.duty!.h).toBeCloseTo(one.duty!.h, 10)
  })

  it('напор при параллельной работе НЕ делится', () => {
    // Тот же расход на насос, вдвое больший приток и вдвое больше насосов —
    // напор остаётся требованием к каждому насосу целиком.
    const r = selectPump(180.936, 12.9, 4, CATALOG)
    expect(r.flowPerPumpM3h).toBeCloseTo(45.234, 3)
    expect(r.requiredHeadM).toBe(12.9)
  })

  it('отдаёт мощность и КПД в рабочей точке — по ним считается энергопотребление', () => {
    const r = selectPump(318.84, 13.29, 1, CATALOG)

    expect(r.duty!.p2).toBeGreaterThan(0)
    expect(r.duty!.p1).toBeGreaterThan(r.duty!.p2) // потребляемая больше, чем на валу
    expect(r.duty!.eff).toBeGreaterThan(0)
  })
})

describe('что чинит переход с прямоугольной рамки на кривую', () => {
  it('VSL.80.37 при 45,23 м³/ч даёт 12,69 м и на 12,9 м больше не проходит', () => {
    const r = selectPump(90.468, 12.9, 2, CATALOG)
    const all = [r.name, ...r.alternatives.map((a) => a.name)]

    // Рамка выбирала именно его: Hmax = 17 м достигается только при Q ≈ 0.
    expect(all).not.toContain('Vandjord VSL.80.37.4.5.0D')
  })

  it('VSL.100.55 из реального проекта ОЛ3487 кривой допускается', () => {
    const r = selectPump(90.468, 12.9, 2, CATALOG)
    const all = [r.name, ...r.alternatives.map((a) => a.name)]

    expect(all).toContain('Vandjord VSL.100.55.4.5.0D')
  })

  it('рабочая точка ниже номинала больше не даёт отказ', () => {
    // 41,65 м³/ч ниже официального Qnom всех DN80/DN65 — рамка отвечала
    // NO_CAPACITY_MATCH, хотя это реальная рабочая точка из проекта.
    const r = selectPump(41.65, 12.96, 1, CATALOG)

    expect(r.name).not.toBeNull()
    expect(r.warnings.map((w) => w.code)).not.toContain('NO_CAPACITY_MATCH')
  })

  it('ДУДС24и/ДУДС31и: кривая VSL.200.190 проходит ровно через точку проекта', () => {
    // 318,84 м³/ч; 13,29 м — рабочая точка из проектного тома. Кривая
    // воспроизводит её до сотых, то есть данные и интерполяция сходятся.
    const r = selectPump(318.84, 13.29, 1, CATALOG)
    const projectPump = [...r.candidates, ...r.belowMargin].find((c) => c.name === 'Vandjord VSL.200.190.4.5.1D')!

    expect(projectPump.duty!.h).toBeCloseTo(13.29, 2)
    // Но запас нулевой — по заводскому правилу такой насос не предлагается.
    expect(projectPump.headMarginM).toBeCloseTo(0, 2)
    expect(r.belowMargin).toContain(projectPump)
    expect(r.name).not.toBe('Vandjord VSL.200.190.4.5.1D')
  })
})

describe('порядок предпочтения', () => {
  const r = () => selectPump(90.468, 12.9, 2, CATALOG)

  it('первым идёт выбранный, candidates включает его целиком', () => {
    const res = r()

    expect(res.candidates[0]!.name).toBe(res.name)
    expect(res.alternatives).toEqual(res.candidates.slice(1))
  })

  it('попавшие в окно запаса идут впереди избыточных по напору', () => {
    const inBand = r().candidates.map((c) => c.withinPreferredBand)

    expect(inBand.indexOf(false)).toBe(inBand.lastIndexOf(true) + 1)
  })

  it('внутри группы — по возрастанию мощности на валу', () => {
    const over = r().candidates.filter((c) => !c.withinPreferredBand && c.duty)
    const powers = over.map((c) => c.duty!.p2)

    expect(powers).toEqual([...powers].sort((a, b) => a - b))
  })

  it('все предложенные закрывают требуемый напор с минимальным запасом', () => {
    for (const c of r().candidates) {
      if (c.duty) expect(c.duty.h, c.name).toBeGreaterThanOrEqual(12.9 + HEAD_MARGIN_MIN_M)
    }
  })

  it('модели без кривой уходят в конец: их рабочая точка неизвестна', () => {
    const byCurve = selectPump(29.48, 13.66, 1, CATALOG).candidates.map((c) => c.byCurve)

    expect(byCurve.indexOf(false)).toBe(byCurve.lastIndexOf(true) + 1)
  })
})

describe('окно запаса по напору 0,5…2,0 м', () => {
  // Запас страхует не рост притока (он уже в требуемом напоре), а то, что
  // реальный насос может не выдать паспортные значения.
  it('по умолчанию действует заводское окно', () => {
    const r = selectPump(90.468, 12.9, 2, CATALOG)

    expect(r.headMarginBandM).toEqual({ min: HEAD_MARGIN_MIN_M, max: HEAD_MARGIN_MAX_M })
    expect(r.headMarginM!).toBeGreaterThanOrEqual(HEAD_MARGIN_MIN_M)
  })

  it('нижняя граница — жёсткая: точка впритык в подбор не идёт', () => {
    const r = selectPump(90.468, 12.9, 2, CATALOG)
    const tight = r.belowMargin.map((c) => c.name)

    // VSL.100.37 даёт 13,24 м при требуемых 12,9 — всего 0,34 м запаса.
    expect(tight).toContain('Vandjord VSL.100.37.4.5.0D')
    expect(r.candidates.map((c) => c.name)).not.toContain('Vandjord VSL.100.37.4.5.0D')
  })

  it('отсечённые по запасу возвращаются отдельным списком, а не молча пропадают', () => {
    const r = selectPump(90.468, 12.9, 2, CATALOG)

    expect(r.belowMargin.length).toBeGreaterThan(0)
    for (const c of r.belowMargin) {
      expect(c.duty!.h, c.name).toBeGreaterThanOrEqual(12.9)
      expect(c.headMarginM!, c.name).toBeLessThan(HEAD_MARGIN_MIN_M)
    }
    expect(r.warnings.map((w) => w.code)).toContain('REJECTED_BY_MARGIN')
  })

  it('отсечённые упорядочены по убыванию запаса — ближайший к окну первым', () => {
    const margins = selectPump(90.468, 12.9, 2, CATALOG).belowMargin.map((c) => c.headMarginM!)

    expect(margins).toEqual([...margins].sort((a, b) => b - a))
  })

  it('верхняя граница — предпочтение, а не отсечка: избыточные остаются в выборе', () => {
    const r = selectPump(90.468, 12.9, 2, CATALOG)
    const over = r.candidates.filter((c) => !c.withinPreferredBand)

    expect(over.length).toBeGreaterThan(0)
    // Проектный насос ОЛ3487 избыточен по запасу (3,99 м), но доступен.
    expect(over.map((c) => c.name)).toContain('Vandjord VSL.100.55.4.5.0D')
  })

  it('когда в окно не попал никто — берётся ближайший избыточный с предупреждением', () => {
    // Узкий каталог: единственный кандидат имеет запас заведомо больше окна.
    const one = [pick('Vandjord VSL.100.55.4.5.0D')]
    const r = selectPump(45.234, 12.9, 1, one)

    expect(r.name).toBe('Vandjord VSL.100.55.4.5.0D')
    expect(r.candidates[0]!.withinPreferredBand).toBe(false)
    expect(r.warnings.map((w) => w.code)).toContain('MARGIN_ABOVE_BAND')
  })

  it('окно настраивается: без минимума проходит и точка впритык', () => {
    const r = selectPump(318.84, 13.29, 1, CATALOG, { minHeadMarginM: 0 })

    expect(r.name).toBe('Vandjord VSL.200.190.4.5.1D')
    expect(r.belowMargin).toEqual([])
  })

  it('если напор дают, но запаса не набирает никто — это отдельный случай', () => {
    const one = [pick('Vandjord VSL.200.190.4.5.1D')]
    const r = selectPump(318.84, 13.29, 1, one)

    expect(r.name).toBeNull()
    expect(r.belowMargin.map((c) => c.name)).toEqual(['Vandjord VSL.200.190.4.5.1D'])
    expect(r.warnings.map((w) => w.code)).toContain('ONLY_BELOW_MARGIN')
  })
})

describe('модели без паспортной кривой', () => {
  it('подбираются по рамке и помечаются APPROXIMATE_MATCH', () => {
    // Каталог из одной DN50-модели без кривой.
    const onlyNoCurve = CATALOG.filter((p) => !p.curve && p.name === 'Vandjord VSL.50.22.2.5.0D')
    const r = selectPump(29.48, 13.66, 1, onlyNoCurve)

    expect(r.name).toBe('Vandjord VSL.50.22.2.5.0D')
    expect(r.duty).toBeNull()
    expect(r.headMarginM).toBeNull()
    expect(r.warnings.map((w) => w.code)).toContain('APPROXIMATE_MATCH')
  })

  it('когда рядом есть проверенные по кривой — предупреждает, что не все проверены', () => {
    const r = selectPump(29.48, 13.66, 1, CATALOG)

    expect(r.duty).not.toBeNull()
    expect(r.warnings.map((w) => w.code)).toContain('SOME_WITHOUT_CURVE')
  })
})

describe('отказы', () => {
  it('расход вне рабочих окон всего каталога → NO_CAPACITY_MATCH', () => {
    const r = selectPump(5000, 10, 1, CATALOG)

    expect(r.name).toBeNull()
    expect(r.duty).toBeNull()
    expect(r.alternatives).toEqual([])
    expect(r.warnings.map((w) => w.code)).toEqual(['NO_CAPACITY_MATCH'])
  })

  it('расход подходит, а напора не даёт никто → NO_HEAD_MATCH с лучшими попытками', () => {
    const r = selectPump(45.234, 100, 1, CATALOG)

    expect(r.name).toBeNull()
    const w = r.warnings.find((x) => x.code === 'NO_HEAD_MATCH')!
    expect(w).toBeDefined()
    // Сообщение обязано называть, что именно насосы дают, — иначе непонятно,
    // насколько промах и что менять.
    expect(w.message).toMatch(/м/)
  })

  it('пустой каталог → отказ, а не исключение', () => {
    expect(selectPump(45, 12, 1, []).name).toBeNull()
  })
})

describe('валидация входа', () => {
  it('flowM3h = 0 → бросает ошибку', () => {
    expect(() => selectPump(0, 12, 1, CATALOG)).toThrow(/flowM3h/)
  })

  it('headM = 0 → бросает ошибку', () => {
    expect(() => selectPump(45, 0, 1, CATALOG)).toThrow(/headM/)
  })

  it('workingPumps = 0 или дробное → бросает ошибку', () => {
    expect(() => selectPump(45, 12, 0, CATALOG)).toThrow(/workingPumps/)
    expect(() => selectPump(45, 12, 1.5, CATALOG)).toThrow(/workingPumps/)
  })

  it('workingPumps по умолчанию = 1', () => {
    expect(selectPump(45.234, 12.9, undefined, CATALOG).flowPerPumpM3h).toBeCloseTo(45.234, 3)
  })
})
