/**
 * Шаблоны изделий ЕМК (ёмкость) и КОЛ (колодец).
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
 * Общие узлы (лестница, перекрытие, вентстояк, крепёж) переиспользуются из
 * шаблона КНС — формулы этих компонентов побайтово совпадают во всех трёх
 * калькуляторах (Библиотека, основание).
 */

import { bottomMassKg, cutoutHours, insulation, laminationMassKg, marketableAppearanceHours } from './formulas'
import { FOT_K_LAMIN, FOT_K_MANUAL, FOT_K_MECH } from './fot'
import {
  buildFasteners,
  buildLadder,
  buildPressurePipe,
  buildSlab,
  buildVent,
  makeRow,
  nextId,
  operationWithFot,
  type CalcComponent,
  type CalcSection,
  type CalcTree,
  type MaterializeContext,
} from './template-kns'
import {
  computeEmkGeometry,
  computeKolGeometry,
  neckCoverMassKg,
  tankMaterial,
  type Installation,
  type Placement,
  type TankType,
} from './survey-emk-kol'
import { pnForWeightLookup, sleeveDiameter } from './survey-kns'

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

  hasShaft: boolean

  inletDn: number
  inletCount: number
  outletDn: number
  outletCount: number

  /** Насосное оборудование (при «да» появляется напорный трубопровод). */
  hasPumps: boolean
  pumpsWorking: number
  pumpsReserve: number

  hasBasket: boolean
  insulationEnabled: boolean
  insulationDepthMm: number

  tirage?: number
}

export interface KolSurveyParams {
  dn: number
  /** Глубина рабочей части, мм. */
  workingDepthMm: number
  elevationMm: number
  pnSurvey: number

  hasNeck: boolean
  neckHeightMm: number
  neckDiameterMm: number

  inletDn: number
  inletCount: number
  outletDn: number
  outletCount: number

  hasBasket: boolean
  underRoadway: boolean
  insulationEnabled: boolean
  insulationDepthMm: number

  tirage?: number
}

// ─── Общий узел: корзина сороудерживающая (Библиотека D3) ───────────────────

function buildBasket(ctx: MaterializeContext, enabled: boolean): CalcComponent[] {
  return [
    {
      id: nextId('c'),
      nodeCode: 'D3',
      title: 'Корзина сороудерживающая',
      // Выключенный узел не удаляется: строки остаются «призраками»
      // (Механика §7.2), включение восстанавливает всё.
      enabled,
      rows: [
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Изготовление Сороудерживающей корзины',
          unit: 'чел. ч',
          qtyCalc: 8,
          note: 'ƒ норматив 8 чел.ч · уточните',
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Монтаж Сороудерживающей корзины',
          unit: 'чел. ч',
          qtyCalc: 4,
          note: 'ƒ норматив 4 чел.ч · уточните',
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Изготовление направляющих корзины',
          unit: 'чел. ч',
          qtyCalc: 4,
          note: 'ƒ норматив 4 чел.ч · уточните',
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Монтаж направляющих корзины',
          unit: 'чел. ч',
          qtyCalc: 2,
          note: 'ƒ норматив 2 чел.ч · уточните',
        }),
      ],
    },
  ]
}

/** Патрубки с гильзами — общий узел A5 для ёмкости и колодца. */
function buildNozzles(
  ctx: MaterializeContext,
  nozzles: Array<{ title: string; dn: number; count: number; cutoutName: string }>,
): CalcComponent[] {
  const out: CalcComponent[] = []
  for (const n of nozzles) {
    if (n.count <= 0) continue
    const sleeve = sleeveDiameter(n.dn)
    const norm = ctx.nozzleNormOf?.(sleeve) ?? null
    const mass = norm ? norm.moldingMassKg * n.count : null

    out.push({
      id: nextId('c'),
      nodeCode: 'A5',
      title: `${n.title} DN${n.dn} ×${n.count}`,
      enabled: true,
      rows: [
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Формовка гильз',
          unit: 'кг',
          qtyCalc: mass,
          fotK: FOT_K_MANUAL,
          note:
            mass == null
              ? `Гильза Ø${sleeve} мм ×${n.count} · нормы формовки для Ø${sleeve} нет — введите массу вручную`
              : `ƒ Мф(Ø${sleeve}) × ${n.count} = ${mass.toFixed(2)} кг`,
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: n.cutoutName,
          unit: 'чел. ч',
          qtyCalc: cutoutHours(sleeve, n.count),
          note: `ƒ Ø${sleeve}·π/1000 × 0,5 чел.ч × ${n.count}`,
        }),
      ],
    })
  }
  return out
}

