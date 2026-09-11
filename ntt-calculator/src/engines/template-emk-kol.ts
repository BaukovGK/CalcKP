/**
 * Узлы изделий ЕМК (ёмкость) и КОЛ (колодец): корпус по частям — обечайка,
 * днища, шахта или горловина, патрубки, теплоизоляция; люки, крепление
 * горизонтальной ёмкости и оборудование ёмкости. Разделы и порядок узлов
 * задаёт шаблон изделия (встроенный — engines/code-nodes.ts).
 *
 * Структура разделов у трёх изделий РАЗНАЯ — сверено с первоисточником
 * («Шаблон 3.0.xlsx», листы «Калькулятор ЕМК» и «Калькулятор колодца»):
 *
 *   КНС (7)              ЕМК (8)               КОЛ (7)
 *   1 Корпус             1 Корпус ёмкости      1 Корпус колодца
 *   2 Лестница           2 Корзина             2 Корзина
 *   3 Перекрытие         3 Лестница            3 Лестница
 *   4 Вентстояк          4 Перекрытие          4 Перекрытие
 *   5 Напорный           5 Вентстояк           5 Вентстояк
 *   6 Крепёж             6 Напорный            6 Крепёж
 *   7 Оборудование       7 Крепёж              7 Оборудование
 *                        8 Оборудование
 *
 * У колодца НЕТ напорного трубопровода (Реверс §6): насосов в нём нет.
 *
 * Общие узлы (лестница, перекрытие, вентстояк, крепёж, оборудование станции)
 * переиспользуются из шаблона КНС и station-equipment.ts; в шаблоны ЕМК и
 * КОЛ их ставит engines/code-nodes.ts.
 *
 * Построчная сверка с образцами листов — doc/Шаблон_ЕМК_КОЛ_разбор.md.
 */

import {
  bottomJointLaminationKg,
  bottomMassKg,
  cutoutHours,
  emkInsulation,
  insulation,
  laminationMassKg,
  marketableAppearanceHours,
  pipePrepHours,
  type InsulationResult,
} from './formulas'
import { FOT_K_LAMIN, FOT_K_MECH } from './fot'
import type { PipeMaterial } from '@/types/survey'
import {
  boundPrice,
  buildSleeveNozzles,
  grpNozzleOf,
  inletGateValveName,
  makeRow,
  nextId,
  operationWithFot,
  ownPipeRow,
  PUMP_PRICE_CATEGORY,
  pumpRowName,
  SERVICE_PIPE_PN,
  surveyToggled,
  TYPICAL_HATCH_MM,
  type CalcComponent,
  type CalcRowNode,
  type GrpNozzleJoint,
  type MaterializeContext,
  type SleeveNozzle,
} from './template-kns'
import {
  computeEmkGeometry,
  computeKolGeometry,
  CYLINDRICAL_BOTTOMS_PIPE_MM,
  matrixLengthBucketMm,
  neckCoverMassKg,
  tankMaterial,
  type EmkBottomType,
  type EmkGeometry,
  type Installation,
  type Placement,
  type TankType,
} from './survey-emk-kol'
import { floatSwitchCount, pnForWeightLookup } from './survey-kns'
import { buildAutomation, buildServiceEquipment, floatSwitchRow, STATION_WORKS, work } from './station-equipment'

/** Число для примечаний — по-русски: запятая, до двух знаков. */
const fmt = (n: number, digits = 2) => n.toLocaleString('ru-RU', { maximumFractionDigits: digits })

// ─── Каркасы разделов ────────────────────────────────────────────────────────

export const EMK_SECTIONS: ReadonlyArray<{ code: string; title: string }> = [
  { code: '1', title: 'Корпус ёмкости' },
  { code: '2', title: 'Корзина' },
  { code: '3', title: 'Лестница' },
  { code: '4', title: 'Перекрытие, площадка и несущие балки' },
  { code: '5', title: 'Вентиляционный стояк, входные патрубки' },
  { code: '6', title: 'Напорный трубопровод' },
  { code: '7', title: 'Крепёж' },
  { code: '8', title: 'Оборудование и запорная арматура' },
]

export const KOL_SECTIONS: ReadonlyArray<{ code: string; title: string }> = [
  { code: '1', title: 'Корпус колодца' },
  { code: '2', title: 'Корзина' },
  { code: '3', title: 'Лестница' },
  { code: '4', title: 'Перекрытие, площадка и несущие балки' },
  { code: '5', title: 'Вентиляционный стояк' },
  { code: '6', title: 'Крепёж' },
  { code: '7', title: 'Оборудование и запорная арматура' },
]

// ─── Параметры ОЛ ────────────────────────────────────────────────────────────

export interface EmkSurveyParams {
  dn: number
  /** Объём ёмкости, м³ — из него считается длина трубы. */
  volumeM3: number
  placement: Placement
  installation: Installation
  tankType: TankType
  pnSurvey: number
  /**
   * SN из ОЛ — расчётная по габаритам либо заданная вручную. Пусто — у
   * расчётов, собранных до появления поля: тогда по габаритам.
   */
  sn?: number | null
  /** Длина трубы, введённая в ОЛ вручную, мм; пусто — из объёма. */
  pipeLengthMm?: number | null
  /** Днища горизонтальной ёмкости; пусто — эллиптические. */
  bottomType?: EmkBottomType
  /**
   * Ответы ОЛ «Лестница» и «Вентиляция»: узлы лестницы и вентстояка следуют
   * за ними. Пусто — у расчётов, собранных до появления полей: тогда «да»,
   * как узлы и строились.
   */
  hasLadder?: boolean
  ventilation?: boolean

  hasShaft: boolean
  /**
   * Шахта — отрезок стеклопластиковой трубы своего диаметра. Поля
   * необязательные: у расчётов, сохранённых до их появления, остаются типовые
   * Ø1200 и высота по установке (`serviceShaft`).
   */
  shaftDiameterMm?: number | null
  shaftHeightMm?: number | null
  /**
   * Количество шахт (лист, L8 «Количество шахт, шт.»): на него умножаются
   * труба шахты и её муфта, ламинирование к корпусу, прорезка, утепление,
   * люки, вентстояки и приставные лестницы. Пусто — одна.
   */
  shaftCount?: number | null

