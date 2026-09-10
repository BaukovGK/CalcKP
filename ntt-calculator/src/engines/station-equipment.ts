/**
 * Оборудование насосной станции по эталону «Шаблон 3.0.xlsx»:
 *
 *   крепление и подъём насосов — раздел «Перекрытие, площадка, несущие
 *     балки» (лист КНС, строки 189–197 и 245–248; ЕМК — 163–171 и 195–198);
 *   автоматика и оборудование обслуживания — раздел «Оборудование» (лист
 *     КНС, строки 415–422 и 431–433).
 *
 * Раньше направляющие насосов считались в напорном трубопроводе трудом
 * «0,25 чел.ч на метр» — норматив, которого в эталоне нет. В листе иначе:
 * направляющие — это МАТЕРИАЛ (труба из паспорта насоса, по две нитки на
 * всю высоту на каждый насос), а работы — по 2 чел.ч на насос на
 * изготовление и столько же на монтаж, плюс рама насосов по порогу DN 2500.
 *
 * Высота станции — подземная часть плюс возвышение над землёй: от неё цепь
 * подъёма насосов, высота подъёма тали и длина кабеля датчиков и
 * поплавков. Кабель и таль в прайсе — ряд типоразмеров; берётся наименьший,
 * не меньший высоты (в эталоне при 11,8 м — кабель 20 м и таль Н=12 м).
 * Если высота больше самого крупного, строка остаётся «красной» с
 * обобщённым наименованием: подставить позицию, которая не достаёт, хуже.
 */

import { roundBarLengthM } from './basket-grinder'
import { frameHours, pickAtLeast, pumpLiftChainM } from './formulas'
import { roundUp } from './rounding'
import {
  makeRow,
  nextId,
  surveyToggled,
  type CalcComponent,
  type CalcRowNode,
  type MaterializeContext,
} from './template-kns'
import type { Category } from './types'

/** Изделие с насосами: у КНС и ёмкости крепление и такелаж разные. */
export type PumpDevice = 'KNS' | 'EMK'

interface Item {
  category: Category
  name: string
  unit: string
}

/**
 * Позиции прайса. Наименования — ДОСЛОВНО из прайса (ключ цены —
 * `категория|наименование|ЕИ`); тест сверяет их с `prices.json`.
 */
export const STATION_ITEMS = {
  /** Направляющие насосов КНС: Ø из паспорта насоса, в эталоне по умолчанию 32×2. */
  guidePipeKns: { category: 'Металлопрокат', name: 'Труба 32х2мм 12Х18Н10Т (AISI 304) ГОСТ 9941-81', unit: 'м' },
  /** Направляющие насосов ёмкости: в эталоне по умолчанию 54×2. */
  guidePipeEmk: { category: 'Металлопрокат', name: 'Труба 54х2мм 12Х18Н10Т (AISI 304) ГОСТ 9941-81', unit: 'м' },
  frameChannel: { category: 'Металлопрокат', name: 'Швеллер 12-П ст3пс ГОСТ 8240-97', unit: 'м' },
  frameRebar: { category: 'Металлопрокат', name: 'Арматура 20-А-I Ст3пс ГОСТ 5781-82 гладкая (А240)', unit: 'м' },
  frameAngleEmk: { category: 'Металлопрокат', name: 'Уголок 63х63х6мм ст3пс ГОСТ8509-93', unit: 'м' },

  liftChainKns: { category: 'Грузоподъем', name: 'Цепь короткозвенная сварная 5 мм DIN 766 А2/А4', unit: 'м' },
  liftShackleKns: { category: 'Грузоподъем', name: 'Скоба такелажная прямая М6', unit: 'шт' },
  liftRingKns: { category: 'Грузоподъем', name: 'Кольцо сварное полированное АРТ 8229 А4 10Х60', unit: 'шт' },
  liftChainEmk: { category: 'Грузоподъем', name: 'Цепь короткозвенная сварная 6 мм DIN 766 А2/А4', unit: 'м' },
  liftCarabinerEmk: { category: 'Грузоподъем', name: 'Карабин винтовой 6 мм нерж. А4 ART 8253', unit: 'шт' },
  liftRoundBarEmk: { category: 'Металлопрокат', name: 'Круг 6 мм 12Х18Н10Т ГОСТ 5949-75', unit: 'м' },

  /** Футляр погружного датчика уровня: труба с перфорацией до отметки 0.000. */
  levelSensorCasing: {
    category: 'Детали труб_да ПЭ ПВХ PPR',
    name: 'Труба ПЭ 100 SDR17 Ø110×6,6 PN10 ГОСТ 18599-2001',
    unit: 'м',
  },
  tripod: { category: 'Грузоподъем', name: 'Тренога перегрузочная ТП-1000 г/п 1000 кг (без тали)', unit: 'шт' },
  gasAnalyzer: { category: 'Прочее оборудование', name: 'Переносной газоанализатор (CH4, H2S, CO, O2)', unit: 'шт' },
} as const satisfies Record<string, Item>

