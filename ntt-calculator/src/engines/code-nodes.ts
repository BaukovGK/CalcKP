/**
 * Встроенные узлы и встроенные шаблоны изделий (Библиотека §5, фаза 2).
 *
 * Встроенный узел — узел каталога, чьи формулы остаются кодом: обечайка,
 * днище, патрубки, лестница, напорный трубопровод… Каждый читает опросный
 * лист своего изделия целиком, поэтому связи с полями ОЛ у него заданы кодом,
 * а не биндингами. Узлы-данные, которые технолог собирает в редакторе, — в
 * engines/node-def.ts.
 *
 * Встроенный шаблон — тот же состав, что материализовался до редактора
 * шаблонов, но записанный ДАННЫМИ: разделы и ссылки на узлы по порядку.
 * Технолог берёт его за основу, переставляет узлы, добавляет узлы каталога и
 * публикует свою версию (engines/template-def.ts); пока версии нет, расчёты
 * собираются встроенным шаблоном (версия 0).
 */

import type { DeviceType } from '@/types/device'
import { pipeLengthM } from './formulas'
import { buildBasket, buildGrinder } from './basket-grinder'
import { buildMountingLoops } from './mounting-loops'
import { buildPumpMounting } from './station-equipment'
import { computeEmkGeometry, computeKolGeometry } from './survey-emk-kol'
import {
  buildFasteners,
  buildKnsAutomation,
  buildKnsBottom,
  buildKnsCableEntry,
  buildKnsInletFlange,
  buildKnsInsulation,
  buildKnsNozzles,
  buildKnsPumps,
  buildKnsService,
  buildKnsShell,
  buildKnsValves,
  buildLadder,
  buildPressurePipe,
  buildSlab,
  buildVent,
  KNS_SECTIONS,
  stationHeightM,
  type CalcComponent,
  type KnsSurveyParams,
  type MaterializeContext,
} from './template-kns'
import {
  buildEmkAutomation,
  buildEmkBottoms,
  buildEmkHatches,
  buildEmkInsulation,
  buildEmkNozzles,
  buildEmkPumps,
  buildEmkService,
  buildEmkShaft,
  buildEmkShell,
  buildEmkStrapping,
  buildEmkValves,
  buildKolBottom,
  buildKolHatches,
  buildKolInsulation,
  buildKolNeck,
  buildKolNozzles,
  buildKolShell,
  EMK_SECTIONS,
  emkHatches,
  emkLadderHeightMm,
  KOL_SECTIONS,
  kolHatch,
  type EmkSurveyParams,
  type KolSurveyParams,
} from './template-emk-kol'
import type { TemplateBody } from './template-def'

/** Параметры ОЛ каждого изделия — вход встроенных узлов. */
export interface DeviceSurvey {
  KNS: KnsSurveyParams
  EMK: EmkSurveyParams
  KOL: KolSurveyParams
}

interface BuiltinNodeOf<D extends DeviceType> {
  /** Ссылка из шаблона: «kns.shell». */
  ref: string
  device: D
  /** Коды каталога, которые узел даёт компонентам (справочно, для редактора). */
  codes: readonly string[]
  /** Название в редакторе шаблонов. */
  title: string
  /** Что узел читает из ОЛ — подсказка редактора. */
  reads: string
  build(ctx: MaterializeContext, survey: DeviceSurvey[D]): CalcComponent[]
}

export type BuiltinNode = { [D in DeviceType]: BuiltinNodeOf<D> }[DeviceType]

const kns = (n: Omit<BuiltinNodeOf<'KNS'>, 'device'>): BuiltinNodeOf<'KNS'> => ({ ...n, device: 'KNS' })
const emk = (n: Omit<BuiltinNodeOf<'EMK'>, 'device'>): BuiltinNodeOf<'EMK'> => ({ ...n, device: 'EMK' })
const kol = (n: Omit<BuiltinNodeOf<'KOL'>, 'device'>): BuiltinNodeOf<'KOL'> => ({ ...n, device: 'KOL' })

