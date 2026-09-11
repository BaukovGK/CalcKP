import { beforeEach, describe, expect, it } from 'vitest'
// Прямой импорт прайса из бэкенда — как в basket-grinder.test.ts: имя позиции
// — часть ключа цены, и сверять его надо с настоящим прайсом.
import prices from '../../../backend/prisma/seed-data/prices.json'
import type { NozzleNorm } from './formulas'
import { frameHours, pickAtLeast, pumpLiftChainM } from './formulas'
import { MOUNTING_LOOP_KITS, MOUNTING_LOOP_WORKS, buildMountingLoops } from './mounting-loops'
import {
  FLOAT_SWITCH_CABLES_M,
  HOIST_HEIGHTS_M,
  SENSOR_CABLES_M,
  SIZED_NAMES,
  STATION_ITEMS,
  STATION_WORKS,
  buildPumpMounting,
} from './station-equipment'
import {
  __resetIds,
  flattenRows,
  LADDER_ITEMS,
  type KnsSurveyParams,
  type MaterializeContext,
} from './template-kns'
import { emkLadderHeightMm, type EmkSurveyParams, type KolSurveyParams } from './template-emk-kol'
import { materializeEmk, materializeKns, materializeKol } from './materialize'
import { computeEmkGeometry } from './survey-emk-kol'

const KEYS = new Set(prices.map((p) => `${p.category}|${p.name}|${p.unit}`))
const PRICE = new Map(prices.map((p) => [`${p.category}|${p.name}|${p.unit}`, p.priceRub]))
const has = (category: string, name: string, unit: string) => KEYS.has(`${category}|${name}|${unit}`)

/** Нормы патрубков из листа «Для расчетов» — нужны крепежу напорного DN150. */
const NORMS: NozzleNorm[] = [
  { dn: 150, odMm: null, minLengthMm: null, moldingMassKg: 0.6, h1Mm: null, s1Mm: null, flangeMassKg: 1.4, bolt: 'М20х90', boltCount: 8 },
  { dn: 250, odMm: null, minLengthMm: null, moldingMassKg: 0.6, h1Mm: null, s1Mm: null, flangeMassKg: 2.3, bolt: 'М24х100', boltCount: 12 },
  { dn: 400, odMm: 413.1, minLengthMm: 406, moldingMassKg: 1.1, h1Mm: 101, s1Mm: 6.8, flangeMassKg: 4.6, bolt: 'М24х100', boltCount: 16 },
  { dn: 500, odMm: null, minLengthMm: null, moldingMassKg: 1.5, h1Mm: null, s1Mm: null, flangeMassKg: 6, bolt: 'М24х100', boltCount: 20 },
]

const ctx: MaterializeContext = {
  priceOf: (c, n, u) => PRICE.get(`${c}|${n}|${u}`) ?? null,
  pipeWeightOf: () => null,
  nozzleNormOf: (dn) => NORMS.find((n) => n.dn === dn) ?? null,
  jointLayerMassOf: () => 112,
  priceListVersion: 1,
}

beforeEach(() => __resetIds())