  inletDn: number
  inletCount: number
  outletDn: number
  outletCount: number
  /**
   * Материал подходящей трубы (ОЛ «Материал»). Под стеклокомпозитную трубу
   * патрубок стеклопластиковый: гильза (до DN 300 формуется) и фланец с
   * болтовым комплектом — уточнение завода 11.09.2026. Пусто — у расчётов до
   * появления поля: берётся из формы ОЛ, иначе гильза под проход трубы.
   */
  inletMaterial?: PipeMaterial | null
  outletMaterial?: PipeMaterial | null

  /** Насосное оборудование (при «да» появляется напорный трубопровод). */
  hasPumps: boolean
  pumpsWorking: number
  pumpsReserve: number
  /** Марка насосов из ОЛ — в наименование строки насоса. */
  pumpModel?: string | null

  /**
   * Ответ ОЛ «Запорная арматура на подводящем»: шиберная задвижка со штоком
   * на каждый подводящий. Пусто — у расчётов до появления поля: узел
   * собирается выключенным.
   */
  valveOnInlet?: boolean
  /** Ответ ОЛ «Шкаф управления». */
  hasControlCabinet?: boolean
  /** Ответ ОЛ «Датчики уровня»: погружной датчик уровня с футляром. */
  hasLevelSensor?: boolean

  hasBasket: boolean
  /**
   * Глубина залегания H лотка подводящего, мм (ОЛ ёмкости, E51) — от неё
   * цепь и направляющие корзины, шток задвижки на подводящем. Пусто — эти
   * строки ждут ввода.
   */
  inletTrayDepthMm?: number | null
  insulationEnabled: boolean
  insulationDepthMm: number

  /** Цена трубы корпуса, ₽/м.п. — поле ОЛ, связано с ценой строки трубы. */
  pipePriceRub?: number | null
  /** Цена трубы шахты, ₽/м.п. — своя: у шахты свой диаметр. */
  servicePipePriceRub?: number | null

  tirage?: number
}

export interface KolSurveyParams {
  dn: number
  /** Глубина рабочей части, мм. */
  workingDepthMm: number
  elevationMm: number
  pnSurvey: number
  /** SN из ОЛ — расчётная по глубине либо заданная вручную; пусто — по глубине. */
  sn?: number | null
  /** Ответ ОЛ «Лестница»; пусто — «да», как у расчётов до появления поля. */
  hasLadder?: boolean

  hasNeck: boolean
  neckHeightMm: number
  neckDiameterMm: number

  inletDn: number
  inletCount: number
  outletDn: number
  outletCount: number
  /**
   * Материал подходящей трубы (ОЛ «Материал»). Под стеклокомпозитную трубу
   * вместо гильзы ставится муфта «Муфта-2» и ламинируется к корпусу —
   * уточнение завода 11.09.2026. Пусто — у расчётов до появления поля:
   * берётся из формы ОЛ, иначе гильза под проход трубы.
   */
  inletMaterial?: PipeMaterial | null
  outletMaterial?: PipeMaterial | null

  hasBasket: boolean
  /**
   * Дробилка (ОЛ колодца, E48 — то же поле, что у корзины). В листе
   * колодца её канал и направляющие входят в корпус (строки 67–75).
   */
  hasGrinder?: boolean
  /** Глубина залегания H лотка подводящего, мм (ОЛ колодца, E42). */
  inletTrayDepthMm?: number | null
  underRoadway: boolean
  insulationEnabled: boolean
  insulationDepthMm: number

  /** Цена трубы корпуса, ₽/м.п. — поле ОЛ, связано с ценой строки трубы. */
  pipePriceRub?: number | null
  /** Цена трубы горловины, ₽/м.п. — своя: у горловины свой диаметр. */
  servicePipePriceRub?: number | null

  tirage?: number
}

// ─── Трубы и муфты из стеклокомпозита ───────────────────────────────────────

/**
 * Марка трубы шахты и горловины. PN и SN вписаны в листах числом и от
 * корпуса не зависят: шахта ёмкости — SN 5000 (лист ЕМК, H54), горловина
 * колодца — SN 2500 (лист колодца, H36); PN 0,1 — давления они не несут.
 * Гильзы патрубков — общий узел трёх изделий (`buildSleeveNozzles`,
 * template-kns.ts), марка у них там же.
 */
export const SHAFT_PIPE_SN = 5000
export const NECK_PIPE_SN = 2500

/**
 * Соединительная муфта своего производства (листы: «Муфта соединительная
 * Муфта-1 {D}-1»). В прайсе её нет, в листе цена вписывается — строка
 * «красная» до ввода, как задвижка со штоком.
 */
function couplingRow(ctx: MaterializeContext, d: number, qtyCalc: number, note: string): CalcRowNode {
  return {
    ...makeRow(ctx, {
      kind: 'МАТЕРИАЛ',
      category: 'Собственное производство',
      name: `Муфта соединительная Муфта-1 ${d}-1`,
      unit: 'шт',
      qtyCalc,
      bucket: 'Труба, муфта',
      note: `${note} · цена договорная — введите`,
    }),
    priceCatalog: null,
  }
}

/**
 * Предварительные работы для подготовки трубы (транспортировка, разметка
 * осей, шлифовка) — `DN/(200·6) × L` по каждой трубе изделия: корпусу и
 * шахте ёмкости (лист ЕМК, строки 79–80), корпусу и горловине колодца
 * (лист колодца, 78–79).
 */
function pipePrepRow(ctx: MaterializeContext, dn: number, lengthM: number): CalcRowNode {
  return makeRow(ctx, {
    kind: 'ОПЕРАЦИЯ',
    category: 'Собственное производство',
    name: 'Предварительные работы для подготовки трубы (транспортировка, разметка осей, шлифовка)',
    unit: 'чел. ч',
    qtyCalc: pipePrepHours(dn, lengthM),
    note: `ƒ DN/(200·6) × L = ${dn}/1200 × ${lengthM.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} м`,
  })
}