/** Высота лестницы ёмкости, мм — от неё лестница, направляющие и цепь насосов. */
const emkLadderMm = (s: EmkSurveyParams) => emkLadderHeightMm(s, computeEmkGeometry(s))
/** Шахт ёмкости; без шахты — одна «единица» для стояка и приставной лестницы. */
const emkShaftsOrOne = (s: EmkSurveyParams) => Math.max(1, computeEmkGeometry(s).shaftCount)

/**
 * Встроенные узлы по изделиям. Порядок — порядок в палитре редактора: как
 * узлы идут во встроенном шаблоне.
 */
export const BUILTIN_NODES: readonly BuiltinNode[] = [
  // ── КНС ──
  kns({ ref: 'kns.shell', codes: ['A1'], title: 'Обечайка корпуса', reads: 'DN, Нподз, PN, SN, ТТ МВК, исполнение корпуса, цена трубы', build: buildKnsShell }),
  kns({ ref: 'kns.bottom', codes: ['A2'], title: 'Днище', reads: 'DN', build: buildKnsBottom }),
  kns({ ref: 'kns.nozzles', codes: ['A5'], title: 'Патрубки подводящие и напорные', reads: 'DN и число подводящих и напорных патрубков', build: buildKnsNozzles }),
  kns({ ref: 'kns.inletFlange', codes: ['A6'], title: 'Фланцевый патрубок под задвижку на подводящем', reads: 'DN и число подводящих, арматура на подводящем', build: buildKnsInletFlange }),
  kns({ ref: 'kns.cableEntry', codes: ['A7'], title: 'Кабельный ввод', reads: '—', build: (ctx) => buildKnsCableEntry(ctx) }),
  kns({ ref: 'kns.insulation', codes: ['A9'], title: 'Теплоизоляция корпуса', reads: 'DN, теплоизоляция и её глубина', build: buildKnsInsulation }),
  kns({ ref: 'kns.loops', codes: ['A10'], title: 'Монтажные петли', reads: 'DN', build: (ctx, s) => [buildMountingLoops(ctx, s.dn)] }),
  kns({
    ref: 'kns.grinder',
    codes: ['D4'],
    title: 'Дробилка',
    reads: 'дробилка/корзина, глубина лотка, DN подводящего',
    build: (ctx, s) => [buildGrinder(ctx, { device: 'KNS', trayDepthMm: s.inletTrayDepthMm, inletDn: s.inletDn, enabled: Boolean(s.hasGrinder) })],
  }),
  kns({
    ref: 'kns.basket',
    codes: ['D3'],
    title: 'Корзина сороудерживающая',
    reads: 'дробилка/корзина, DN, глубина лотка',
    build: (ctx, s) => [
      buildBasket(ctx, { device: 'KNS', dn: s.dn, trayDepthMm: s.inletTrayDepthMm, enabled: Boolean(s.hasBasket), withGrinder: Boolean(s.hasGrinder) }),
    ],
  }),
  // Лестница — на всю длину трубы корпуса (лист, H122 + H123 = J14).
  kns({ ref: 'kns.ladder', codes: ['B1'], title: 'Лестница', reads: 'Нподз', build: (ctx, s) => buildLadder(ctx, { depthMm: s.depthMm, device: 'KNS' }) }),
  kns({ ref: 'kns.slab', codes: ['B2', 'B6'], title: 'Перекрытие, рама и анкеры', reads: 'DN, Нподз', build: (ctx, s) => buildSlab(ctx, { dn: s.dn, depthMm: s.depthMm, frame: true }) }),
  // Крепление и подъём насосов лежат в листе в разделе 3 (строки 189–197).
  kns({
    ref: 'kns.pumpMounting',
    codes: ['D1', 'D5'],
    title: 'Крепление и подъём насосов',
    reads: 'DN, Нподз, возвышение, рабочие и резервные насосы',
    build: (ctx, s) =>
      buildPumpMounting(ctx, {
        device: 'KNS',
        dn: s.dn,
        guideHeightM: pipeLengthM(s.depthMm),
        liftHeightM: stationHeightM(s),
        pumpsWorking: s.pumpsWorking,
        pumpsReserve: s.pumpsReserve,
      }),
  }),
  kns({ ref: 'kns.vent', codes: ['C1'], title: 'Вентиляционный стояк', reads: '—', build: (ctx) => buildVent(ctx) }),
  kns({ ref: 'kns.pressurePipe', codes: ['C2'], title: 'Напорный трубопровод', reads: 'напорные патрубки, насосы, аварийный трубопровод, расходомер', build: buildPressurePipe }),
  kns({ ref: 'kns.fasteners', codes: ['C3'], title: 'Крепёжный комплект', reads: 'DN и число напорных патрубков', build: buildFasteners }),
  kns({ ref: 'kns.valves', codes: ['C4'], title: 'Узел запорной арматуры', reads: 'патрубки, насосы, арматура на подводящем, ручные количества ОЛ', build: buildKnsValves }),
  kns({ ref: 'kns.pumps', codes: ['D1'], title: 'Насосная группа', reads: 'насосы, марка и цена насоса, высота станции', build: buildKnsPumps }),
  kns({ ref: 'kns.automation', codes: ['D2'], title: 'Автоматика: шкаф, датчики, расходомер', reads: 'блок «Автоматика» ОЛ, напорные патрубки, высота станции', build: buildKnsAutomation }),
  kns({ ref: 'kns.service', codes: ['D5'], title: 'Оборудование для обслуживания', reads: 'высота станции', build: buildKnsService }),

  // ── ЕМК ──
  emk({ ref: 'emk.shell', codes: ['A1'], title: 'Обечайка корпуса', reads: 'DN, объём или длина, расположение, тип, PN, SN, цена трубы', build: buildEmkShell }),
  emk({ ref: 'emk.bottoms', codes: ['A2', 'A3'], title: 'Днища', reads: 'DN, расположение, тип днищ', build: buildEmkBottoms }),
  emk({ ref: 'emk.shaft', codes: ['A8'], title: 'Шахты обслуживания', reads: 'шахта, число шахт, их Ø и высота, цена трубы шахты', build: buildEmkShaft }),
  emk({ ref: 'emk.nozzles', codes: ['A5'], title: 'Патрубки подводящие и отводящие', reads: 'DN и число патрубков', build: buildEmkNozzles }),
  emk({ ref: 'emk.insulation', codes: ['A9'], title: 'Теплоизоляция шахт и верха', reads: 'DN, шахты, теплоизоляция и её глубина', build: buildEmkInsulation }),
  emk({ ref: 'emk.loops', codes: ['A10'], title: 'Монтажные петли', reads: 'DN', build: (ctx, s) => [buildMountingLoops(ctx, s.dn)] }),
  // Дробилки в листе ёмкости нет — ни строк, ни формул: узла нет и здесь.
  emk({
    ref: 'emk.basket',
    codes: ['D3'],
    title: 'Корзина сороудерживающая',
    reads: 'корзина, DN, глубина лотка',
    build: (ctx, s) => [buildBasket(ctx, { device: 'EMK', dn: s.dn, trayDepthMm: s.inletTrayDepthMm, enabled: s.hasBasket })],
  }),
  // Лестница — нержавеющая на высоту лестницы и приставные алюминиевые по
  // одной на шахту (лист ЕМК, строки 114–123).
  emk({
    ref: 'emk.ladder',
    codes: ['B1'],
    title: 'Лестница',
    reads: 'лестница, расположение, габарит, шахты',
    build: (ctx, s) => buildLadder(ctx, { depthMm: emkLadderMm(s), enabled: s.hasLadder ?? true, device: 'EMK', portable: emkShaftsOrOne(s) }),
  }),
  // Перекрытие — только у вертикальной: у горизонтальной верх — сама труба,
  // лист держит перекрытие выключенным (C132 «Нет»). Толщина 10 мм, крышки
  // люков вычитаются; отверстие под шахту прорезает узел шахты.
  emk({
    ref: 'emk.slab',
    codes: ['B2', 'B6'],
    title: 'Перекрытие и анкеры (вертикальная)',
    reads: 'расположение, DN, габарит, шахты',
    build: (ctx, s) => {
      if (s.placement === 'горизонтальное') return []
      const h = emkHatches(s)
      return buildSlab(ctx, {
        dn: s.dn,
        depthMm: computeEmkGeometry(s).overallLengthMm ?? 0,
        thicknessMm: 10,
        hatches: { count: h.count, coverMassKg: h.coverMassKg },
        hatchCutout: !s.hasShaft,
      })
    },
  }),
  emk({ ref: 'emk.hatches', codes: ['B2'], title: 'Люки шахт', reads: 'шахты, их Ø', build: buildEmkHatches }),
  emk({ ref: 'emk.strapping', codes: ['B6'], title: 'Крепление к бетонному основанию (горизонтальная)', reads: 'расположение, длина трубы', build: buildEmkStrapping }),
  // Крепление и подъём насосов — только при насосах (лист ЕМК, строки
  // 163–171 и 195–198: всё под `IF(ОЛ!E54="нет";0;…)`). Направляющие и
  // цепь — на высоту лестницы, как в листе.
  emk({
    ref: 'emk.pumpMounting',
    codes: ['D1', 'D5'],
    title: 'Крепление и подъём насосов',
    reads: 'насосное оборудование, насосы, высота лестницы',
    build: (ctx, s) =>
      s.hasPumps
        ? buildPumpMounting(ctx, {
            device: 'EMK',
            dn: s.dn,
            guideHeightM: emkLadderMm(s) / 1000,
            liftHeightM: emkLadderMm(s) / 1000,
            pumpsWorking: s.pumpsWorking,
            pumpsReserve: s.pumpsReserve,
          })
        : [],
  }),
  // Стояк — на каждую шахту (лист ЕМК, строки 210–215 × H209 = L8).
  emk({ ref: 'emk.vent', codes: ['C1'], title: 'Вентиляционный стояк', reads: 'вентиляция, шахты', build: (ctx, s) => buildVent(ctx, { enabled: s.ventilation ?? true, count: emkShaftsOrOne(s) }) }),
  // Напорный трубопровод — ТОЛЬКО при насосном оборудовании (Реверс §5).
  emk({
    ref: 'emk.pressurePipe',
    codes: ['C2'],
    title: 'Напорный трубопровод',
    reads: 'насосное оборудование, насосы, отводящие патрубки',
    build: (ctx, s) =>
      s.hasPumps
        ? buildPressurePipe(ctx, {
            depthMm: computeEmkGeometry(s).overallLengthMm ?? 0,
            pumpsWorking: s.pumpsWorking,
            pumpsReserve: s.pumpsReserve,
            outletDn: s.outletDn,
            outletCount: s.outletCount,
          })
        : [],
  }),
  // Крепёж фланцев — у напорного трубопровода, то есть только при насосах:
  // гильзы патрубков фланцев не имеют. В листе ёмкости болты М20 — фланцы
  // напорной линии (H247 = отверстий × фланцев), М12 — «стульчики»; числа
  // фланцев и стульчиков вписаны руками.
  emk({
    ref: 'emk.fasteners',
    codes: ['C3'],
    title: 'Крепёжный комплект',
    reads: 'насосное оборудование, DN и число отводящих патрубков',
    build: (ctx, s) => (s.hasPumps ? buildFasteners(ctx, { outletDn: s.outletDn, outletCount: s.outletCount }) : []),
  }),
  // Раздел 8 — по листу ёмкости (строки 260–284): то, что выводится из ОЛ.
  emk({ ref: 'emk.valves', codes: ['C4'], title: 'Задвижка на подводящем', reads: 'арматура на подводящем, DN и число подводящих, глубина лотка', build: buildEmkValves }),
  emk({ ref: 'emk.pumps', codes: ['D1'], title: 'Насосная группа', reads: 'насосное оборудование, насосы, марка, высота лестницы', build: buildEmkPumps }),
  emk({ ref: 'emk.automation', codes: ['D2'], title: 'Шкаф управления и датчики', reads: 'шкаф управления, датчики уровня, насосы', build: buildEmkAutomation }),
  emk({ ref: 'emk.service', codes: ['D5'], title: 'Оборудование для обслуживания', reads: 'высота лестницы', build: buildEmkService }),

  // ── КОЛ ──
  kol({ ref: 'kol.shell', codes: ['A1'], title: 'Обечайка корпуса', reads: 'DN, рабочая часть (без горловины — с возвышением), PN, SN, цена трубы', build: buildKolShell }),
  kol({ ref: 'kol.bottom', codes: ['A2'], title: 'Днище', reads: 'DN', build: buildKolBottom }),
  kol({ ref: 'kol.neck', codes: ['A8'], title: 'Горловина', reads: 'горловина, её Ø и высота, возвышение, цена трубы горловины', build: buildKolNeck }),
  kol({ ref: 'kol.nozzles', codes: ['A5'], title: 'Патрубки подводящие и отводящие', reads: 'DN и число патрубков', build: buildKolNozzles }),
  kol({ ref: 'kol.insulation', codes: ['A9'], title: 'Теплоизоляция корпуса', reads: 'DN, теплоизоляция и её глубина', build: buildKolInsulation }),
  kol({ ref: 'kol.loops', codes: ['A10'], title: 'Монтажные петли', reads: 'DN', build: (ctx, s) => [buildMountingLoops(ctx, s.dn)] }),
  // Дробилка колодца — в корпусе, как в листе (строки 67–75).
  kol({
    ref: 'kol.grinder',
    codes: ['D4'],
    title: 'Дробилка',
    reads: 'дробилка, глубина лотка',
    build: (ctx, s) => [buildGrinder(ctx, { device: 'KOL', trayDepthMm: s.inletTrayDepthMm, enabled: Boolean(s.hasGrinder) })],
  }),
  kol({
    ref: 'kol.basket',
    codes: ['D3'],
    title: 'Корзина сороудерживающая',
    reads: 'корзина, DN, глубина лотка',
    build: (ctx, s) => [buildBasket(ctx, { device: 'KOL', dn: s.dn, trayDepthMm: s.inletTrayDepthMm, enabled: s.hasBasket })],
  }),
  // Лестница — по полной глубине корпуса с горловиной (эталон I113) и одна
  // приставная (строки 118, 122).
  kol({
    ref: 'kol.ladder',
    codes: ['B1'],
    title: 'Лестница',
    reads: 'лестница, глубина с горловиной',
    build: (ctx, s) => buildLadder(ctx, { depthMm: computeKolGeometry(s).totalDepthMm, enabled: s.hasLadder ?? true, device: 'KOL', portable: 1 }),
  }),
  // Перекрытие 10 мм за вычетом крышки люка (лист колодца, строка 132);
  // анкеры — по глубине трубы корпуса (H5), как в листе.
  kol({
    ref: 'kol.slab',
    codes: ['B2', 'B6'],
    title: 'Перекрытие и анкеры',
    reads: 'DN, глубина корпуса, горловина',
    build: (ctx, s) => {
      const h = kolHatch(s)
      return buildSlab(ctx, {
        dn: s.dn,
        depthMm: computeKolGeometry(s).shellLengthMm,
        thicknessMm: 10,
        hatches: { count: h.count, coverMassKg: h.coverMassKg },
        hatchCutout: !s.hasNeck,
      })
    },
  }),
  kol({ ref: 'kol.hatches', codes: ['B2'], title: 'Люк горловины', reads: 'горловина, её Ø', build: buildKolHatches }),
  // Вентиляции в ОЛ колодца нет — стояк всегда.
  kol({ ref: 'kol.vent', codes: ['C1'], title: 'Вентиляционный стояк', reads: '—', build: (ctx) => buildVent(ctx) }),
  // Узла крепежа у колодца нет: его патрубки — гильзы без фланцев, а крепёж
  // листа (строки 227–230, болты М12) — на «стульчики», число которых
  // вписано руками. Прежний узел считал болты по фланцам отводящих
  // патрубков, которых у колодца нет.
]

