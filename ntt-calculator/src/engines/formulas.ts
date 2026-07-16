/**
 * Реестр формул количеств (Библиотека §4, ТЗ §9.4).
 *
 * Именованные чистые функции — DSL сознательно НЕ вводится (Библиотека §6.4):
 * состав узлов каталога ссылается на формулы по имени (`formulaRef`), но сами
 * формулы живут в коде. Новый компонент из существующих формул — запись в
 * каталоге без релиза; принципиально новая формула — через релиз.
 *
 * Первоисточник — «Шаблон 3.0.xlsx», лист «Калькулятор КНС»; сводка формул —
 * `doc/Реверс_калькуляторов.md` §4.3.
 */

// ─── Балансные константы (Механика §13) ─────────────────────────────────────

/** Плотность ламината, кг/м³. */
export const LAMINATE_DENSITY = 1850

/** Норма ламинирования детали к корпусу — 3/10 массы детали. */
export const LAMINATION_SHARE = 3 / 10

/** Норма «придания товарного вида», чел.ч на 1 м трубы: DN/1300. */
export const MARKETABLE_DIVISOR = 1300

/** Прорезка отверстия — 0,5 чел.ч на 1 м окружности. */
export const CUTOUT_HOURS_PER_M = 0.5

/** Подготовка трубы, чел.ч на 1 м: DN/(200·6). */
export const PIPE_PREP_DIVISOR = 200 * 6

/** Несущая способность анкера М16, Н (расчёт всплытия). */
export const ANCHOR_CAPACITY_N = 27_500

/** Плотность воды, кг/м³ — для расчёта выталкивающей силы. */
const WATER_DENSITY = 1000

/** Ускорение свободного падения, м/с² (значение из эталона). */
const G = 9.8

// ─── Корпус ──────────────────────────────────────────────────────────────────

/**
 * Длина трубы корпуса, м (эталон `I14 = L/1000`).
 *
 * @param depthMm глубина подземной части (Нподз), мм
 */
export function pipeLengthM(depthMm: number): number {
  return depthMm / 1000
}

/**
 * Масса трубы корпуса, кг: `длина × вес_пм(DN; PN_трубы; SN)`.
 *
 * Вес погонного метра приходит из справочника (`PipeWeight`), поиск — по
 * PN_ТРУБЫ (автоподбор `F7`), а не по PN опросного листа (ТЗ §9.4).
 * `null` — промах справочника: строка станет «красной».
 */
export function pipeMassKg(lengthM: number, kgPerM: number | null): number | null {
  return kgPerM == null ? null : lengthM * kgPerM
}

/**
 * Придание изделию товарного вида, чел.ч (эталон `I15 = DN/1300 × J14`).
 *
 * Контроль (ОЛ3487): DN 3000, L 11,6 м → 26,8 чел.ч (README хендоффа).
 */
export function marketableAppearanceHours(dn: number, lengthM: number): number {
  return (dn / MARKETABLE_DIVISOR) * lengthM
}

/**
 * Подготовка трубы, чел.ч (Реверс §4.3: `(DN/(200·6))·L`).
 */
export function pipePrepHours(dn: number, lengthM: number): number {
  return (dn / PIPE_PREP_DIVISOR) * lengthM
}

/**
 * Масса формованного дна, кг (эталон `I22`):
 *
 * ```
 * π·((DN+300)/2000)²·0,01·1850  +  ((DN/1000)²·π·0,008·1850)/4
 * ```
 *
 * Контроль: DN 3000 → 262,845 кг (README хендоффа показывает 262,8).
 */
export function bottomMassKg(dn: number): number {
  const dish = Math.PI * ((dn + 300) / 2000) ** 2 * 0.01 * LAMINATE_DENSITY
  const flat = ((dn / 1000) ** 2 * Math.PI * 0.008 * LAMINATE_DENSITY) / 4
  return dish + flat
}

/**
 * Ламинирование детали к корпусу, кг: `масса_детали × 3/10`.
 *
 * Контроль: дно DN3000 (262,845) → 78,85 кг (README показывает 78,9).
 */
export function laminationMassKg(partMassKg: number): number {
  return partMassKg * LAMINATION_SHARE
}

