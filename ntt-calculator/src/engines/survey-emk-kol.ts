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

/**
 * Днища горизонтальной ёмкости — два, по одному на каждом конце трубы.
 *
 * - `эллиптические` — формованные днища (эталон: «старый способ»): масса
 *   каждого — из матрицы «Формовка эллиптических днищ» листа «Для
 *   расчетов», к трубе крепятся ламинированием по Мс (Dу трубы, минимальное
 *   PN). Сам лист расчёта матрицу не читает: при «старом способе» строка 25
 *   лишь меняет название на «Механическая формовка эллиптических днищ», а
 *   количество считает той же формулой стыков по Мс, строка 27 обнуляется
 *   (Вопросы_заводу §6е);
 * - `цилиндрические` — концы из той же трубы с косыми и центральным стыками
 *   (эталон: «новый способ», строки 13 и 25 листа «Калькулятор ЕМК»): трубы
 *   больше на 1,5 м, ламинация стыков — `(Мс/0,707 + Мс/2)·2`.
 */
export type EmkBottomType = 'эллиптические' | 'цилиндрические'

/**
 * Прибавка трубы на цилиндрические днища, мм: эталон `I13 = (L + 1,5)·линий`
 * при «новом способе». В листе константа, от DN не зависит.
 */
export const CYLINDRICAL_BOTTOMS_PIPE_MM = 1500

/**
 * Строка матриц листа «Для расчетов» по длине, мм — «До 3 м», «До 3,5» …
 * «До 7 м», «До 12». Правило шапки «Калькулятора ЕМК» (H4):
 * `IF(L<3000; 3000; IF(L>7000; 12000; CEILING(L; 500)))`.
 */
export function matrixLengthBucketMm(lengthMm: number): number {
  if (lengthMm < 3000) return 3000
  if (lengthMm > 7000) return 12000
  return Math.ceil(lengthMm / 500) * 500
}

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
 * Длина трубы ёмкости из объёма, мм, вверх до 100 — лист «для шапки»,
 * строки 2–9 (ячейки D, E, F, G):
 *
 * - вертикальная: `CEILING(4V / (π·(D/1000)²) · 1000; 100)`;
 * - горизонтальная: из объёма вычитаются два эллиптических днища —
 *   `CEILING(4·(V − π·D³/15) / (π·(D/1000)²) · 1000; 100)`: часть объёма
 *   дают днища, и трубы нужно меньше. Образец листа: V 100 м³, DN 3000 —
 *   13 400 мм, а не 14 200.
 *
 * Раньше объём днищ не вычитался, и горизонтальная ёмкость выходила больше
 * заказанной (Вопросы_заводу §6е, п. 4 — ответ нашёлся в самом листе).
 * Объём меньше объёма днищ трубы не даёт — длину вводят в ОЛ вручную.
 */
export function tankPipeLengthMm(volumeM3: number, dn: number, horizontal = false): number | null {
  if (volumeM3 <= 0 || dn <= 0) return null
  const pipeVolumeM3 = volumeM3 - (horizontal ? ellipticBottomsVolumeM3(dn) : 0)
  if (pipeVolumeM3 <= 0) return null
  const raw = ((4 * pipeVolumeM3) / (Math.PI * (dn / 1000) ** 2)) * 1000
  return Math.ceil(raw / 100) * 100
}

/**
 * Объём двух эллиптических днищ, м³ (эталон `L5`): `π·(DN/1000)³ / 15`.
 * Только для ГОРИЗОНТАЛЬНОЙ ёмкости — у вертикальной днища плоские. Он же
 * вычитается из объёма при расчёте длины трубы (`tankPipeLengthMm`).
 */
export function ellipticBottomsVolumeM3(dn: number): number {
  return (Math.PI * (dn / 1000) ** 3) / 15
}