/** Теплоизоляция — общий узел A9: площади считает изделие, слой — 4 мм у обоих. */
function buildInsulation(
  ctx: MaterializeContext,
  ins: InsulationResult,
  enabled: boolean,
  layerMm: number,
  areaNote: string,
): CalcComponent {
  return {
    id: nextId('c'),
    nodeCode: 'A9',
    title: 'Теплоизоляция корпуса',
    ...surveyToggled(enabled),
    rows: [
      makeRow(ctx, {
        kind: 'МАТЕРИАЛ',
        category: 'Прочие материалы',
        name: 'Теплоизоляция - Изофом ППЭ ОР 15 1,5х40',
        unit: 'м²',
        qtyCalc: ins.totalM2,
        note: `${areaNote} = ${fmt(ins.totalM2, 1)} м²`,
      }),
      ...operationWithFot(ctx, {
        category: 'Собственное производство',
        // Толщина зашита в наименование прайса: 5 мм и 4 мм — две разные
        // позиции НН. У ёмкости и колодца в листах — 4 мм.
        name: `Защитный слой ламинации ${layerMm} мм на теплоизоляцию`,
        unit: 'кг',
        qtyCalc: ins.protectiveLayerKg,
        fotK: FOT_K_LAMIN,
      }),
      makeRow(ctx, {
        kind: 'ОПЕРАЦИЯ',
        category: 'Собственное производство',
        name: 'Монтаж теплоизоляции',
        unit: 'чел. ч',
        qtyCalc: ins.mountingHours,
        note: 'ƒ 1 чел.ч на 1 м²',
      }),
    ],
  }
}

/** Слой ламинации на теплоизоляцию ёмкости и колодца, мм (листы: 0,004·1850). */
const INSULATION_LAYER_MM = 4

// ─── ЕМК: корпус ёмкости ─────────────────────────────────────────────────────

/** Длина транспортного отрезка трубы корпуса, м (лист ЕМК, H22). */
export const TRANSPORT_PIPE_M = 6

/**
 * Труба корпуса ёмкости — общая для обечайки, днищ и шахты: длина, жёсткость
 * и материал. Длина — из объёма либо из ОЛ; у цилиндрических днищ трубы на
 * 1,5 м больше: концы делаются из неё же (эталон I13).
 */
function emkPipe(s: EmkSurveyParams) {
  const geo = computeEmkGeometry(s)
  const lengthMm = geo.pipeLengthMm ?? 0
  const horizontal = s.placement === 'горизонтальное'
  const bottomType: EmkBottomType = s.bottomType ?? 'эллиптические'
  const extraMm = horizontal && bottomType === 'цилиндрические' ? CYLINDRICAL_BOTTOMS_PIPE_MM : 0
  return {
    geo,
    lengthMm,
    horizontal,
    bottomType,
    extraMm,
    lengthM: (lengthMm + extraMm) / 1000,
    sn: s.sn ?? geo.sn ?? 2500,
    // Материал зависит от среды: химстойкая -> СК/ВЭС (эталон D8).
    material: tankMaterial(s.tankType),
  }
}

/**
 * Соединительных муфт трубы горизонтальной ёмкости (лист ЕМК, строка 23):
 * `ROUNDDOWN((L − 1,5) / 6)` — стыки транспортных отрезков по 6 м; L — длина
 * трубы корпуса, м. У вертикальной их нет.
 */
export function emkCouplingCount(s: EmkSurveyParams): number {
  const { lengthMm, horizontal } = emkPipe(s)
  if (!horizontal || lengthMm <= 0) return 0
  return Math.max(0, Math.floor((lengthMm / 1000 - 1.5) / TRANSPORT_PIPE_M))
}

// Раздел 1 ёмкости собирается из встроенных узлов (engines/code-nodes.ts),
// как и корпус КНС: функция — узел, порядок задаёт шаблон изделия.

/** A1 — обечайка корпуса ёмкости и муфты её отрезков. */
export function buildEmkShell(ctx: MaterializeContext, s: EmkSurveyParams): CalcComponent[] {
  const { lengthMm, extraMm, lengthM, sn, material, horizontal } = emkPipe(s)
  const pnPipe = pnForWeightLookup(s.pnSurvey, s.dn, sn)
  const kgPerM = ctx.pipeWeightOf(s.dn, pnPipe, sn)
  const pipeName = `Труба ${material}-К ${s.dn}-${s.pnSurvey.toLocaleString('ru-RU')}-${sn}`
  const couplings = emkCouplingCount(s)
  const fromVolume = horizontal
    ? ` · длина из объёма ${s.volumeM3} м³ за вычетом днищ = ${lengthMm} мм`
    : ` · длина из объёма ${s.volumeM3} м³ = ${lengthMm} мм`

  return [
    {
      id: nextId('c'),
      nodeCode: 'A1',
      title: 'Обечайка корпуса',
      enabled: true,
      rows: [
        {
          ...makeRow(ctx, {
            kind: 'МАТЕРИАЛ',
            category: 'Собственное производство',
            name: pipeName,
            unit: 'м',
            qtyCalc: lengthM,
            bucket: 'Труба, муфта',
            note:
              (kgPerM == null ? `Вес трубы не найден (DN ${s.dn}; PN ${pnPipe}; SN ${sn})` : `${kgPerM} кг/пм`) +
              (s.pipeLengthMm ? ` · длина из ОЛ ${lengthMm} мм` : fromVolume) +
              (extraMm ? ` + ${(extraMm / 1000).toLocaleString('ru-RU')} м на цилиндрические днища из той же трубы` : ''),
          }),
          // Цена трубы договорная — как у КНС (Механика §5.2): её дают полем
          // ОЛ «Цена трубы, ₽/м.п.», связанным с этой строкой.
          priceCatalog: null,
          priceBinding: 'pipePrice',
          priceManual: boundPrice(s.pipePriceRub),
        },
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Придание изделию товарного вида',
          unit: 'чел. ч',
          qtyCalc: marketableAppearanceHours(s.dn, lengthM),
        }),
        // Отрезки трубы горизонтальной ёмкости стыкуются муфтами (строка 23).
        ...(couplings > 0
          ? [couplingRow(ctx, s.dn, couplings, `ƒ ROUNDDOWN((L ${(lengthMm / 1000).toLocaleString('ru-RU')} − 1,5 м) / ${TRANSPORT_PIPE_M} м)`)]
          : []),
        // Вся труба, включая 1,5 м на цилиндрические днища (эталон J13).
        pipePrepRow(ctx, s.dn, lengthM),
      ],
    },
  ]
}

