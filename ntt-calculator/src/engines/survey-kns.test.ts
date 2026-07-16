import { describe, expect, it } from 'vitest'
import {
  ballValveCount,
  computeDepth,
  floatSwitchCount,
  fromLps,
  gateValveCount,
  pipeGradeName,
  pnForWeightLookup,
  PN_SURVEY_DEFAULT,
  sleeveDiameter,
  snByDepth,
  toLps,
  type DepthInput,
} from './survey-kns'

// ─────────────────────────────────────────────────────────────────────────────
// Критерий приёмки этапа 3: материализация ОЛ3487 даёт Нподз = 11 600.
// Данные — из прототипа «Опросный лист v2» (предзаполнен реальным кейсом).
// ─────────────────────────────────────────────────────────────────────────────

const OL3487: DepthInput = {
  flow: 25.13,
  flowUnit: 'l/s',
  dn: 3000,
  pumpsWorking: 2,
  inletInvertMm: 9910,
}

describe('подбор глубины — контрольный кейс ОЛ3487', () => {
  const r = computeDepth(OL3487)

  it('Нподз = 11 600 мм', () => {
    expect(r.npodzMm).toBe(11600)
  })

  it('вся цепочка сходится с live-панелью прототипа', () => {
    expect(r.qLps).toBeCloseTo(25.13, 2)
    expect(r.vEf).toBeCloseTo(1.13, 2)
    expect(r.vMin).toBeCloseTo(3.77, 2)
    expect(r.hRab).toBeCloseTo(0.533, 3)
    expect(r.hR).toBeCloseTo(1.62, 3)
  })

  it('округляется ВВЕРХ до 100 мм', () => {
    // (9910/1000 + 1.620) · 1000 = 11 530 → 11 600
    expect(r.npodzMm).toBe(11600)
    expect(r.npodzMm! % 100).toBe(0)
  })

  it('без лотка подводящего глубина не считается', () => {
    expect(computeDepth({ ...OL3487, inletInvertMm: null }).npodzMm).toBeNull()
  })

  it('деление на ноль насосов не роняет расчёт', () => {
    expect(computeDepth({ ...OL3487, pumpsWorking: 0 }).npodzMm).toBeGreaterThan(0)
  })
})

describe('конвертация притока', () => {
  it('л/с остаётся как есть', () => {
    expect(toLps(25.13, 'l/s')).toBe(25.13)
  })

  it('м³/ч → л/с', () => {
    expect(toLps(90.468, 'm3/h')).toBeCloseTo(25.13, 3)
  })

  it('м³/сут → л/с', () => {
    expect(toLps(2171.232, 'm3/day')).toBeCloseTo(25.13, 3)
  })

  it('обратная конвертация симметрична', () => {
    for (const u of ['l/s', 'm3/h', 'm3/day'] as const) {
      expect(toLps(fromLps(25.13, u), u)).toBeCloseTo(25.13, 6)
    }
  })

  it('ЕИ не меняет итоговую глубину', () => {
    const a = computeDepth(OL3487)
    const b = computeDepth({ ...OL3487, flow: fromLps(25.13, 'm3/h'), flowUnit: 'm3/h' })
    expect(b.npodzMm).toBe(a.npodzMm)
  })
})

