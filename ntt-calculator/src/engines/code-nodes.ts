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
  buildEmkBottoms,
  buildEmkInsulation,
  buildEmkNozzles,
  buildEmkShaft,
  buildEmkShell,
  buildKolBottom,
  buildKolInsulation,
  buildKolNeck,
  buildKolNozzles,
  buildKolShell,
  EMK_SECTIONS,
  emkLadderHeightMm,
  KOL_SECTIONS,
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
  emk({ ref: 'emk.shell', codes: ['A1'], title: 'Обечайка корпуса', reads: 'DN, объём или длина, тип, PN, SN, цена трубы', build: buildEmkShell }),
  emk({ ref: 'emk.bottoms', codes: ['A2', 'A3'], title: 'Днища', reads: 'DN, расположение, тип днищ', build: buildEmkBottoms }),
  emk({ ref: 'emk.shaft', codes: ['A8'], title: 'Шахта обслуживания', reads: 'шахта, её Ø и высота, цена трубы шахты', build: buildEmkShaft }),
  emk({ ref: 'emk.nozzles', codes: ['A5'], title: 'Патрубки подводящие и отводящие', reads: 'DN и число патрубков', build: buildEmkNozzles }),
  emk({ ref: 'emk.insulation', codes: ['A9'], title: 'Теплоизоляция корпуса', reads: 'DN, теплоизоляция и её глубина', build: buildEmkInsulation }),
  emk({ ref: 'emk.loops', codes: ['A10'], title: 'Монтажные петли', reads: 'DN', build: (ctx, s) => [buildMountingLoops(ctx, s.dn)] }),
  // Дробилки в листе ёмкости нет — ни строк, ни формул: узла нет и здесь.
  emk({
    ref: 'emk.basket',
    codes: ['D3'],
    title: 'Корзина сороудерживающая',
    reads: 'корзина, DN, глубина лотка',
    build: (ctx, s) => [buildBasket(ctx, { device: 'EMK', dn: s.dn, trayDepthMm: s.inletTrayDepthMm, enabled: s.hasBasket })],
  }),
  emk({ ref: 'emk.ladder', codes: ['B1'], title: 'Лестница', reads: 'лестница, расположение, габарит и шахта', build: (ctx, s) => buildLadder(ctx, { depthMm: emkLadderMm(s), enabled: s.hasLadder ?? true, device: 'EMK' }) }),
  emk({ ref: 'emk.slab', codes: ['B2', 'B6'], title: 'Перекрытие и анкеры', reads: 'DN, габарит', build: (ctx, s) => buildSlab(ctx, { dn: s.dn, depthMm: computeEmkGeometry(s).overallLengthMm ?? 0 }) }),
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
  emk({ ref: 'emk.vent', codes: ['C1'], title: 'Вентиляционный стояк', reads: 'вентиляция', build: (ctx, s) => buildVent(ctx, { enabled: s.ventilation ?? true }) }),
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
  emk({ ref: 'emk.fasteners', codes: ['C3'], title: 'Крепёжный комплект', reads: 'DN и число отводящих патрубков', build: (ctx, s) => buildFasteners(ctx, { outletDn: s.outletDn, outletCount: s.outletCount }) }),

  // ── КОЛ ──
  kol({ ref: 'kol.shell', codes: ['A1'], title: 'Обечайка корпуса', reads: 'DN, глубина с горловиной, PN, SN, цена трубы', build: buildKolShell }),
  kol({ ref: 'kol.bottom', codes: ['A2'], title: 'Днище', reads: 'DN', build: buildKolBottom }),
  kol({ ref: 'kol.neck', codes: ['A8'], title: 'Горловина', reads: 'горловина, её Ø и высота, цена трубы горловины', build: buildKolNeck }),
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
  // Лестница — по полной глубине корпуса с горловиной (эталон I113).
  kol({ ref: 'kol.ladder', codes: ['B1'], title: 'Лестница', reads: 'лестница, глубина с горловиной', build: (ctx, s) => buildLadder(ctx, { depthMm: computeKolGeometry(s).totalDepthMm, enabled: s.hasLadder ?? true, device: 'KOL' }) }),
  kol({ ref: 'kol.slab', codes: ['B2', 'B6'], title: 'Перекрытие и анкеры', reads: 'DN, глубина с горловиной', build: (ctx, s) => buildSlab(ctx, { dn: s.dn, depthMm: computeKolGeometry(s).totalDepthMm }) }),
  // Вентиляции в ОЛ колодца нет — стояк всегда.
  kol({ ref: 'kol.vent', codes: ['C1'], title: 'Вентиляционный стояк', reads: '—', build: (ctx) => buildVent(ctx) }),
  kol({ ref: 'kol.fasteners', codes: ['C3'], title: 'Крепёжный комплект', reads: 'DN и число отводящих патрубков', build: (ctx, s) => buildFasteners(ctx, { outletDn: s.outletDn, outletCount: s.outletCount }) }),
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
    ['emk.slab', 'emk.pumpMounting'],
    ['emk.vent'],
    ['emk.pressurePipe'],
    ['emk.fasteners'],
    // Оборудование ёмкости (ШУ, датчики, насосы) из ОЛ не выводится —
    // добавляется вручную.
    [],
  ]),
  KOL: sections(KOL_SECTIONS, [
    ['kol.shell', 'kol.bottom', 'kol.neck', 'kol.nozzles', 'kol.insulation', 'kol.loops', 'kol.grinder'],
    ['kol.basket'],
    ['kol.ladder'],
    ['kol.slab'],
    ['kol.vent'],
    ['kol.fasteners'],
    // У колодца из оборудования — только запорная арматура; её состав
    // задаётся в ОЛ поэлементно и добавляется вручную.
    [],
  ]),
}