/** A2/A3 — днища: плоское у вертикальной, два эллиптических или цилиндрических у горизонтальной. */
export function buildEmkBottoms(ctx: MaterializeContext, s: EmkSurveyParams): CalcComponent[] {
  const { lengthMm, horizontal, bottomType } = emkPipe(s)
  const jointMass = ctx.jointLayerMassOf?.(s.dn) ?? null
  const components: CalcComponent[] = []

  // A2/A3 — днища. У горизонтальной ёмкости их два, по одному на каждом
  // конце трубы: эллиптические либо цилиндрические (из той же трубы) — по
  // переключателю ОЛ. У вертикальной — плоское.
  //
  // Мс — масса формованных слоёв на стыке по Dу трубы при минимальном PN
  // (jointLayerMassOf): днища крепятся к трубе ламинированием по ней.
  const noJoint = `Мс для Dу ${s.dn} нет в справочнике — введите вручную`
  if (horizontal && bottomType === 'эллиптические') {
    const bucket = matrixLengthBucketMm(lengthMm)
    const cell = ctx.ellipticBottomOf?.(s.dn, lengthMm) ?? null
    components.push({
      id: nextId('c'),
      nodeCode: 'A3',
      title: 'Днища эллиптические ×2',
      slot: 'elliptic',
      enabled: true,
      rows: [
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Механическая формовка эллиптических днищ',
          unit: 'кг',
          qtyCalc: cell ? 2 * cell.massKg : null,
          fotK: FOT_K_MECH,
          note: cell
            ? `ƒ 2 днища × ${cell.massKg} кг — матрица «Формовка эллиптических днищ»: DN ${s.dn}, L до ${(bucket / 1000).toLocaleString('ru-RU')} м` +
              (cell.thicknessMm != null ? `, толщина ${cell.thicknessMm} мм` : '')
            : `DN ${s.dn} нет в матрице «Формовка эллиптических днищ» — массу 2 днищ введите вручную`,
        }),
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ламинирование эллиптического днища к корпусу',
          unit: 'кг',
          qtyCalc: jointMass == null ? null : 2 * jointMass,
          fotK: FOT_K_LAMIN,
          note: jointMass == null ? noJoint : `ƒ 2 стыка × Мс ${jointMass} кг (Dу ${s.dn}, минимальное PN)`,
        }),
      ],
    })
  } else if (horizontal) {
    components.push({
      id: nextId('c'),
      nodeCode: 'A3',
      title: 'Днища цилиндрические ×2',
      slot: 'cylindrical',
      enabled: true,
      rows: [
        // Концы из той же трубы: косые и центральный стыки на каждом. Сама
        // труба на днища — +1,5 м в строке обечайки (эталон I13), здесь —
        // только ламинация стыков. Строка 25 листа «Калькулятор ЕМК».
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ламинация днища (косые и центральный стыки)',
          unit: 'кг',
          qtyCalc: jointMass == null ? null : bottomJointLaminationKg(jointMass),
          fotK: FOT_K_LAMIN,
          note: jointMass == null ? noJoint : `ƒ (Мс/0,707 + Мс/2)·2, Мс ${jointMass} кг (Dу ${s.dn}, минимальное PN)`,
        }),
      ],
    })
  } else {
    // Фальшпол у ёмкости бывает только при насосах и в листе по умолчанию
    // выключен (C72 «Нет»), поэтому пара — без фальшпола: «плоское днище» и
    // «ламинирование плоского днища» (строки 25 и 27 при вертикальной).
    const bottom = bottomMassKg(s.dn)
    components.push({
      id: nextId('c'),
      nodeCode: 'A2',
      title: 'Днище плоское',
      slot: 'flat',
      enabled: true,
      rows: [
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Механическая формовка плоского днища',
          unit: 'кг',
          qtyCalc: bottom,
          fotK: FOT_K_MECH,
          note: `ƒ π·((DN+300)/2000)²·0,01·1850 + … = ${fmt(bottom, 1)} кг`,
        }),
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ламинирование плоского днища',
          unit: 'кг',
          qtyCalc: laminationMassKg(bottom),
          fotK: FOT_K_LAMIN,
          note: 'ƒ масса днища × 3/10',
        }),
      ],
    })
  }

  return components
}

/**
 * A8 — шахты обслуживания, по флагу ОЛ (лист ЕМК, строки 53–59, 80, 83).
 *
 * Шахта — отрезок трубы своего диаметра высотой в шахту, с приданием
 * товарного вида, соединительной муфтой и подготовкой трубы; к корпусу она
 * ламинируется массой Мф по своему диаметру (нормы «Для расчетов» — те же,
 * что у гильз: Ø1200 — 10,3 кг). Всё — на каждую шахту.
 *
 * Прежде вместо ламинирования по норме стояли две пустые строки — «ручная
 * формовка» и «ламинирование шахты»: масса считалась неизвестной
 * (Вопросы_заводу §5), хотя лист берёт её из той же таблицы норм.
 */
export function buildEmkShaft(ctx: MaterializeContext, s: EmkSurveyParams): CalcComponent[] {
  if (!s.hasShaft) return []
  const { geo } = emkPipe(s)
  const d = geo.shaftDiameterMm
  const n = geo.shaftCount
  const pipeM = (geo.shaftHeightMm / 1000) * n
  const norm = ctx.nozzleNormOf?.(d) ?? null
  const lamination = norm ? norm.moldingMassKg * n : null
  const each = n > 1 ? ` × ${n} шахты` : ''

  return [
    {
      id: nextId('c'),
      nodeCode: 'A8',
      title: `Шахта обслуживания Ø${d} h${geo.shaftHeightMm}${n > 1 ? ` ×${n}` : ''}`,
      enabled: true,
      rows: [
        // Цена трубы договорная — как у корпуса (Механика §5.2), но своя: у
        // шахты другой диаметр. Её дают полем ОЛ «Цена трубы» у шахты.
        {
          ...ownPipeRow(
            ctx,
            `Труба СК/НПС-К ${d}-${SERVICE_PIPE_PN}-${SHAFT_PIPE_SN}`,
            pipeM,
            `Ø${d} × h${geo.shaftHeightMm} мм${each} = ${pipeM.toLocaleString('ru-RU')} пм · марка по листу: SN ${SHAFT_PIPE_SN}, PN ${SERVICE_PIPE_PN}`,
          ),
          priceBinding: 'servicePipePrice',
          priceManual: boundPrice(s.servicePipePriceRub),
        },
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Придание изделию товарного вида',
          unit: 'чел. ч',
          qtyCalc: marketableAppearanceHours(d, pipeM),
          note: `ƒ Ø${d}/1300 × ${pipeM.toLocaleString('ru-RU')} м`,
        }),
        couplingRow(ctx, d, n, `ƒ по одной на шахту (${n})`),
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ламинирование шахты обслуживания к корпусу',
          unit: 'кг',
          qtyCalc: lamination,
          fotK: FOT_K_LAMIN,
          note:
            lamination == null
              ? `Мф для Ø${d} в нормах «Для расчетов» нет — введите массу вручную`
              : `ƒ Мф(Ø${d}) ${fmt(norm!.moldingMassKg)} кг${each}`,
        }),
        pipePrepRow(ctx, d, pipeM),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Прорезка отверстия шахты обслуживания',
          unit: 'чел. ч',
          qtyCalc: cutoutHours(d, n),
          note: `ƒ Ø${d}·π/1000 × 0,5 чел.ч${each}`,
        }),
      ],
    },
  ]
}

