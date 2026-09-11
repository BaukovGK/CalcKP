import { describe, expect, it } from 'vitest'
import snVectors from '../../../backend/src/utils/sn-rule.vectors.json'
import {
  checkValveCount,
  convertFlowText,
  pressureGateValveCount,
  computeDepth,
  floatSwitchCount,
  fromLps,
  gateValveCount,
  pipeGradeName,
  pnForWeightLookup,
  PN_SURVEY_DEFAULT,
  sleeveDiameter,
  snByDepth,
  snDesignation,
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

  // Дефект: при смене единиц менялась только подпись — 25,13 л/с становились
  // 25,13 м³/ч, в 3,6 раза меньше, и вслед уезжали подбор насоса и глубина.
  it('смена единиц пересчитывает значение поля: воды столько же', () => {
    expect(convertFlowText('25,13', 'l/s', 'm3/h')).toBe('90,47')
    expect(convertFlowText('25,13', 'l/s', 'm3/day')).toBe('2171,23')
    expect(convertFlowText('90,47', 'm3/h', 'l/s')).toBe('25,13')
  })

  it('туда и обратно — исходное значение', () => {
    const there = convertFlowText('25,13', 'l/s', 'm3/h')!
    expect(convertFlowText(there, 'm3/h', 'l/s')).toBe('25,13')
  })

  it('пустое, нечисловое и те же единицы не трогает', () => {
    expect(convertFlowText('', 'l/s', 'm3/h')).toBeNull()
    expect(convertFlowText('2**3', 'l/s', 'm3/h')).toBeNull()
    expect(convertFlowText('25,13', 'l/s', 'l/s')).toBeNull()
  })

  it('выражение считается перед пересчётом', () => {
    expect(convertFlowText('20+5,13', 'l/s', 'm3/h')).toBe('90,47')
  })

  it('ЕИ не меняет итоговую глубину', () => {
    const a = computeDepth(OL3487)
    const b = computeDepth({ ...OL3487, flow: fromLps(25.13, 'm3/h'), flowUnit: 'm3/h' })
    expect(b.npodzMm).toBe(a.npodzMm)
  })
})

// Правило подтверждено заводом: реальных жёсткостей две — 5000 и 10000, порог
// по глубине 7000 мм. Прежняя лестница 1250/2500/5000/10000 с порогами
// 3000/5000/8000 была прототипом, собранным без точных данных.
describe('snByDepth — расчётная жёсткость', () => {
  it.each([
    [11600, 10000],
    [7001, 10000],
    [7000, 5000],
    [5000, 5000],
    [3000, 5000],
    [0, 5000],
  ])('глубина %i мм → SN %i', (depth, expected) => {
    expect(snByDepth(depth)).toBe(expected)
  })

  it('«под проезжей частью» поднимает жёсткость на ступень: 5000 → 10000', () => {
    expect(snByDepth(3000, { underRoadway: true })).toBe(10000)
    expect(snByDepth(7000, { underRoadway: true })).toBe(10000)
  })

  it('выше порога поднимать некуда — остаётся 10000', () => {
    expect(snByDepth(11600, { underRoadway: true })).toBe(10000)
  })

  it('ТТ МВК расчётную жёсткость НЕ меняет', () => {
    // Реальный ОЛ3487: глубина 11 600 при действующих ТТ МВК показывает 10000.
    expect(snByDepth(11600)).toBe(10000)
  })
})

// Те же примеры прогоняет бэкенд (utils/ring-stiffness.ts): правило задано в
// двух местах, и до 11.09.2026 они расходились — сервер считал по старому
// «глубина патрубка + 2 м > 7 м».
describe('правило SN — общие примеры с бэкендом', () => {
  it.each(snVectors.cases)('%j', ({ depthMm, underRoadway, mvk, sn, designation }) => {
    const calc = snByDepth(depthMm, { underRoadway })
    expect(calc).toBe(sn)
    expect(snDesignation(calc, { mvk })).toBe(designation)
  })
})

describe('snDesignation — обозначение жёсткости для заказчика', () => {
  it('без ТТ МВК обозначение совпадает с расчётным', () => {
    expect(snDesignation(5000)).toBe(5000)
    expect(snDesignation(10000)).toBe(10000)
  })

  it('под ТТ МВК: 5000 → 8000, 10000 → 12000 (та же труба + 2 нитки ровинга)', () => {
    expect(snDesignation(5000, { mvk: true })).toBe(8000)
    expect(snDesignation(10000, { mvk: true })).toBe(12000)
  })

  it('незнакомое значение под ТТ МВК возвращается как есть', () => {
    expect(snDesignation(2500, { mvk: true })).toBe(2500)
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

  // Ветка эталона «DN1300 + SN 5000/10000 → 0,4» вела в несуществующий ключ и
  // была достижима на обычном изделии: у КНС PN_ОЛ всегда 0,1, а SN 5000
  // наступает глубже 5 м. Завод объяснил (2026-09-09): 0,4 — класс изделия,
  // а У ТРУБ классы 0,1 и 0,4 идентичны 0,6, то есть это одна и та же труба.
  it('DN1300 глубже 5 м находит вес: классы труб 0,1 и 0,4 — это 0,6', () => {
    expect(pnForWeightLookup(0.1, 1300, 5000)).toBe(0.6)
    expect(pnForWeightLookup(0.1, 1300, 10000)).toBe(0.6)
    expect(pnForWeightLookup(0.4, 1300, 5000)).toBe(0.6)
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

  it('под ТТ МВК в марку идёт обозначение 12000, а вес ищется по 10000', () => {
    expect(pipeGradeName(3000, PN_SURVEY_DEFAULT, 10000, { mvk: true })).toBe(
      'Труба СК/НПС-К 3000-0,1-12000',
    )
    expect(pipeGradeName(3000, PN_SURVEY_DEFAULT, 5000, { mvk: true })).toContain('-8000')
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

  // Схема завода: задвижка на стояке КАЖДОГО установленного насоса (включая
  // резервный — он обвязан так же) плюс по задвижке на отводящий патрубок.
  it('ОЛ3487: 3 насоса + 2 отводящих → 5 задвижек напорной стороны', () => {
    expect(pressureGateValveCount(2, 1, 2)).toBe(5)
  })

  // Итог сходится с опросным листом: 5 напорных + подводящая + аварийная = 7,
  // и ровно 7 стоит в поле «Количество задвижек» ОЛ3487.
  it('вместе с подводящей и аварийной выходит 7 — как в опросном листе', () => {
    expect(pressureGateValveCount(2, 1, 2) + gateValveCount(1, true) + 1).toBe(7)
  })

  it('обратные клапаны — по одному на установленный насос', () => {
    expect(checkValveCount(2, 1)).toBe(3)
  })

  it('поплавки = раб + рез + 2', () => {
    expect(floatSwitchCount(2, 1)).toBe(5)
  })
})