const BY_REF: ReadonlyMap<string, BuiltinNode> = new Map(BUILTIN_NODES.map((n) => [n.ref, n]))

/** Встроенный узел по ссылке шаблона. */
export function builtinNode(ref: string): BuiltinNode | null {
  return BY_REF.get(ref) ?? null
}

/** Встроенные узлы изделия — палитра редактора шаблонов. */
export function builtinNodesOf(device: DeviceType): BuiltinNode[] {
  return BUILTIN_NODES.filter((n) => n.device === device)
}

/**
 * Коды каталога, занятые встроенными узлами: узел технолога с таким кодом
 * путался бы со встроенным в аудите состава (`CalcComponent.nodeCode`).
 */
export const RESERVED_NODE_CODES: ReadonlySet<string> = new Set(BUILTIN_NODES.flatMap((n) => n.codes))

const refs = (...r: string[]) => r.map((ref) => ({ kind: 'builtin' as const, ref }))

function sections(frame: ReadonlyArray<{ title: string }>, nodes: string[][]): TemplateBody {
  return { sections: frame.map((s, i) => ({ title: s.title, nodes: refs(...(nodes[i] ?? [])) })) }
}

/**
 * Встроенные шаблоны — ровно тот состав и порядок, что материализовался до
 * редактора шаблонов. Разделы — каркасы `KNS_SECTIONS`/`EMK_SECTIONS`/
 * `KOL_SECTIONS`; пустой раздел — каркас для строк, которые добавляют
 * вручную (оборудование ёмкости и колодца).
 */
