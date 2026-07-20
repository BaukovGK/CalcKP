/**
 * Авторасчёты опросных листов ЕМК (ёмкость) и КОЛ (колодец).
 *
 * Отличия от КНС — по первоисточнику («Шаблон 3.0.xlsx», листы «Калькулятор
 * ЕМК» и «Калькулятор колодца») и Реверсу §5–§6.
 */

import { snByDepth } from './survey-kns'

// ─── ЕМК: габариты ───────────────────────────────────────────────────────────

export type Placement = 'горизонтальное' | 'вертикальное'
export type Installation = 'наземная' | 'подземная' | 'в помещении'

/** Тип ёмкости (§5.6 ТЗ). «Химстойкая» меняет материал корпуса. */
export type TankType =
  | 'Накопительная'
  | 'Химстойкая'
  | 'Аккумулирующая'
  | 'Питьевая'
  | 'С насосным оборудованием'

/**
 * Материал корпуса ёмкости (эталон, ячейка `D8`):
 * `IF(тип = "Химстойкая"; "СК/ВЭС"; "СК/НПС")`.
 */
export function tankMaterial(type: TankType): 'СК/ВЭС' | 'СК/НПС' {
  return type === 'Химстойкая' ? 'СК/ВЭС' : 'СК/НПС'
}

/**
 * Длина трубы ёмкости из объёма (Реверс §5):
 * `CEILING(4V / (π·(D/1000)²) · 1000; 100)` — мм, вверх до 100.
 *
 * Лист «для шапки» брать нельзя: в нём стоят числа конкретного заказа
 * (4000 / 13400 мм при V = 100 м³), а не справочная таблица. Дискретное
 * оттуда — только возвышение и параметры шахты (см. ниже).
 */
export function tankPipeLengthMm(volumeM3: number, dn: number): number | null {
  if (volumeM3 <= 0 || dn <= 0) return null
  const raw = ((4 * volumeM3) / (Math.PI * (dn / 1000) ** 2)) * 1000
  return Math.ceil(raw / 100) * 100
}

/**
 * Объём двух эллиптических днищ, м³ (эталон `L5`): `π·(DN/1000)³ / 15`.
 * Только для ГОРИЗОНТАЛЬНОЙ ёмкости — у вертикальной днища плоские.
 */
export function ellipticBottomsVolumeM3(dn: number): number {
  return (Math.PI * (dn / 1000) ** 3) / 15
}

/**
 * Прибавка к длине трубы под эллиптические днища: +1,5 м (Реверс §5).
 * У вертикальной ёмкости прибавки нет.
 */
export const ELLIPTIC_EXTRA_MM = 1500

/** Возвышение корпуса над землёй, мм — из листа «для шапки». */
export function tankElevationMm(installation: Installation): number {
  // Подземная — 300 мм над уровнем земли; наземная и в помещении — 0.
  return installation === 'подземная' ? 300 : 0
}

/** Параметры шахты обслуживания — из листа «для шапки» (8 комбинаций). */
export function serviceShaft(
  installation: Installation,
  hasShaft: boolean,
): { diameterMm: number; heightMm: number } {
  if (!hasShaft) return { diameterMm: 0, heightMm: 0 }
  // Диаметр типовой 1200; высота больше у подземной (нужен выход на поверхность).
  return { diameterMm: 1200, heightMm: installation === 'подземная' ? 2300 : 2000 }
}

export interface EmkGeometryInput {
  volumeM3: number
  dn: number
  placement: Placement
  installation: Installation
  hasShaft: boolean
}

export interface EmkGeometry {
  /** Длина рабочей части (трубы), мм. */
  pipeLengthMm: number | null
  /** Габаритная длина с учётом эллиптических днищ, мм. */
  overallLengthMm: number | null
  elevationMm: number
  shaftDiameterMm: number
  shaftHeightMm: number
  /** Объём двух эллиптических днищ (только горизонтальная), м³. */
  ellipticVolumeM3: number | null
  /** SN по габаритной длине — та же лестница, что у КНС. */
  sn: number | null
}

/** Габариты ёмкости целиком. */
export function computeEmkGeometry(input: EmkGeometryInput): EmkGeometry {
  const { volumeM3, dn, placement, installation, hasShaft } = input

  const horizontal = placement === 'горизонтальное'
  const pipeLengthMm = tankPipeLengthMm(volumeM3, dn)
  const overallLengthMm = pipeLengthMm == null ? null : pipeLengthMm + (horizontal ? ELLIPTIC_EXTRA_MM : 0)
  const shaft = serviceShaft(installation, hasShaft)

  return {
    pipeLengthMm,
    overallLengthMm,
    elevationMm: tankElevationMm(installation),
    shaftDiameterMm: shaft.diameterMm,
    shaftHeightMm: shaft.heightMm,
    ellipticVolumeM3: horizontal ? ellipticBottomsVolumeM3(dn) : null,
    // Глубина у подземной ёмкости определяет жёсткость так же, как у КНС.
    sn: overallLengthMm == null ? null : snByDepth(overallLengthMm),
  }
}

// ─── КОЛ: горловина ──────────────────────────────────────────────────────────

export interface KolGeometryInput {
  /** Глубина рабочей части, мм. */
  workingDepthMm: number
  /** Возвышение над землёй, мм. */
  elevationMm: number
  hasNeck: boolean
  /** Высота горловины, мм (при hasNeck). */
  neckHeightMm: number
  /** Диаметр горловины, мм (при hasNeck). */
  neckDiameterMm: number
  underRoadway?: boolean
}

export interface KolGeometry {
  /** Полная глубина корпуса с горловиной, мм (эталон H5/N5). */
  totalDepthMm: number
  neckHeightMm: number
  neckDiameterMm: number
  sn: number | null
}

/**
 * Геометрия колодца.
 *
 * Эталон: `H5 = IF(горловина = "да"; глубина_с_горловиной; глубина)`,
 * `N5 = высота_горловины + возвышение` — то есть при наличии горловины она
 * добавляется к глубине корпуса.
 */
export function computeKolGeometry(input: KolGeometryInput): KolGeometry {
  const { workingDepthMm, elevationMm, hasNeck, neckHeightMm, neckDiameterMm, underRoadway } = input

  const neckH = hasNeck ? neckHeightMm + elevationMm : 0
  const totalDepthMm = workingDepthMm + neckH

  return {
    totalDepthMm,
    neckHeightMm: neckH,
    neckDiameterMm: hasNeck ? neckDiameterMm : 0,
    sn: snByDepth(totalDepthMm, { underRoadway }),
  }
}

/**
 * Масса крышки горловины, кг (Библиотека A8):
 * базовая `1 × 1 × 0,006 × 1850 ≈ 11,1 кг` — для типовой горловины 1 × 1 м.
 * Для другого диаметра масштабируется площадью.
 */
export function neckCoverMassKg(neckDiameterMm: number): number {
  const areaM2 = Math.PI * (neckDiameterMm / 2000) ** 2
  return areaM2 * 0.006 * 1850
}