/** Длины кабеля поплавкового выключателя в прайсе, м. */
export const FLOAT_SWITCH_CABLES_M = [10, 20, 30, 40] as const
/** Длины кабеля датчиков давления и уровня в прайсе, м. */
export const SENSOR_CABLES_M = [10, 20] as const
/** Высоты подъёма ручной тали 0,5 т в прайсе, м. */
export const HOIST_HEIGHTS_M = [6, 9, 12, 18] as const

/** Наименования, в которые входит типоразмер, — по шаблону прайса. */
export const SIZED_NAMES = {
  floatSwitch: (cableM: number) => `ПОПЛАВКОВЫЙ ВЫКЛЮЧАТЕЛЬ КАБЕЛЬ ${cableM} М`,
  pressureSensor: (cableM: number) =>
    'Датчик давления общепромышленного применения (диапазон измерения 0..10 бар, выходной сигнал 4..20 мА / ' +
    '2-х пров. / 12..36 В, присоединение М20х1.5 DIN 3852, уплотнение EPDM, стандартное исполнение) ' +
    `с кабелем ${cableM} м`,
  levelSensor: (cableM: number) =>
    'Погружной датчик уровня (гидростатического давления) (диапазон измерения 0..10 бар), с керамическим ' +
    'сенсором в корпусе из пластика PVC (поливинилхлорида), уплотнение EPDM) в защитном кожухе ' +
    `с кабелем ${cableM} м`,
  hoist: (heightM: number) => `Таль ручная цепная ТРШС 0,5т Н=${heightM}м`,
  flowMeter: (dn: number) =>
    `Расходомер электромагнитный DN${dn} с фланцевым типом присоединения, с раздельным конструкционным ` +
    'исполнением, со степенью защиты IP68',
} as const

/** Работы — позиции прайса «Собственного производства», ЕИ «чел. ч». */
export const STATION_WORKS = {
  guidesMake: 'Изготовление направляющих насосов',
  guidesMount: 'Монтаж направляющих насосов',
  frameMake: 'Изготовление рамы насосов',
  frameMount: 'Монтаж рамы насосов',
  pumpsMount: 'Монтаж Насосов',
  couplingMount: 'Монтаж Систем автоматической трубной муфты',
  floatsMount: 'Монтаж Поплавковых выключателей',
  knifeGateMount: 'Монтаж Задвижки шиберной ножевой',
  wedgeGateMount: 'Монтаж Задвижки клиновой',
  checkValveMount: 'Монтаж Клапанов обратных шаровых',
  sensorsMount: 'Монтаж датчиков',
  flowMeterMount: 'Монтаж расходомера',
  cabinetMount: 'Монтаж Шкафа управления',
} as const

const fmt = (n: number, digits = 2) => n.toLocaleString('ru-RU', { maximumFractionDigits: digits })