describe('позиции новых узлов против прайса', () => {
  it('материалы крепления, подъёма, автоматики и обслуживания — дословно из прайса', () => {
    for (const item of Object.values(STATION_ITEMS)) {
      expect(has(item.category, item.name, item.unit), `нет в прайсе: ${item.name}`).toBe(true)
    }
  })

  it('работы — позиции «Собственного производства»', () => {
    for (const name of Object.values(STATION_WORKS)) {
      expect(has('Собственное производство', name, 'чел. ч'), name).toBe(true)
    }
  })

  it('каждый типоразмер кабеля и тали из ряда есть в прайсе', () => {
    for (const m of FLOAT_SWITCH_CABLES_M) expect(has('Выключатели', SIZED_NAMES.floatSwitch(m), 'шт'), `${m}`).toBe(true)
    for (const m of SENSOR_CABLES_M) {
      expect(has('Датчики', SIZED_NAMES.pressureSensor(m), 'шт'), `давление ${m}`).toBe(true)
      expect(has('Датчики', SIZED_NAMES.levelSensor(m), 'шт'), `уровень ${m}`).toBe(true)
    }
    for (const h of HOIST_HEIGHTS_M) expect(has('Грузоподъем', SIZED_NAMES.hoist(h), 'шт'), `таль ${h}`).toBe(true)
  })

  it('расходомеры — весь ряд DN прайса', () => {
    for (const dn of [50, 65, 80, 100, 150, 200, 250, 300, 400]) {
      expect(has('Расходомеры', SIZED_NAMES.flowMeter(dn), 'шт'), `DN${dn}`).toBe(true)
    }
  })

  it('петли монтажные: оба комплекта и работы', () => {
    for (const kit of Object.values(MOUNTING_LOOP_KITS)) {
      for (const l of kit.lines) expect(has(l.category, l.name, l.unit), l.name).toBe(true)
    }
    expect(has('Собственное производство', MOUNTING_LOOP_WORKS.lamination, 'кг')).toBe(true)
    expect(has('Собственное производство', MOUNTING_LOOP_WORKS.make, 'чел. ч')).toBe(true)
    expect(has('Собственное производство', MOUNTING_LOOP_WORKS.mount, 'чел. ч')).toBe(true)
  })

  it('материалы лестницы', () => {
    for (const item of Object.values(LADDER_ITEMS)) expect(has(item.category, item.name, item.unit), item.name).toBe(true)
  })
})

describe('формулы узлов', () => {
  it('наименьший типоразмер не меньше нужного; ровный — сам', () => {
    expect(pickAtLeast([10, 20, 30, 40], 11.8)).toBe(20)
    expect(pickAtLeast([6, 9, 12, 18], 12)).toBe(12)
    expect(pickAtLeast([10, 20], 20.1)).toBeNull()
  })

  it('цепь подъёма насосов = ROUNDUP(насосов × (H + 1))', () => {
    expect(pumpLiftChainM(3, 11.8)).toBe(39)
    expect(pumpLiftChainM(2, 5)).toBe(12)
  })

  it('рама: 6 + 5 чел.ч до DN 2500, 7 + 6 от него', () => {
    expect(frameHours(2400)).toEqual({ make: 6, mount: 5 })
    expect(frameHours(2500)).toEqual({ make: 7, mount: 6 })
  })

  it('петли простые до DN 2000: болт М12, лист 3 мм, ламинирование 0,4 кг на петлю', () => {
    const loops = buildMountingLoops(ctx, 1500)
    expect(loops.title).toBe('Петли монтажные по чертежу НТТ 648 ×4')
    const q = (n: string) => loops.rows.find((r) => r.name === n)!.qtyCalc
    expect(q('Болт М12-6gх50.58.12Х18Н10Т ГОСТ 7798-70 (DIN 931, DIN 933)')).toBe(8)
    expect(q('Лист г/к Б-ПН-О-3,0х1500х3000 ГОСТ 19903-74 // Ст3пс ГОСТ 16523-97')).toBe(0.016)
    expect(q('Ламинирование петель к корпусу')).toBe(1.6)
    // Ламинирование — с ФОТ-спутником, как всякая операция в кг.
    expect(loops.rows.some((r) => r.kind === 'ФОТ')).toBe(true)
  })

  it('ёмкость: направляющие 54×2 и цепь 6 мм с карабинами и прутком', () => {
    const [fastening, lifting] = buildPumpMounting(ctx, {
      device: 'EMK',
      dn: 3000,
      guideHeightM: 5,
      liftHeightM: 5,
      pumpsWorking: 1,
      pumpsReserve: 1,
    })
    // Образец листа ЕМК: высота лестницы 5 м, 1 + 1 насос → 20 м трубы, цепь 12 м.
    expect(fastening!.rows.find((r) => r.name === STATION_ITEMS.guidePipeEmk.name)!.qtyCalc).toBe(20)
    expect(fastening!.rows.find((r) => r.name === STATION_ITEMS.frameAngleEmk.name)!.qtyCalc).toBeNull()
    const q = (n: string) => lifting!.rows.find((r) => r.name === n)!.qtyCalc
    expect(q(STATION_ITEMS.liftChainEmk.name)).toBe(12)
    expect(q(STATION_ITEMS.liftCarabinerEmk.name)).toBe(6)
    expect(q(STATION_ITEMS.liftRoundBarEmk.name)).toBeCloseTo(1.884, 9)
  })
})