/** Теплоизоляция — общий узел A9; толщина защитного слоя зависит от изделия. */
function buildInsulation(
  ctx: MaterializeContext,
  dn: number,
  depthMm: number,
  enabled: boolean,
  layerMm: number,
): CalcComponent {
  const ins = insulation(dn, depthMm, { protectiveThickness: layerMm / 1000 })

  return {
    id: nextId('c'),
    nodeCode: 'A9',
    title: 'Теплоизоляция корпуса',
    enabled,
    rows: [
      makeRow(ctx, {
        kind: 'МАТЕРИАЛ',
        category: 'Прочие материалы',
        name: 'Теплоизоляция - Изофом ППЭ ОР 15 1,5х40',
        unit: 'м²',
        qtyCalc: ins.totalM2,
        note: `ƒ π·(DN/1000)·h + π·(DN/2000)² = ${ins.totalM2.toFixed(1)} м²`,
      }),
      ...operationWithFot(ctx, {
        category: 'Собственное производство',
        // Толщина зашита в наименование прайса: у КНС/ЕМК 5 мм, у колодца 4 мм
        // (Реверс §4.3) — это две разные позиции НН.
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

// ─── ЕМК: корпус ёмкости ─────────────────────────────────────────────────────

function buildEmkKorpus(ctx: MaterializeContext, s: EmkSurveyParams): CalcComponent[] {
  const geo = computeEmkGeometry(s)
  const lengthMm = geo.pipeLengthMm ?? 0
  const lengthM = lengthMm / 1000
  const sn = geo.sn ?? 2500

  const pnPipe = pnForWeightLookup(s.pnSurvey, s.dn, sn)
  const kgPerM = ctx.pipeWeightOf(s.dn, pnPipe, sn)
  // Материал зависит от среды: химстойкая -> СК/ВЭС (эталон D8).
  const material = tankMaterial(s.tankType)
  const pipeName = `Труба ${material}-К ${s.dn}-${s.pnSurvey.toLocaleString('ru-RU')}-${sn}`

  const components: CalcComponent[] = [
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
              kgPerM == null
                ? `Вес трубы не найден (DN ${s.dn}; PN ${pnPipe}; SN ${sn}) · длина = CEILING(4V/(π·D²)) = ${lengthMm} мм`
                : `${kgPerM} кг/пм · длина из объёма ${s.volumeM3} м³ = ${lengthMm} мм`,
          }),
          // Цена трубы договорная — как у КНС (Механика §5.2).
          priceCatalog: null,
        },
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Придание изделию товарного вида',
          unit: 'чел. ч',
          qtyCalc: marketableAppearanceHours(s.dn, lengthM),
        }),
      ],
    },
  ]

  // A2/A3 — днище: у горизонтальной ёмкости эллиптические, у вертикальной плоское.
  if (s.placement === 'горизонтальное') {
    components.push({
      id: nextId('c'),
      nodeCode: 'A3',
      title: 'Днища эллиптические ×2',
      enabled: true,
      rows: [
        // Масса эллиптических днищ — из матрицы «Для расчетов» (f(Dн, L));
        // сюда она не выведена, поэтому количество вводится вручную, а не
        // выдумывается.
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Механическая формовка эллиптических днищ',
          unit: 'кг',
          qtyCalc: null,
          fotK: FOT_K_MECH,
          note: `Масса — из матрицы «Для расчетов» f(Dн ${s.dn}, L ${lengthMm}) · объём 2 днищ ${geo.ellipticVolumeM3?.toFixed(2)} м³ · введите вручную`,
        }),
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ламинация днища (косые и центральный стыки)',
          unit: 'кг',
          qtyCalc: null,
          fotK: FOT_K_LAMIN,
          note: 'Зависит от массы днищ — введите после неё',
        }),
      ],
    })
  } else {
    const bottom = bottomMassKg(s.dn)
    components.push({
      id: nextId('c'),
      nodeCode: 'A2',
      title: 'Днище плоское',
      enabled: true,
      rows: [
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Механическая формовка плоского днища',
          unit: 'кг',
          qtyCalc: bottom,
          fotK: FOT_K_MECH,
          note: `ƒ π·((DN+300)/2000)²·0,01·1850 + … = ${bottom.toFixed(1)} кг`,
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
    })
  }

  // Шахта обслуживания — только при флаге ОЛ.
  if (s.hasShaft) {
    components.push({
      id: nextId('c'),
      nodeCode: 'A8',
      title: `Шахта обслуживания Ø${geo.shaftDiameterMm} h${geo.shaftHeightMm}`,
      enabled: true,
      rows: [
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ручная формовка шахты обслуживания к корпусу',
          unit: 'кг',
          qtyCalc: null,
          fotK: FOT_K_MANUAL,
          note: `Ø${geo.shaftDiameterMm} × h${geo.shaftHeightMm} мм · массу введите вручную`,
        }),
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ламинирование шахты обслуживания к корпусу',
          unit: 'кг',
          qtyCalc: null,
          fotK: FOT_K_LAMIN,
          note: 'Зависит от массы шахты',
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Прорезка отверстия шахты обслуживания',
          unit: 'чел. ч',
          qtyCalc: cutoutHours(geo.shaftDiameterMm, 1),
          note: `ƒ Ø${geo.shaftDiameterMm}·π/1000 × 0,5 чел.ч`,
        }),
      ],
    })
  }

  components.push(
    ...buildNozzles(ctx, [
      { title: 'Патрубок подводящий', dn: s.inletDn, count: s.inletCount, cutoutName: 'Прорезка отверстия под гильзу входящего патрубка' },
      { title: 'Патрубок отводящий', dn: s.outletDn, count: s.outletCount, cutoutName: 'Прорезка отверстия под гильзу напорного патрубка (ов)' },
    ]),
  )

  components.push(buildInsulation(ctx, s.dn, s.insulationDepthMm, s.insulationEnabled, 5))

  return components
}