type NozzlesParams = Pick<
  EmkSurveyParams,
  'inletDn' | 'inletCount' | 'outletDn' | 'outletCount' | 'inletMaterial' | 'outletMaterial'
>

/**
 * Патрубки ёмкости и колодца для общего узла A5 (`buildSleeveNozzles`): прорезка
 * у обоих — «Прорезка отверстия патрубка в корпусе» (лист колодца, строки
 * 80–81; у ёмкости на их месте строки 81–82 умножают на длину трубы шахты —
 * сдвиг при копировании, Вопросы_заводу §6и).
 *
 * Под стеклокомпозитную трубу патрубок стеклопластиковый (уточнения завода
 * 11.09.2026), `joint`: у ёмкости — гильза (до DN 300 включительно
 * формуется, крупнее — отрезок трубы) и фланец, у колодца — муфта вместо
 * гильзы.
 */
function emkKolNozzles(s: NozzlesParams, joint: GrpNozzleJoint): SleeveNozzle[] {
  const cutoutName = 'Прорезка отверстия патрубка в корпусе'
  const nozzle = (
    role: SleeveNozzle['role'],
    title: string,
    dn: number,
    count: number,
    material: PipeMaterial | null | undefined,
  ): SleeveNozzle => ({
    role,
    title,
    dn,
    count,
    cutoutName,
    ...grpNozzleOf(material, joint),
  })
  return [
    nozzle('inlet', 'Патрубок подводящий', s.inletDn, s.inletCount, s.inletMaterial),
    nozzle('outlet', 'Патрубок отводящий', s.outletDn, s.outletCount, s.outletMaterial),
  ]
}

/**
 * A5 — патрубки ёмкости: подводящие и отводящие, каждый со своей гильзой; под
 * стеклокомпозитную трубу — стеклопластиковый патрубок с фланцем.
 */
export function buildEmkNozzles(ctx: MaterializeContext, s: NozzlesParams): CalcComponent[] {
  return buildSleeveNozzles(ctx, emkKolNozzles(s, 'flange'))
}

/** A9 — теплоизоляция ёмкости: шахты и верх, слой 4 мм (лист ЕМК, строки 49–52, 86). */
export function buildEmkInsulation(ctx: MaterializeContext, s: EmkSurveyParams): CalcComponent[] {
  const geo = computeEmkGeometry(s)
  const shafts = { count: geo.shaftCount, diameterMm: geo.shaftDiameterMm }
  const ins = emkInsulation(s.dn, s.insulationDepthMm, shafts, INSULATION_LAYER_MM / 1000)
  const side =
    shafts.count > 0
      ? `ƒ шахты π·${fmt(shafts.diameterMm / 1000)}·h${shafts.count > 1 ? ` × ${shafts.count}` : ''}`
      : 'ƒ корпус π·(DN/1000)·h'
  return [buildInsulation(ctx, ins, s.insulationEnabled, INSULATION_LAYER_MM, `${side} + верх π·(DN/2000)²`)]
}

// ─── ЕМК: люки, крепление, оборудование ──────────────────────────────────────

/** Люки ёмкости: по одному на шахту; без шахты — один типовой. */
export function emkHatches(s: EmkSurveyParams): { count: number; diameterMm: number; coverMassKg: number } {
  const geo = computeEmkGeometry(s)
  const d = geo.shaftCount > 0 ? geo.shaftDiameterMm : TYPICAL_HATCH_MM
  return { count: Math.max(1, geo.shaftCount), diameterMm: d, coverMassKg: neckCoverMassKg(d) }
}

/** Фурнитура люка — дословно из прайса. */
export const HATCH_ITEMS = {
  handle: { category: 'Прочие материалы', name: 'Ручка складная оцинкованная', unit: 'шт' },
  lock: { category: 'Прочие материалы', name: 'Замок натяжной АРТ 8427 А2 115-125', unit: 'шт' },
  limitSwitch: { category: 'Прочие материалы', name: 'Концевой выключатель KZ 81-08', unit: 'шт' },
} as const

/**
 * Люки шахт ёмкости и горловины колодца (B2): стеклокомпозитная крышка, её
 * ламинирование, фурнитура и монтаж — лист ЕМК, строки 139–147 и 182–183;
 * лист колодца — 138–144 и 179.
 *
 * Состав люка в листах задан на люк: у ёмкости 2 ручки, замок и концевой
 * выключатель, у колодца 1 ручка; монтаж — 0,5 чел.ч на ручку и на замок с
 * выключателем. Масса крышки в листах вписана числом, здесь — по площади
 * люка (`neckCoverMassKg`).
 */
export function buildHatches(
  ctx: MaterializeContext,
  h: {
    count: number
    diameterMm: number
    handlesPerHatch: number
    lockAndSwitch: boolean
    title: string
    /** Роль — ключ узла: люк шахты, горловины и перекрытия — разные узлы. */
    role: 'shaft' | 'neck' | 'top'
  },
): CalcComponent[] {
  if (h.count <= 0) return []
  const cover = neckCoverMassKg(h.diameterMm)
  const mass = cover * h.count
  const handles = h.handlesPerHatch * h.count
  const hatchesNote = h.count > 1 ? ` × ${h.count} люка` : ''

  return [
    {
      id: nextId('c'),
      nodeCode: 'B2',
      title: `${h.title} Ø${h.diameterMm}${h.count > 1 ? ` ×${h.count}` : ''}`,
      slot: h.role,
      enabled: true,
      rows: [
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Механическая формовка стеклокомпозитной крышки',
          unit: 'кг',
          qtyCalc: mass,
          fotK: FOT_K_MECH,
          note: `ƒ π·(Ø${h.diameterMm}/2000)²·0,006·1850 = ${fmt(cover, 1)} кг${hatchesNote}`,
        }),
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ламинирование стеклокомпозитной крышки',
          unit: 'кг',
          qtyCalc: laminationMassKg(mass),
          fotK: FOT_K_LAMIN,
          note: 'ƒ масса крышек × 3/10',
        }),
        makeRow(ctx, { kind: 'МАТЕРИАЛ', ...HATCH_ITEMS.handle, qtyCalc: handles, note: `ƒ ${h.handlesPerHatch} на люк${hatchesNote}` }),
        ...(h.lockAndSwitch
          ? [
              makeRow(ctx, { kind: 'МАТЕРИАЛ', ...HATCH_ITEMS.lock, qtyCalc: h.count, note: 'ƒ один на люк' }),
              makeRow(ctx, { kind: 'МАТЕРИАЛ', ...HATCH_ITEMS.limitSwitch, qtyCalc: h.count, note: 'ƒ один на люк' }),
            ]
          : []),
        work(ctx, 'Монтаж складных ручек на болтах М6', 0.5 * handles, 'ƒ 0,5 чел.ч на ручку'),
        ...(h.lockAndSwitch
          ? [work(ctx, 'Монтаж замка натяжного, петли и концевого выключателя', 0.5 * 2 * h.count, 'ƒ 0,5 чел.ч на замок и на выключатель')]
          : []),
      ],
    },
  ]
}

