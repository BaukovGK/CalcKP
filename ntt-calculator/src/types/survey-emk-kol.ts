/**
 * Модели опросных листов ЕМК (ёмкость) и КОЛ (колодец) — состав полей по
 * ТЗ §5.6.
 *
 * Прототип хендоффа покрывает только насосную станцию, поэтому вид экранов
 * повторяет «Опросный лист v2», а СОСТАВ ПОЛЕЙ берётся из ТЗ — по принципу
 * «прототип диктует внешний вид, данные из ТЗ» (План §4.1-ter).
 */

import type { Installation, Placement, TankType } from '@/engines/survey-emk-kol'
import type { PipeMaterial, SurveyCommonForm } from './survey'

/** Тип колодца (ТЗ §5.6: «тип колодца, в т.ч. гаситель»). */
export type WellType = 'Смотровой' | 'Поворотный' | 'Перепадный' | 'Гаситель' | 'Накопительный'

/** Тип смолы → марка подставляется автоматически (ТЗ §5.6). */
export type ResinType = 'Стандарт' | 'Винилэфирная стандарт' | 'Винилэфирная высокотемп.'

/** Вид стоков. */
export type EffluentType = 'Хозяйственно-бытовые' | 'Ливневые' | 'Промышленные' | 'Агрессивные'

// ─── ЕМК ─────────────────────────────────────────────────────────────────────

export interface EmkSurveyForm extends SurveyCommonForm {
  /** Тип ёмкости: «Химстойкая» переключает материал СК/НПС → СК/ВЭС. */
  tankType: TankType

  // Габариты: объём + расположение + установка → авторасчёт длины
  volumeM3: string
  dn: string
  placement: Placement
  installation: Installation
  /** Ручной override длины трубы: пусто — расчётная из объёма. */
  lengthManual: string
  pnManual: string
  snManual: string
  pipeManual: boolean

  // Шахта обслуживания
  hasShaft: boolean
  shaftD: string
  shaftH: string
  hasLadder: boolean

  // Патрубки
  podvMat: PipeMaterial
  podvDn: string
  podvKol: string
  podvLotok: string
  otvMat: PipeMaterial
  otvDn: string
  otvKol: string
  otvLotok: string

  // Насосное оборудование (при «да» — гидравлический блок как у КНС)
  hasPumps: boolean
  rashod: string
  napor: string
  nRab: string
  nRez: string
  marka: string

  // Доп. оборудование
  grinder: 'корзина' | 'дробилка' | 'обе' | 'нет'
  hasValves: boolean
  shu: boolean
  datchikiUrov: boolean
  ventilation: boolean
  insulation: boolean
  tiGlubina: string
}

export function makeDefaultEmkSurvey(): EmkSurveyForm {
  return {
    zayavka: '',
    stadiya: 'рабочая',
    zakazchik: '',
    obekt: '',
    region: '',
    data: new Date().toLocaleDateString('ru-RU'),

    tankType: 'Накопительная',

    volumeM3: '50',
    dn: '2000',
    placement: 'вертикальное',
    installation: 'подземная',
    lengthManual: '',
    pnManual: '',
    snManual: '',
    pipeManual: false,

    hasShaft: true,
    shaftD: '1200',
    shaftH: '2300',
    hasLadder: true,

    podvMat: 'ПЭ',
    podvDn: '150',
    podvKol: '1',
    podvLotok: '',
    otvMat: 'ПЭ',
    otvDn: '150',
    otvKol: '1',
    otvLotok: '',

    hasPumps: false,
    rashod: '',
    napor: '',
    nRab: '0',
    nRez: '0',
    marka: '',

    grinder: 'нет',
    hasValves: true,
    shu: false,
    datchikiUrov: true,
    ventilation: true,
    insulation: false,
    tiGlubina: '',
  }
}

// ─── КОЛ ─────────────────────────────────────────────────────────────────────

export interface KolSurveyForm extends SurveyCommonForm {
  wellType: WellType

  // Корпус
  dn: string
  /** Глубина рабочей части H, мм. */
  depthMm: string
  elevationMm: string
  underRoadway: boolean
  pnManual: string
  snManual: string
  pipeManual: boolean

  // Горловина
  hasNeck: boolean
  neckD: string
  neckH: string

  hasLadder: boolean
  resin: ResinType
  effluent: EffluentType

  // Патрубки
  podvMat: PipeMaterial
  podvDn: string
  podvKol: string
  podvLotok: string
  otvMat: PipeMaterial
  otvDn: string
  otvKol: string
  otvLotok: string

  // Доп. оборудование
  grinder: 'корзина' | 'дробилка' | 'обе' | 'нет'
  hasValves: boolean
  shu: boolean
  datchiki: boolean
  insulation: boolean
  tiGlubina: string
}

export function makeDefaultKolSurvey(): KolSurveyForm {
  return {
    zayavka: '',
    wellType: 'Смотровой',
    stadiya: 'рабочая',
    zakazchik: '',
    obekt: '',
    region: '',
    data: new Date().toLocaleDateString('ru-RU'),

    dn: '1500',
    depthMm: '2500',
    elevationMm: '200',
    underRoadway: false,
    pnManual: '',
    snManual: '',
    pipeManual: false,

    hasNeck: true,
    neckD: '1000',
    neckH: '800',

    hasLadder: true,
    resin: 'Стандарт',
    effluent: 'Хозяйственно-бытовые',

    podvMat: 'ПЭ',
    podvDn: '150',
    podvKol: '1',
    podvLotok: '',
    otvMat: 'ПЭ',
    otvDn: '150',
    otvKol: '1',
    otvLotok: '',

    grinder: 'нет',
    hasValves: true,
    shu: false,
    datchiki: false,
    insulation: false,
    tiGlubina: '',
  }
}

/** Марка смолы по типу (ТЗ §5.6: «тип → марка (авто)»). */
export function resinGrade(type: ResinType): string {
  switch (type) {
    case 'Винилэфирная стандарт':
      return 'Reichhold Dion 9100'
    case 'Винилэфирная высокотемп.':
      return 'Reichhold Dion 9300'
    default:
      return 'Reichhold Polylite 33520'
  }
}