describe('snByDepth', () => {
  it.each([
    [11600, 10000],
    [8001, 10000],
    [8000, 5000],
    [5001, 5000],
    [5000, 2500],
    [3001, 2500],
    [3000, 1250],
    [1000, 1250],
  ])('глубина %i мм → SN %i', (depth, expected) => {
    expect(snByDepth(depth)).toBe(expected)
  })

  it('«под проезжей частью» поднимает SN на ступень', () => {
    expect(snByDepth(3000, { underRoadway: true })).toBe(2500) // 1250 → 2500
    expect(snByDepth(4000, { underRoadway: true })).toBe(5000) // 2500 → 5000
  })

  it('«по ТТ МВК» поднимает SN на ступень', () => {
    expect(snByDepth(4000, { mvk: true })).toBe(5000)
  })

  it('потолок SN — 10000', () => {
    expect(snByDepth(11600, { underRoadway: true, mvk: true })).toBe(10000)
    expect(snByDepth(9000, { mvk: true })).toBe(10000)
  })

  it('ОЛ3487: глубина 11 600 + ТТ МВК → SN 10000', () => {
    expect(snByDepth(11600, { mvk: true })).toBe(10000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Две разные PN (ТЗ §9.4) — без этого поиск веса промахивается.
// ─────────────────────────────────────────────────────────────────────────────

describe('pnForWeightLookup — PN трубы (эталон F7)', () => {
  it('ОЛ3487: PN_ОЛ 0,1 → PN_трубы 0,6 (ключ 3000;0,6;10000 существует)', () => {
    expect(pnForWeightLookup(PN_SURVEY_DEFAULT, 3000, 10000)).toBe(0.6)
  })

  it('PN_ОЛ ≤ 0,6 → 0,6', () => {
    expect(pnForWeightLookup(0.1, 2000, 5000)).toBe(0.6)
    expect(pnForWeightLookup(0.6, 2000, 5000)).toBe(0.6)
  })

  it('PN_ОЛ > 0,6 вне спецсписка → 1', () => {
    expect(pnForWeightLookup(1, 2000, 5000)).toBe(1)
  })

  it('спецсписок (DN;SN) при PN_ОЛ > 0,6 → 1,6', () => {
    expect(pnForWeightLookup(1, 1200, 2500)).toBe(1.6)
    expect(pnForWeightLookup(1, 1200, 10000)).toBe(1.6)
    expect(pnForWeightLookup(1, 1300, 2500)).toBe(1.6)
  })

  it('спецсписок при PN_ОЛ ≤ 0,6 не срабатывает', () => {
    expect(pnForWeightLookup(0.1, 1200, 2500)).toBe(0.6)
  })

  // Воспроизведённый дефект первоисточника (План §4.1-bis B).
  // Ветка достижима у КНС: PN_ОЛ всегда 0,1, SN 5000 наступает глубже 5 м.
  it('DN1300 + SN 5000/10000 + PN_ОЛ ≤ 0,4 → 0,4 (ключа в таблице НЕТ)', () => {
    expect(pnForWeightLookup(0.1, 1300, 5000)).toBe(0.4)
    expect(pnForWeightLookup(0.1, 1300, 10000)).toBe(0.4)
  })

  it('DN1300 с SN 2500 в эту ветку не попадает', () => {
    expect(pnForWeightLookup(0.1, 1300, 2500)).toBe(0.6)
  })
})

describe('pipeGradeName — PN_ОЛ идёт в наименование, а не PN_трубы', () => {
  it('ОЛ3487: «Труба СК/НПС-К 3000-0,1-10000»', () => {
    expect(pipeGradeName(3000, PN_SURVEY_DEFAULT, 10000)).toBe('Труба СК/НПС-К 3000-0,1-10000')
  })

  it('в наименовании 0,1, хотя вес ищется по 0,6', () => {
    const name = pipeGradeName(3000, 0.1, 10000)
    expect(name).toContain('0,1')
    expect(pnForWeightLookup(0.1, 3000, 10000)).toBe(0.6)
  })
})

describe('sleeveDiameter — гильза патрубка (эталон K8/M8)', () => {
  it('DN400 → 500 (шаг 100)', () => {
    expect(sleeveDiameter(400)).toBe(500)
  })

  it('DN250 → 400: 250+100 = 350 → вверх до 400', () => {
    expect(sleeveDiameter(250)).toBe(400)
  })

  it('DN150 → 250 (шаг 50 при DN < 200)', () => {
    expect(sleeveDiameter(150)).toBe(250)
  })

  // Тонкость первоисточника: при DN < 100 надбавка +100 не применяется.
  it('DN < 100: без надбавки +100', () => {
    expect(sleeveDiameter(50)).toBe(50)
    expect(sleeveDiameter(80)).toBe(100)
  })
})

describe('арматура — авторасчёт с override (§5.6 ТЗ)', () => {
  it('задвижки = кол-во подводящих × флаг «арматура на подводящем»', () => {
    expect(gateValveCount(1, true)).toBe(1)
    expect(gateValveCount(2, true)).toBe(2)
    expect(gateValveCount(2, false)).toBe(0)
  })

  it('ОЛ3487: 2 раб + 1 рез + 1 коллектор → 4 шаровых крана', () => {
    expect(ballValveCount(2, 1, false)).toBe(4)
  })

  it('аварийный трубопровод добавляет 1 кран', () => {
    expect(ballValveCount(2, 1, true)).toBe(5)
  })

  it('поплавки = раб + рез + 2', () => {
    expect(floatSwitchCount(2, 1)).toBe(5)
  })
})