/** B2 — люки шахт ёмкости: крышка, 2 ручки, замок и концевой выключатель на люк. */
export function buildEmkHatches(ctx: MaterializeContext, s: EmkSurveyParams): CalcComponent[] {
  const h = emkHatches(s)
  return buildHatches(ctx, {
    count: h.count,
    diameterMm: h.diameterMm,
    handlesPerHatch: 2,
    lockAndSwitch: true,
    title: s.hasShaft ? 'Люк шахты' : 'Люк',
    role: s.hasShaft ? 'shaft' : 'top',
  })
}

/** Крепление горизонтальной ёмкости к бетонному основанию — дословно из прайса. */
export const STRAPPING_ITEMS = {
  strap: {
    category: 'Грузоподъем',
    name: 'Ремень стяжной с натяжным устройством и крюками на концах (Прочность на разрыв 10тонн, Длина ремня 10 метров, Ширина 50мм)',
    unit: 'шт',
  },
  // Наименование в прайсе обрезано на «М2» — так оно и в листе завода.
  anchor: { category: 'Метизы', name: 'Анкерный болт с гайкой SZ-B MKT М20х165/30 высокой прочности (резьбовая часть М2', unit: 'шт' },
  eyeNut: { category: 'Метизы', name: 'Рым-гайка М20 DIN 582 оцинкованная', unit: 'шт' },
} as const

/**
 * B6 — крепление горизонтальной ёмкости к бетонному основанию стяжными
 * ремнями (лист ЕМК, строки 173–176 и 201): ремень на каждый метр трубы
 * корпуса, вверх до целого, по два анкерных болта SZ-B на ремень, по две
 * рым-гайки на анкер; монтаж — 0,5 чел.ч на ремень. У вертикальной ёмкости
 * лист ремней не ставит (`IF(Вертикальное; 0; …)`).
 *
 * Прежде горизонтальная ёмкость получала анкеры против всплытия, как
 * вертикальная, — по «глубине», равной длине корпуса: 48 анкеров 20×200 на
 * образце, которых в листе ёмкости нет вовсе.
 */
export function buildEmkStrapping(ctx: MaterializeContext, s: EmkSurveyParams): CalcComponent[] {
  if (s.placement !== 'горизонтальное') return []
  const { lengthMm } = emkPipe(s)
  if (lengthMm <= 0) return []
  const straps = Math.ceil(lengthMm / 1000)
  const anchors = 2 * straps
  const eyeNuts = 2 * anchors

  return [
    {
      id: nextId('c'),
      nodeCode: 'B6',
      title: 'Крепление к бетонному основанию ремнями',
      enabled: true,
      rows: [
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          ...STRAPPING_ITEMS.strap,
          qtyCalc: straps,
          note: `ƒ ROUNDUP(L ${(lengthMm / 1000).toLocaleString('ru-RU')} м) — ремень на каждый метр трубы`,
        }),
        makeRow(ctx, { kind: 'МАТЕРИАЛ', ...STRAPPING_ITEMS.anchor, qtyCalc: anchors, note: 'ƒ 2 на ремень' }),
        makeRow(ctx, { kind: 'МАТЕРИАЛ', ...STRAPPING_ITEMS.eyeNut, qtyCalc: eyeNuts, note: 'ƒ 2 на анкерный болт' }),
        work(ctx, 'Монтаж емкости к бетонному основанию ремнями стяжными', 0.5 * straps, 'ƒ 0,5 чел.ч на ремень'),
      ],
    },
  ]
}

/**
 * Высота ёмкости для оборудования, м: длина кабеля поплавков и датчиков,
 * футляр датчика уровня, высота подъёма тали — высота лестницы (лист ЕМК,
 * I114: футляр датчика уровня идёт на неё же, строка 271).
 */
export function emkEquipmentHeightM(s: EmkSurveyParams): number {
  return emkLadderHeightMm(s, computeEmkGeometry(s)) / 1000
}

/**
 * C4 — задвижка на подводящем ёмкости (лист ЕМК, строки 260 и 276):
 * шиберная со штоком до поверхности, по одной на подводящий, по ответу ОЛ.
 *
 * Длина штока — как у КНС: глубина лотка минус половина DN. В листе ёмкости
 * стоит `длина лестницы − лоток/2` (на образце 3800 мм вместо 2200) —
 * Вопросы_заводу §6и. Задвижки и клапаны напорной стороны лист вписывает
 * руками (DN напорной линии в ОЛ ёмкости нет) — их узел не строит.
 */
export function buildEmkValves(ctx: MaterializeContext, s: EmkSurveyParams): CalcComponent[] {
  if (s.inletCount <= 0) return []
  return [
    {
      id: nextId('c'),
      nodeCode: 'C4',
      title: 'Задвижка на подводящем',
      ...surveyToggled(Boolean(s.valveOnInlet)),
      rows: [
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Запорная арматура',
          name: inletGateValveName(s.inletDn, s.inletTrayDepthMm),
          unit: 'шт',
          qtyCalc: s.inletCount,
          note:
            `ƒ по одной на подводящий (${s.inletCount}) · цена под длину штока — введите` +
            (s.inletTrayDepthMm
              ? ` · шток = лоток ${s.inletTrayDepthMm} − DN/2`
              : ' · длина штока = глубина лотка − DN/2: укажите в ОЛ глубину лотка подводящего'),
        }),
        work(ctx, STATION_WORKS.knifeGateMount, s.inletCount, 'ƒ 1 чел.ч на задвижку'),
      ],
    },
  ]
}