/**
 * Масса верхнего перекрытия, кг (Реверс §4.3):
 * `π·((DN+300)/2000)²·0,006·1850 − масса_горловины × кол-во_люков`.
 */
export function topSlabMassKg(dn: number, hatchMassKg = 0, hatchCount = 0): number {
  const slab = Math.PI * ((dn + 300) / 2000) ** 2 * 0.006 * LAMINATE_DENSITY
  return slab - hatchMassKg * hatchCount
}

// ─── Теплоизоляция (компонент A9) ───────────────────────────────────────────

export interface InsulationResult {
  /** Вертикальная поверхность, м². */
  verticalM2: number
  /** Крышка, м². */
  lidM2: number
  /** Итого площадь, м². */
  totalM2: number
  /** Защитный слой ламинации, кг. */
  protectiveLayerKg: number
  /** Монтаж, чел.ч (норма 1 чел.ч на 1 м²). */
  mountingHours: number
}

/**
 * Теплоизоляция корпуса (Реверс §4.3, Библиотека A9).
 *
 * ```
 * вертикаль      = π·(DN/1000)·(глубина_ТИ/1000)   м²
 * крышка         = π·(DN/2000)²                    м²
 * защитный слой  = S·0,005·1850                    кг   (для КНС; у колодца 0,004)
 * монтаж         = 1 чел.ч на 1 м²
 * ```
 */
export function insulation(
  dn: number,
  insulationDepthMm: number,
  opts: { protectiveThickness?: number } = {},
): InsulationResult {
  const { protectiveThickness = 0.005 } = opts

  const verticalM2 = Math.PI * (dn / 1000) * (insulationDepthMm / 1000)
  const lidM2 = Math.PI * (dn / 2000) ** 2
  const totalM2 = verticalM2 + lidM2

  return {
    verticalM2,
    lidM2,
    totalM2,
    protectiveLayerKg: totalM2 * protectiveThickness * LAMINATE_DENSITY,
    mountingHours: totalM2,
  }
}

// ─── Патрубки ────────────────────────────────────────────────────────────────

/**
 * Прорезка отверстия, чел.ч (Реверс §4.3): `Ø·π/1000 × 0,5 × кол-во`
 * — 0,5 чел.ч на 1 м окружности.
 *
 * @param diameterMm диаметр отверстия (гильзы), мм
 */
export function cutoutHours(diameterMm: number, count = 1): number {
  const circumferenceM = (diameterMm * Math.PI) / 1000
  return circumferenceM * CUTOUT_HOURS_PER_M * count
}

// ─── Оборудование ────────────────────────────────────────────────────────────

/**
 * Направляющие насосов, м (Реверс §4.3): `L × (раб + рез) × 2`.
 */
export function pumpGuidesM(depthM: number, pumpsWorking: number, pumpsReserve: number): number {
  return depthM * (pumpsWorking + pumpsReserve) * 2
}

/**
 * Кол-во анкеров против всплытия, шт (Реверс §4.3, Библиотека B6):
 *
 * ```
 * (глубина·1000·9,8·π·Дн²/4) / 27500
 * ```
 *
 * Физически: выталкивающая сила V·ρ·g, где V = π·Дн²/4·глубина, делённая на
 * несущую способность одного анкера М16 (27 500 Н).
 *
 * @param outerDiameterM наружный диаметр, м
 * @param depthM         глубина погружения, м
 */
export function anchorCount(outerDiameterM: number, depthM: number): number {
  const volumeM3 = ((Math.PI * outerDiameterM ** 2) / 4) * depthM
  const buoyancyN = volumeM3 * WATER_DENSITY * G
  return buoyancyN / ANCHOR_CAPACITY_N
}

/**
 * Лестница (Библиотека B1): длина = H (+ горловина); материал = (H₁+H₂)·2 м;
 * изготовление = 1,25·H чел.ч; монтаж = изготовление/2.
 */
export function ladder(heightM: number, neckHeightM = 0) {
  const totalH = heightM + neckHeightM
  const fabricationHours = 1.25 * totalH
  return {
    lengthM: totalH,
    materialM: totalH * 2,
    fabricationHours,
    mountingHours: fabricationHours / 2,
  }
}