export const BUILTIN_TEMPLATES: Readonly<Record<DeviceType, TemplateBody>> = {
  KNS: sections(KNS_SECTIONS, [
    // У КНС корзина и дробилка — в «Корпусе», как в листе (строки 74–113).
    ['kns.shell', 'kns.bottom', 'kns.nozzles', 'kns.inletFlange', 'kns.cableEntry', 'kns.insulation', 'kns.loops', 'kns.grinder', 'kns.basket'],
    ['kns.ladder'],
    ['kns.slab', 'kns.pumpMounting'],
    ['kns.vent'],
    ['kns.pressurePipe'],
    ['kns.fasteners'],
    ['kns.valves', 'kns.pumps', 'kns.automation', 'kns.service'],
  ]),
  EMK: sections(EMK_SECTIONS, [
    ['emk.shell', 'emk.bottoms', 'emk.shaft', 'emk.nozzles', 'emk.insulation', 'emk.loops'],
    ['emk.basket'],
    ['emk.ladder'],
    // Порядок — как в листе: перекрытие и люки, крепление и подъём насосов,
    // крепление к бетонному основанию (строки 131–176).
    ['emk.slab', 'emk.hatches', 'emk.pumpMounting', 'emk.strapping'],
    ['emk.vent'],
    ['emk.pressurePipe'],
    ['emk.fasteners'],
    // Задвижки и клапаны напорной стороны лист вписывает руками — их
    // добавляют строками; остальное оборудование выводится из ОЛ.
    ['emk.valves', 'emk.pumps', 'emk.automation', 'emk.service'],
  ]),
  KOL: sections(KOL_SECTIONS, [
    ['kol.shell', 'kol.bottom', 'kol.neck', 'kol.nozzles', 'kol.insulation', 'kol.loops', 'kol.grinder'],
    ['kol.basket'],
    ['kol.ladder'],
    ['kol.slab', 'kol.hatches'],
    ['kol.vent'],
    // Крепёж колодца в листе — на «стульчики», их число вписано руками.
    [],
    // Оборудование колодца в листе — задвижка DN100 с фланцами и
    // борт-шайбами, их количества вписаны руками: раздел — каркас для
    // ручных строк.
    [],
  ]),
}