// ─── КОЛ: корпус колодца ─────────────────────────────────────────────────────

function buildKolKorpus(ctx: MaterializeContext, s: KolSurveyParams): CalcComponent[] {
  const geo = computeKolGeometry(s)
  const lengthM = geo.totalDepthMm / 1000
  const sn = geo.sn ?? 2500

  const pnPipe = pnForWeightLookup(s.pnSurvey, s.dn, sn)
  const kgPerM = ctx.pipeWeightOf(s.dn, pnPipe, sn)
  const pipeName = `Труба СК/НПС-К ${s.dn}-${s.pnSurvey.toLocaleString('ru-RU')}-${sn}`
  const bottom = bottomMassKg(s.dn)

  const components: CalcComponent[] = [
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
              kgPerM == null
                ? `Вес трубы не найден (DN ${s.dn}; PN ${pnPipe}; SN ${sn})`
                : `${kgPerM} кг/пм · глубина ${geo.totalDepthMm} мм${s.hasNeck ? ' (с горловиной)' : ''}`,
          }),
          priceCatalog: null,
        },
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Придание изделию товарного вида',
          unit: 'чел. ч',
          qtyCalc: marketableAppearanceHours(s.dn, lengthM),
        }),
      ],
    },
    {
      id: nextId('c'),
      nodeCode: 'A2',
      title: 'Днище',
      enabled: true,
      rows: [
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Механическая формовка плоского днища',
          unit: 'кг',
          qtyCalc: bottom,
          fotK: FOT_K_MECH,
          note: `ƒ геометрия DN${s.dn} = ${bottom.toFixed(1)} кг`,
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

  // A8 — Горловина: включается флагом ОЛ (Механика §7.2).
  if (s.hasNeck) {
    const coverMass = neckCoverMassKg(s.neckDiameterMm)
    components.push({
      id: nextId('c'),
      nodeCode: 'A8',
      title: `Горловина Ø${s.neckDiameterMm} h${s.neckHeightMm}`,
      enabled: true,
      rows: [
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Механическая формовка горловины к корпусу',
          unit: 'кг',
          qtyCalc: coverMass,
          fotK: FOT_K_MECH,
          note: `ƒ π·(Ø${s.neckDiameterMm}/2000)²·0,006·1850 = ${coverMass.toFixed(1)} кг`,
        }),
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ламинирование горловины к корпусу емкости',
          unit: 'кг',
          qtyCalc: laminationMassKg(coverMass),
          fotK: FOT_K_LAMIN,
          note: 'ƒ масса горловины × 3/10',
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Прорезка отверстия для горловины обслуживания',
          unit: 'чел. ч',
          qtyCalc: cutoutHours(s.neckDiameterMm, 1),
          note: `ƒ Ø${s.neckDiameterMm}·π/1000 × 0,5 чел.ч`,
        }),
      ],
    })
  }

  components.push(
    ...buildNozzles(ctx, [
      { title: 'Патрубок подводящий', dn: s.inletDn, count: s.inletCount, cutoutName: 'Прорезка отверстия под гильзу входящего патрубка' },
      { title: 'Патрубок отводящий', dn: s.outletDn, count: s.outletCount, cutoutName: 'Прорезка отверстия под гильзу напорного патрубка (ов)' },
    ]),
  )

  // У колодца защитный слой ламинации 4 мм, а не 5 (Реверс §4.3).
  components.push(buildInsulation(ctx, s.dn, s.insulationDepthMm, s.insulationEnabled, 4))

  return components
}