/**
 * D1 — насосы ёмкости (лист ЕМК, строки 263–265 и 279–281): насосы, по
 * автоматической трубной муфте на насос, поплавки «раб + рез + 2»; монтаж —
 * 2 чел.ч на насос, 3 на муфту, 1 на поплавок. Только при насосах.
 *
 * Цена насоса — позиция прайса «Насос {марка}»; своего поля цены в ОЛ ёмкости
 * нет, поэтому строка с ним не связана (у КНС связана).
 */
export function buildEmkPumps(ctx: MaterializeContext, s: EmkSurveyParams): CalcComponent[] {
  if (!s.hasPumps) return []
  const pumps = s.pumpsWorking + s.pumpsReserve
  const W = STATION_WORKS
  const floats = floatSwitchCount(s.pumpsWorking, s.pumpsReserve)
  const model = s.pumpModel?.trim() || null

  return [
    {
      id: nextId('c'),
      nodeCode: 'D1',
      title: 'Насосная группа',
      enabled: true,
      rows: [
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: PUMP_PRICE_CATEGORY,
          name: pumpRowName(model),
          unit: 'шт',
          qtyCalc: pumps,
          note: `ƒ = раб ${s.pumpsWorking} + рез ${s.pumpsReserve}` + (model ? '' : ' · марка не указана — уточните в опросном листе'),
        }),
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: PUMP_PRICE_CATEGORY,
          name: 'Автоматическая трубная муфта',
          unit: 'шт',
          qtyCalc: pumps,
          note: `ƒ по одной на насос (${pumps}) · цена по предложению поставщика насосов`,
        }),
        floatSwitchRow(ctx, floats, emkEquipmentHeightM(s), 'ƒ = раб + рез + 2'),
        work(ctx, W.pumpsMount, 2 * pumps, `ƒ 2 чел.ч на насос (${pumps})`),
        work(ctx, W.couplingMount, 3 * pumps, `ƒ 3 чел.ч на муфту (${pumps})`),
        work(ctx, W.floatsMount, floats, 'ƒ 1 чел.ч — 1 выключатель'),
      ],
    },
  ]
}

/**
 * D2 — шкаф управления и датчики ёмкости (лист ЕМК, строки 266–271 и
 * 282–284): шкаф и погружной датчик уровня с футляром — по ответам ОЛ.
 * Датчиков давления и расходомера в ОЛ ёмкости нет — их узлы собираются
 * выключенными, включаются в расчёте.
 */
export function buildEmkAutomation(ctx: MaterializeContext, s: EmkSurveyParams): CalcComponent[] {
  const heightM = emkEquipmentHeightM(s)
  return buildAutomation(ctx, {
    heightM,
    depthM: heightM,
    outletDn: s.outletDn,
    outletCount: s.outletCount,
    pumps: s.hasPumps ? s.pumpsWorking + s.pumpsReserve : 0,
    controlCabinet: Boolean(s.hasControlCabinet),
    pressureSensors: false,
    levelSensor: Boolean(s.hasLevelSensor),
    flowMeter: false,
  })
}

/** D5 — тренога, таль по высоте ёмкости и газоанализатор: в листе по одному всегда (строки 269, 272–273). */
export function buildEmkService(ctx: MaterializeContext, s: EmkSurveyParams): CalcComponent[] {
  return [buildServiceEquipment(ctx, { heightM: emkEquipmentHeightM(s) })]
}

// ─── КОЛ: корпус колодца ─────────────────────────────────────────────────────

/** Труба корпуса колодца: рабочая часть (с горловиной) или с возвышением (без неё). */
function kolPipe(s: KolSurveyParams) {
  const geo = computeKolGeometry(s)
  return { geo, lengthM: geo.shellLengthMm / 1000, sn: s.sn ?? geo.sn ?? 2500 }
}

/** A1 — обечайка корпуса колодца. */
export function buildKolShell(ctx: MaterializeContext, s: KolSurveyParams): CalcComponent[] {
  const { geo, lengthM, sn } = kolPipe(s)
  const pnPipe = pnForWeightLookup(s.pnSurvey, s.dn, sn)
  const kgPerM = ctx.pipeWeightOf(s.dn, pnPipe, sn)
  const pipeName = `Труба СК/НПС-К ${s.dn}-${s.pnSurvey.toLocaleString('ru-RU')}-${sn}`

  return [
    {
      id: nextId('c'),
      nodeCode: 'A1',
      title: 'Обечайка корпуса',
      enabled: true,
      rows: [
        {
          ...makeRow(ctx, {
            kind: 'МАТЕРИАЛ',
            category: 'Собственное производство',
            name: pipeName,
            unit: 'м',
            qtyCalc: lengthM,
            bucket: 'Труба, муфта',
            note:
              (kgPerM == null ? `Вес трубы не найден (DN ${s.dn}; PN ${pnPipe}; SN ${sn})` : `${kgPerM} кг/пм`) +
              (s.hasNeck
                ? ` · рабочая часть ${geo.shellLengthMm} мм — горловина своей трубой`
                : ` · рабочая часть ${s.workingDepthMm} + возвышение ${s.elevationMm} = ${geo.shellLengthMm} мм`),
          }),
          // Цена договорная — поле ОЛ «Цена трубы, ₽/м.п.», связанное со строкой.
          priceCatalog: null,
          priceBinding: 'pipePrice',
          priceManual: boundPrice(s.pipePriceRub),
        },
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Придание изделию товарного вида',
          unit: 'чел. ч',
          qtyCalc: marketableAppearanceHours(s.dn, lengthM),
        }),
        pipePrepRow(ctx, s.dn, lengthM),
      ],
    },
  ]
}

/**
 * A2 — днище колодца и его ламинирование. Лист колодца по умолчанию — с
 * фальшполом (C43 «Да»): «механическое формованное дно» и «ламинирование дна
 * к фальшполу» (строки 21 и 23). Масса — та же, что у КНС.
 */