/**
 * Прибавка габаритной длины горизонтальной ёмкости к длине трубы, мм — у
 * нас 1,5 м при любом DN. В листе «для шапки» (столбец C) у подземной
 * габарит равен длине трубы, у наземной — труба + DN/2 (при DN 3000 те же
 * 1,5 м). Лист ведёт габаритом горизонтальной только заголовок, у нас он
 * ещё задаёт SN по габариту (Вопросы_заводу §6е). У вертикальной прибавки нет.
 */
export const ELLIPTIC_EXTRA_MM = 1500

/**
 * Возвышение корпуса над землёй, мм. В листе — поле ОЛ E26 у подземной (в
 * образце 300) и 0 у наземной; в ОЛ ёмкости приложения поля нет — у
 * подземной берётся 300. На длину трубы оно не влияет.
 */
export function tankElevationMm(installation: Installation): number {
  // Подземная — 300 мм над уровнем земли; наземная и в помещении — 0.
  return installation === 'подземная' ? 300 : 0
}

/**
 * Типовой диаметр шахты обслуживания — та же стеклопластиковая труба, что и
 * корпус, но своего диаметра. DN 1200 — значение образца листа (ОЛ, E40).
 */
export const SHAFT_DN_DEFAULT = 1200

/**
 * Параметры шахты обслуживания — поля ОЛ «диаметр», «высота» и «количество»,
 * пустые — типовые. Типовая высота у подземной 2300 мм — так её показывает
 * лист «для шапки» (высота + возвышение 300), у остальных 2000; труба шахты
 * в листе расчёта идёт на высоту из ОЛ без возвышения (M8 = E41).
 *
 * Раньше функция возвращала только типовые: поля «d шахты» и «h шахты» в ОЛ
 * заполнялись, но в габариты и в расчёт не попадали — считалась всегда
 * Ø1200. Ноль и пустое трактуем как «типовое»: в ОЛ это пустое поле.
 *
 * Количество шахт — ячейка L8 листа «Калькулятор ЕМК» («Количество шахт,
 * шт.», в образце 2): на него умножаются труба шахты, муфта, ламинирование
 * к корпусу, прорезка, утепление, люки, вентстояки и приставные лестницы.
 * Пустое — одна.
 */
export function serviceShaft(
  installation: Installation,
  hasShaft: boolean,
  override?: { diameterMm?: number | null; heightMm?: number | null; count?: number | null },
): { diameterMm: number; heightMm: number; count: number } {
  if (!hasShaft) return { diameterMm: 0, heightMm: 0, count: 0 }
  // Высота типовая больше у подземной: нужен выход на поверхность.
  const typicalHeightMm = installation === 'подземная' ? 2300 : 2000
  const count = override?.count && override.count > 0 ? Math.round(override.count) : 1
  return {
    diameterMm: override?.diameterMm || SHAFT_DN_DEFAULT,
    heightMm: override?.heightMm || typicalHeightMm,
    count,
  }
}

export interface EmkGeometryInput {
  volumeM3: number
  dn: number
  placement: Placement
  installation: Installation
  /**
   * Длина трубы, введённая в ОЛ вручную, мм; пусто — из объёма. Раньше ОЛ
   * показывал её, а расчёт считал по объёму: труба в листе и в расчёте
   * расходились.
   */
  pipeLengthMm?: number | null
  hasShaft: boolean
  /** Диаметр шахты из ОЛ; пусто — типовой DN 1200. */
  shaftDiameterMm?: number | null
  /** Высота шахты из ОЛ; пусто — типовая по установке. */
  shaftHeightMm?: number | null
  /** Количество шахт из ОЛ; пусто — одна. */
  shaftCount?: number | null
}

export interface EmkGeometry {
  /** Длина рабочей части (трубы), мм. */
  pipeLengthMm: number | null
  /** Габаритная длина с учётом эллиптических днищ, мм. */
  overallLengthMm: number | null
  elevationMm: number
  shaftDiameterMm: number
  shaftHeightMm: number
  /** Шахт обслуживания; без шахты — 0. */
  shaftCount: number
  /** Объём двух эллиптических днищ (только горизонтальная), м³. */
  ellipticVolumeM3: number | null
  /** SN по габаритной длине — та же лестница, что у КНС. */
  sn: number | null
}