function material(ctx: MaterializeContext, item: Item, qtyCalc: number | null, note: string): CalcRowNode {
  return makeRow(ctx, { kind: 'МАТЕРИАЛ', ...item, qtyCalc, note })
}

/** Работа «Собственного производства» в чел.ч. */
export function work(ctx: MaterializeContext, name: string, qtyCalc: number, note: string): CalcRowNode {
  return makeRow(ctx, { kind: 'ОПЕРАЦИЯ', category: 'Собственное производство', name, unit: 'чел. ч', qtyCalc, note })
}

interface SizedSpec {
  category: Category
  sizes: readonly number[]
  /** Нужный типоразмер, м. */
  need: number
  name: (size: number) => string
  /** Наименование, когда типоразмера нет: его нет и в прайсе. */
  generic: string
}

/**
 * Строка позиции, выбираемой по типоразмеру (кабель, высота тали).
 *
 * Нашёлся типоразмер — наименование прайса с ним. Не нашёлся — обобщённое
 * наименование, которого в прайсе нет: строка «красная», пока инженер не
 * выберет позицию сам.
 */
function sized(ctx: MaterializeContext, spec: SizedSpec, qtyCalc: number, note: string): CalcRowNode {
  const size = pickAtLeast(spec.sizes, spec.need)
  const largest = Math.max(...spec.sizes)
  return makeRow(ctx, {
    kind: 'МАТЕРИАЛ',
    category: spec.category,
    name: size == null ? spec.generic : spec.name(size),
    unit: 'шт',
    qtyCalc,
    note:
      size == null
        ? `${note} · нужно не меньше ${fmt(spec.need)} м, в прайсе наибольшее ${fmt(largest)} м — подберите позицию`
        : `${note} · наименьшее из прайса не меньше ${fmt(spec.need)} м`,
  })
}

/** Поплавковые выключатели с кабелем по высоте станции. */
export function floatSwitchRow(ctx: MaterializeContext, count: number, heightM: number, note: string): CalcRowNode {
  return sized(
    ctx,
    {
      category: 'Выключатели',
      sizes: FLOAT_SWITCH_CABLES_M,
      need: heightM,
      name: SIZED_NAMES.floatSwitch,
      generic: 'ПОПЛАВКОВЫЙ ВЫКЛЮЧАТЕЛЬ (кабель по высоте станции)',
    },
    count,
    note,
  )
}

// ─── Крепление и подъём насосов ─────────────────────────────────────────────

export interface PumpMountingParams {
  device: PumpDevice
  /** DN корпуса, мм — от него нормы рамы насосов. */
  dn: number
  /**
   * Высота одной нитки направляющих, м: у КНС — длина трубы корпуса
   * (`J14`), у ёмкости — высота лестницы (`I114`).
   */
  guideHeightM: number
  /**
   * Высота подъёма насоса, м: у КНС — подземная часть с возвышением
   * (`H5`), у ёмкости — высота лестницы.
   */
  liftHeightM: number
  pumpsWorking: number
  pumpsReserve: number
}

/**
 * Узлы «Крепление насосного оборудования» (D1) и «Грузоподъём насосов» (D5).
 *
 * Считаются установленные насосы (раб + рез): запасные на склад не требуют
 * ни направляющих, ни цепи.
 *
 * Металл рамы — швеллер, арматура, у ёмкости уголок — лист не выводит: в
 * образце количества вписаны руками. Строки рождаются пустыми, с этими
 * цифрами в примечании.
 */