export function buildKolBottom(ctx: MaterializeContext, s: Pick<KolSurveyParams, 'dn'>): CalcComponent[] {
  const bottom = bottomMassKg(s.dn)

  return [
    {
      id: nextId('c'),
      nodeCode: 'A2',
      title: 'Днище',
      enabled: true,
      rows: [
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Механическое формованное дно',
          unit: 'кг',
          qtyCalc: bottom,
          fotK: FOT_K_MECH,
          note: `ƒ геометрия DN${s.dn} = ${fmt(bottom, 1)} кг`,
        }),
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ламинирование дна к фальшполу',
          unit: 'кг',
          qtyCalc: laminationMassKg(bottom),
          fotK: FOT_K_LAMIN,
          note: 'ƒ масса днища × 3/10',
        }),
      ],
    },
  ]
}

/**
 * A8 — горловина, по флагу ОЛ (лист колодца, строки 36–41, 79, 82).
 *
 * Горловина — отрезок трубы своего диаметра высотой в горловину с
 * возвышением (N5), с приданием товарного вида, соединительной муфтой и
 * подготовкой трубы; к корпусу она ламинируется массой Мф по своему
 * диаметру (нормы «Для расчетов»).
 *
 * Прежде здесь стояли «механическая формовка горловины» по площади и её
 * ламинирование 3/10 — это крышка люка, в листе она в разделе 4 (узел
 * «Люк горловины»).
 */
export function buildKolNeck(ctx: MaterializeContext, s: KolSurveyParams): CalcComponent[] {
  if (!s.hasNeck) return []
  const geo = computeKolGeometry(s)
  const d = s.neckDiameterMm
  const pipeM = geo.neckHeightMm / 1000
  const norm = ctx.nozzleNormOf?.(d) ?? null
  const lamination = norm ? norm.moldingMassKg : null

  return [
    {
      id: nextId('c'),
      nodeCode: 'A8',
      title: `Горловина Ø${d} h${s.neckHeightMm}`,
      enabled: true,
      rows: [
        // Цена договорная и своя — поле ОЛ «Цена трубы» у горловины.
        {
          ...ownPipeRow(
            ctx,
            `Труба СК/НПС-К ${d}-${SERVICE_PIPE_PN}-${NECK_PIPE_SN}`,
            pipeM,
            `Ø${d} × (h${s.neckHeightMm} + возвышение ${s.elevationMm}) мм = ${pipeM.toLocaleString('ru-RU')} пм · марка по листу: SN ${NECK_PIPE_SN}, PN ${SERVICE_PIPE_PN}`,
          ),
          priceBinding: 'servicePipePrice',
          priceManual: boundPrice(s.servicePipePriceRub),
        },
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Придание изделию товарного вида',
          unit: 'чел. ч',
          qtyCalc: marketableAppearanceHours(d, pipeM),
          note: `ƒ Ø${d}/1300 × ${pipeM.toLocaleString('ru-RU')} м`,
        }),
        couplingRow(ctx, d, 1, 'ƒ одна на горловину'),
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ламинирование горловины к корпусу емкости',
          unit: 'кг',
          qtyCalc: lamination,
          fotK: FOT_K_LAMIN,
          note: lamination == null ? `Мф для Ø${d} в нормах «Для расчетов» нет — введите массу вручную` : `ƒ Мф(Ø${d}) = ${fmt(lamination)} кг`,
        }),
        pipePrepRow(ctx, d, pipeM),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Прорезка отверстия для горловины обслуживания',
          unit: 'чел. ч',
          qtyCalc: cutoutHours(d, 1),
          note: `ƒ Ø${d}·π/1000 × 0,5 чел.ч`,
        }),
      ],
    },
  ]
}

/**
 * A5 — патрубки колодца: подводящие и отводящие, каждый со своей гильзой; под
 * стеклокомпозитную трубу вместо гильзы — муфта «Муфта-2».
 */
export function buildKolNozzles(ctx: MaterializeContext, s: NozzlesParams): CalcComponent[] {
  return buildSleeveNozzles(ctx, emkKolNozzles(s, 'coupling'))
}

/**
 * A9 — теплоизоляция колодца: корпус `π·DN·h` и верх, слой 4 мм.
 *
 * В листе колодца (строка 51) боковая площадь — `π·(DN/2000)²·h`, то есть
 * площадь круга, умноженная на высоту; у КНС та же площадь — `π·DN·h`. Здесь
 * — как у КНС, расхождение в Вопросах заводу §6и.
 */
export function buildKolInsulation(
  ctx: MaterializeContext,
  s: Pick<KolSurveyParams, 'dn' | 'insulationDepthMm' | 'insulationEnabled'>,
): CalcComponent[] {
  const ins = insulation(s.dn, s.insulationDepthMm, { protectiveThickness: INSULATION_LAYER_MM / 1000 })
  return [buildInsulation(ctx, ins, s.insulationEnabled, INSULATION_LAYER_MM, 'ƒ π·(DN/1000)·h + π·(DN/2000)²')]
}

/** Люк колодца: на горловине её диаметра, без горловины — типовой в перекрытии. */
export function kolHatch(s: KolSurveyParams): { count: number; diameterMm: number; coverMassKg: number } {
  const d = s.hasNeck && s.neckDiameterMm > 0 ? s.neckDiameterMm : TYPICAL_HATCH_MM
  return { count: 1, diameterMm: d, coverMassKg: neckCoverMassKg(d) }
}

/** B2 — люк колодца: крышка и одна ручка (лист колодца, строки 138–144, 179). */
export function buildKolHatches(ctx: MaterializeContext, s: KolSurveyParams): CalcComponent[] {
  const h = kolHatch(s)
  return buildHatches(ctx, {
    count: h.count,
    diameterMm: h.diameterMm,
    handlesPerHatch: 1,
    lockAndSwitch: false,
    title: s.hasNeck ? 'Люк горловины' : 'Люк',
    role: s.hasNeck ? 'neck' : 'top',
  })
}

// ─── Геометрия узлов ─────────────────────────────────────────────────────────

/**
 * Высота лестницы ёмкости, мм (эталон I114 листа «Калькулятор ЕМК»).
 *
 * У вертикальной — во всю высоту корпуса. У горизонтальной лестница ведёт
 * через шахту на дно: диаметр корпуса плюс высота шахты. Раньше и для
 * горизонтальной бралась длина корпуса — у ёмкости 50 м³ это 17,5 м лестницы
 * вместо 4,3 м.
 */
export function emkLadderHeightMm(survey: Pick<EmkSurveyParams, 'placement' | 'dn'>, geo: EmkGeometry): number {
  return survey.placement === 'горизонтальное' ? survey.dn + geo.shaftHeightMm : (geo.overallLengthMm ?? 0)
}