describe('шаблон КНС против настоящего прайса', () => {
  // Образец эталона: DN 3000, 11 500 + 300, подводящий DN400, два напорных
  // DN150, 2 + 1 насоса и один на склад, всё оборудование включено.
  const REF: KnsSurveyParams = {
    dn: 3000,
    depthMm: 11500,
    elevationMm: 300,
    pnSurvey: 0.1,
    sn: 10000,
    mvk: true,
    inletDn: 400,
    inletCount: 1,
    inletTrayDepthMm: 9910,
    outletDn: 150,
    outletCount: 2,
    pumpsWorking: 2,
    pumpsReserve: 1,
    pumpsSpare: 1,
    valveOnInlet: true,
    emergencyPipeline: true,
    hasFlowMeter: true,
    hasBasket: true,
    hasControlCabinet: true,
    controlCabinetType: 'уличный',
    controlCabinetStart: 'плавный',
    hasPressureSensors: true,
    hasLevelSensor: true,
    insulationEnabled: true,
    insulationDepthMm: 2000,
  }

  // Договорные позиции — те, что подбираются под проект: у них цены в прайсе
  // нет и не должно быть. Любая другая «красная» строка — опечатка в имени.
  it('«красные» только договорные позиции: труба, насос, муфта, шкаф, задвижка на подводящем', () => {
    const red = flattenRows(materializeKns(ctx, REF))
      .filter((r) => r.priceCatalog == null && r.priceManual == null)
      .map((r) => r.name)
    expect(red).toEqual([
      'Труба СК/НПС-К 3000-0,1-12000',
      'Задвижка шиберная с невыдв.шпинделем с ручным управлением DN400 PN10 и удлиненным штоком L=9710 мм (высота штока указана от оси трубы)',
      'Насос (марка по подбору)',
      'Автоматическая трубная муфта',
      'Шкаф управления насосами (3 шт.), уличный, пуск плавный',
    ])
  })

  it('у ёмкости с насосами и колодца новые строки тоже находят цены', () => {
    const EMK: EmkSurveyParams = {
      dn: 2000,
      volumeM3: 50,
      placement: 'горизонтальное',
      installation: 'подземная',
      tankType: 'Накопительная',
      pnSurvey: 0.1,
      hasShaft: true,
      inletDn: 150,
      inletCount: 1,
      outletDn: 150,
      outletCount: 1,
      hasPumps: true,
      pumpsWorking: 1,
      pumpsReserve: 1,
      hasBasket: false,
      insulationEnabled: false,
      insulationDepthMm: 2000,
    }
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
    const fresh = (rows: ReturnType<typeof flattenRows>) =>
      rows.filter(
        (r) =>
          r.priceCatalog == null &&
          r.priceManual == null &&
          // Трубы корпуса, шахты и горловины — договорные, как у КНС.
          !r.name.startsWith('Труба СК'),
      )
    expect(fresh(flattenRows(materializeEmk(ctx, EMK))).map((r) => r.name)).toEqual([])
    expect(fresh(flattenRows(materializeKol(ctx, KOL))).map((r) => r.name)).toEqual([])
    // Направляющие ёмкости — на высоту лестницы: DN + шахта.
    const geo = computeEmkGeometry(EMK)
    const guide = flattenRows(materializeEmk(ctx, EMK)).find((r) => r.name === STATION_ITEMS.guidePipeEmk.name)!
    expect(guide.qtyCalc).toBeCloseTo((emkLadderHeightMm(EMK, geo) / 1000) * 2 * 2, 9)
  })
})