export function buildPumpMounting(ctx: MaterializeContext, p: PumpMountingParams): CalcComponent[] {
  const I = STATION_ITEMS
  const W = STATION_WORKS
  const pumps = p.pumpsWorking + p.pumpsReserve
  const guideM = p.guideHeightM * pumps * 2
  const frame = frameHours(p.dn)
  const threshold = `DN ${p.dn} ${p.dn < 2500 ? '<' : '≥'} 2500`
  const kns = p.device === 'KNS'
  const guideBase = kns ? `L корпуса ${fmt(p.guideHeightM)} м` : `высота лестницы ${fmt(p.guideHeightM)} м`

  const fastening: CalcComponent = {
    id: nextId('c'),
    nodeCode: 'D1',
    title: 'Крепление насосного оборудования',
    enabled: true,
    rows: [
      material(
        ctx,
        kns ? I.guidePipeKns : I.guidePipeEmk,
        guideM,
        `ƒ ${guideBase} × насосов ${pumps} × 2 нитки = ${fmt(guideM)} м · Ø из паспорта насоса`,
      ),
      material(ctx, I.frameChannel, null, 'Рама насосов — по компоновке; в образце эталона 5 м'),
      kns
        ? material(ctx, I.frameRebar, null, 'Рама насосов — по компоновке; в образце эталона 1 м')
        : material(ctx, I.frameAngleEmk, null, 'Рама насосов — по компоновке; в образце эталона 4 м'),
      work(ctx, W.guidesMake, 2 * pumps, `ƒ 2 чел.ч × насосов ${pumps}`),
      work(ctx, W.guidesMount, 2 * pumps, `ƒ 2 чел.ч × насосов ${pumps}`),
      work(ctx, W.frameMake, frame.make, `ƒ ${threshold} → ${frame.make} чел.ч`),
      work(ctx, W.frameMount, frame.mount, `ƒ ${threshold} → ${frame.mount} чел.ч`),
    ],
  }

  const chain = pumpLiftChainM(pumps, p.liftHeightM)
  const chainNote = `ƒ ROUNDUP(насосов ${pumps} × (${fmt(p.liftHeightM)} м + 1 м)) — на подъём каждого насоса`
  const liftingRows = kns
    ? [
        material(ctx, I.liftChainKns, chain, chainNote),
        // В листе скоб и колец столько же, сколько метров цепи (I196 =
        // ROUNDUP(I195), I197 = I195) — так и переносим; вопрос заводу.
        material(ctx, I.liftShackleKns, chain, 'ƒ по эталону — столько же, сколько метров цепи'),
        material(ctx, I.liftRingKns, chain, 'ƒ по эталону — столько же, сколько метров цепи'),
      ]
    : [
        material(ctx, I.liftChainEmk, chain, chainNote),
        material(ctx, I.liftCarabinerEmk, roundUp(chain / 2, 0), 'ƒ по карабину на два метра цепи'),
        material(ctx, I.liftRoundBarEmk, roundBarLengthM(chain), 'ƒ 3,14 × 0,05 м прутка на метр цепи'),
      ]

  const lifting: CalcComponent = {
    id: nextId('c'),
    nodeCode: 'D5',
    title: 'Грузоподъём насосов',
    enabled: true,
    rows: liftingRows,
  }

  return [fastening, lifting]
}

// ─── Автоматика (D2) ─────────────────────────────────────────────────────────

export interface AutomationParams {
  /** Высота станции, м — от неё длина кабеля датчиков. */
  heightM: number
  /** Длина трубы корпуса, м — футляр датчика уровня идёт на всю её длину. */
  depthM: number
  outletDn: number
  outletCount: number
  /** Установленные насосы — в наименование шкафа. */
  pumps: number
  controlCabinet: boolean
  cabinetType?: string | null
  cabinetStart?: string | null
  pressureSensors: boolean
  levelSensor: boolean
  flowMeter: boolean
}

/**
 * Шкаф управления, датчики давления и уровня, расходомер — каждый своим
 * узлом под свой тумблер ОЛ (блок «Автоматика»). Выключенный в ОЛ узел
 * остаётся «призраком», как теплоизоляция и корзина.
 *
 * Шкаф в прайсе не заведён: его подбирают по мощности и числу насосов
 * (каталог АШУ), и строка «красная» до ввода цены — как насос без цены.
 */