/** Габариты ёмкости целиком. */
export function computeEmkGeometry(input: EmkGeometryInput): EmkGeometry {
  const { volumeM3, dn, placement, installation, hasShaft } = input

  const horizontal = placement === 'горизонтальное'
  const manual = input.pipeLengthMm
  const pipeLengthMm = typeof manual === 'number' && manual > 0 ? manual : tankPipeLengthMm(volumeM3, dn, horizontal)
  const overallLengthMm = pipeLengthMm == null ? null : pipeLengthMm + (horizontal ? ELLIPTIC_EXTRA_MM : 0)
  const shaft = serviceShaft(installation, hasShaft, {
    diameterMm: input.shaftDiameterMm,
    heightMm: input.shaftHeightMm,
    count: input.shaftCount,
  })

  return {
    pipeLengthMm,
    overallLengthMm,
    elevationMm: tankElevationMm(installation),
    shaftDiameterMm: shaft.diameterMm,
    shaftHeightMm: shaft.heightMm,
    shaftCount: shaft.count,
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
  /**
   * Труба корпуса, мм (эталон H5): с горловиной — рабочая часть, без неё —
   * рабочая часть с возвышением над землёй.
   */
  shellLengthMm: number
  /** Полная глубина: корпус и горловина с возвышением, мм (H5 + N5) — лестница и SN. */
  totalDepthMm: number
  /** Труба горловины, мм (эталон N5): её высота с возвышением; без горловины — 0. */
  neckHeightMm: number
  neckDiameterMm: number
  sn: number | null
}

/**
 * Геометрия колодца — шапка листа «Калькулятор колодца»:
 *
 * ```
 * H5 = IF(горловина = "да"; глубина; глубина + возвышение)   — труба корпуса
 * N5 = IF(горловина = "да"; h горловины + возвышение; 0)    — труба горловины
 * ```
 *
 * Возвышение над землёй идёт в ту трубу, что выходит наверх: с горловиной —
 * в неё, без горловины — в корпус. Раньше горловина с возвышением
 * прибавлялась и к трубе корпуса (DN корпуса), и шла своей трубой: при
 * горловине 1,8 м корпус выходил на 2,1 м длиннее листа. Без горловины,
 * наоборот, возвышение терялось.
 */
export function computeKolGeometry(input: KolGeometryInput): KolGeometry {
  const { workingDepthMm, elevationMm, hasNeck, neckHeightMm, neckDiameterMm, underRoadway } = input

  const shellLengthMm = hasNeck ? workingDepthMm : workingDepthMm + elevationMm
  const neckH = hasNeck ? neckHeightMm + elevationMm : 0
  const totalDepthMm = shellLengthMm + neckH

  return {
    shellLengthMm,
    totalDepthMm,
    neckHeightMm: neckH,
    neckDiameterMm: hasNeck ? neckDiameterMm : 0,
    sn: snByDepth(totalDepthMm, { underRoadway }),
  }
}

/**
 * Масса стеклокомпозитной крышки люка, кг (Библиотека A8):
 * базовая `1 × 1 × 0,006 × 1850 ≈ 11,1 кг` — для типового люка 1 × 1 м.
 * Для круглого люка — площадью круга его диаметра.
 *
 * В листах масса крышки вписана числом: 10 кг у ёмкости (Ø1200, круглый),
 * 11,1 кг у колодца (квадратный 1 × 1 м) — Вопросы_заводу §6и.
 */
export function neckCoverMassKg(neckDiameterMm: number): number {
  const areaM2 = Math.PI * (neckDiameterMm / 2000) ** 2
  return areaM2 * 0.006 * 1850
}