// ─── Материализация ──────────────────────────────────────────────────────────

function assemble(
  sections: ReadonlyArray<{ code: string; title: string }>,
  byCode: Record<string, CalcComponent[]>,
): CalcSection[] {
  return sections.map((s) => ({
    id: nextId('s'),
    code: s.code,
    title: s.title,
    enabled: true,
    components: byCode[s.code] ?? [],
  }))
}

/** «Создать расчёт» из ОЛ ёмкости. */
export function materializeEmk(ctx: MaterializeContext, survey: EmkSurveyParams): CalcTree {
  const geo = computeEmkGeometry(survey)
  const depthMm = geo.overallLengthMm ?? 0

  const byCode: Record<string, CalcComponent[]> = {
    '1': buildEmkKorpus(ctx, survey),
    '2': buildBasket(ctx, survey.hasBasket),
    '3': buildLadder(ctx, { depthMm }),
    '4': buildSlab(ctx, { dn: survey.dn, depthMm }),
    '5': buildVent(ctx),
    // Напорный трубопровод — ТОЛЬКО при насосном оборудовании (Реверс §5:
    // «есть разделы "Напорный трубопровод" и "Насосное оборудование", когда
    // ёмкость с насосами»). Без насосов раздел остаётся пустым каркасом.
    '6': survey.hasPumps
      ? buildPressurePipe(ctx, {
          depthMm,
          pumpsWorking: survey.pumpsWorking,
          pumpsReserve: survey.pumpsReserve,
          outletDn: survey.outletDn,
          outletCount: survey.outletCount,
        })
      : [],
    '7': buildFasteners(ctx, { outletDn: survey.outletDn, outletCount: survey.outletCount }),
    // Оборудование ёмкости (ШУ, датчики, насосы) зависит от гидравлики и
    // подбора по каталогу АШУ — из ОЛ не выводится, добавляется вручную.
    '8': [],
  }

  return {
    deviceType: 'EMK',
    survey: survey as unknown as Record<string, unknown>,
    priceListVersion: ctx.priceListVersion,
    sections: assemble(EMK_SECTIONS, byCode),
  }
}

/** «Создать расчёт» из ОЛ колодца. */
export function materializeKol(ctx: MaterializeContext, survey: KolSurveyParams): CalcTree {
  const geo = computeKolGeometry(survey)
  const depthMm = geo.totalDepthMm

  const byCode: Record<string, CalcComponent[]> = {
    '1': buildKolKorpus(ctx, survey),
    '2': buildBasket(ctx, survey.hasBasket),
    '3': buildLadder(ctx, { depthMm }),
    '4': buildSlab(ctx, { dn: survey.dn, depthMm }),
    '5': buildVent(ctx),
    '6': buildFasteners(ctx, { outletDn: survey.outletDn, outletCount: survey.outletCount }),
    // У колодца из оборудования — только запорная арматура; её состав
    // задаётся в ОЛ поэлементно и добавляется вручную.
    '7': [],
  }

  return {
    deviceType: 'KOL',
    survey: survey as unknown as Record<string, unknown>,
    priceListVersion: ctx.priceListVersion,
    sections: assemble(KOL_SECTIONS, byCode),
  }
}