export function buildAutomation(ctx: MaterializeContext, p: AutomationParams): CalcComponent[] {
  const W = STATION_WORKS
  const sensor = (name: (m: number) => string, generic: string): SizedSpec => ({
    category: 'Датчики',
    sizes: SENSOR_CABLES_M,
    need: p.heightM,
    name,
    generic,
  })
  const cabinetName =
    `Шкаф управления насосами (${p.pumps} шт.)` +
    (p.cabinetType ? `, ${p.cabinetType}` : '') +
    (p.cabinetStart ? `, пуск ${p.cabinetStart}` : '')

  return [
    {
      id: nextId('c'),
      nodeCode: 'D2',
      title: 'Шкаф управления',
      ...surveyToggled(p.controlCabinet),
      rows: [
        material(
          ctx,
          { category: 'Шкафы', name: cabinetName, unit: 'шт' },
          1,
          'Подбор по мощности и числу насосов (каталог АШУ) — цену введите вручную',
        ),
        work(ctx, W.cabinetMount, 6, 'ƒ 6 чел.ч на шкаф'),
      ],
    },
    {
      id: nextId('c'),
      nodeCode: 'D2',
      title: 'Датчики давления',
      ...surveyToggled(p.pressureSensors),
      rows: [
        sized(
          ctx,
          sensor(SIZED_NAMES.pressureSensor, 'Датчик давления 0..10 бар, 4..20 мА (кабель по высоте станции)'),
          p.outletCount,
          `ƒ по одному на напорный патрубок (${p.outletCount})`,
        ),
        work(ctx, W.sensorsMount, p.outletCount, 'ƒ 1 чел.ч на датчик'),
      ],
    },
    {
      id: nextId('c'),
      nodeCode: 'D2',
      title: 'Датчик уровня',
      ...surveyToggled(p.levelSensor),
      rows: [
        sized(
          ctx,
          sensor(SIZED_NAMES.levelSensor, 'Погружной датчик уровня 0..10 бар (кабель по высоте станции)'),
          1,
          'ƒ один на станцию',
        ),
        material(
          ctx,
          STATION_ITEMS.levelSensorCasing,
          p.depthM,
          `ƒ длина корпуса ${fmt(p.depthM)} м · защитный футляр с перфорацией, выведен до отметки 0.000`,
        ),
        work(ctx, W.sensorsMount, 1, 'ƒ 1 чел.ч на датчик'),
      ],
    },
    {
      id: nextId('c'),
      nodeCode: 'D2',
      title: 'Расходомер',
      ...surveyToggled(p.flowMeter),
      rows: [
        material(
          ctx,
          { category: 'Расходомеры', name: SIZED_NAMES.flowMeter(p.outletDn), unit: 'шт' },
          p.outletCount,
          `ƒ по одному на напорный патрубок (${p.outletCount}) · DN напорного`,
        ),
        work(ctx, W.flowMeterMount, p.outletCount, 'ƒ 1 чел.ч на расходомер'),
      ],
    },
  ]
}

// ─── Оборудование обслуживания (D5) ─────────────────────────────────────────

/**
 * Тренога с талью и переносной газоанализатор — в эталоне по одному на
 * станцию всегда (лист КНС, строки 418, 421–422). Таль — по высоте станции.
 */
export function buildServiceEquipment(ctx: MaterializeContext, p: { heightM: number }): CalcComponent {
  const I = STATION_ITEMS
  return {
    id: nextId('c'),
    nodeCode: 'D5',
    title: 'Оборудование для обслуживания',
    enabled: true,
    rows: [
      material(ctx, I.tripod, 1, 'ƒ одна на станцию'),
      sized(
        ctx,
        {
          category: 'Грузоподъем',
          sizes: HOIST_HEIGHTS_M,
          need: p.heightM,
          name: SIZED_NAMES.hoist,
          generic: 'Таль ручная цепная 0,5 т (высота подъёма по станции)',
        },
        1,
        'ƒ одна на треногу, высота подъёма — по высоте станции',
      ),
      material(ctx, I.gasAnalyzer, 1, 'ƒ один на станцию'),
    ],
  }
}
