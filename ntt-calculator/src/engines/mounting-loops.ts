/**
 * Монтажные петли корпуса (узел A10) — по эталону «Шаблон 3.0.xlsx».
 *
 * Во всех трёх калькуляторах одинаково (КНС строки 63–72 и 90–91, ЕМК 61–69
 * и 84–85, колодец 56–64 и 83–84): четыре петли, вариант по DN корпуса —
 * от 2000 мм усиленные по чертежу НТТ 1959, меньше — простые по НТТ 648.
 * Комплект одной петли лежит на листе «Вспомогат. таблицы» (A1:B22), строки
 * расчёта — это он, умноженный на число петель.
 *
 * Работы — полчаса на петлю на изготовление и столько же на монтаж, вверх до
 * целого часа: `ROUNDUP(0,5 × петель)`.
 *
 * У простой петли первая строка таблицы битая (`#N/A` на месте болта):
 * лист её пропускает, пропускаем и мы — в прайсе такой позиции нет.
 */

import { FOT_K_LAMIN } from './fot'
import { roundUp } from './rounding'
import { makeRow, nextId, operationWithFot, type CalcComponent, type MaterializeContext } from './template-kns'
import type { Category } from './types'

interface KitLine {
  category: Category
  name: string
  unit: string
  /** Количество на одну петлю. */
  perLoop: number
}

/** Число петель на корпус — во всех листах эталона четыре. */
export const MOUNTING_LOOPS_COUNT = 4

/** Порог DN, мм, с которого петли усиленные. */
export const REINFORCED_LOOPS_FROM_DN = 2000

/** Ламинирование петель к корпусу — операция с ФОТ, отдельно от метизов. */
const LAMINATION_NAME = 'Ламинирование петель к корпусу'

/**
 * Комплекты одной петли («Вспомогат. таблицы»). Наименования — дословно из
 * прайса: у болта М24 в листе стоит «6ɡ» с латинской ɡ, у гайки М12 —
 * латинские M и H, а прайс хранит их кириллицей и обычной g.
 */
export const MOUNTING_LOOP_KITS = {
  reinforced: {
    title: 'Петли монтажные усиленные по чертежу НТТ 1959',
    lines: [
      { category: 'Метизы', name: 'Болт М24-6gх100.21.Ст20 ГОСТ 7798-70', unit: 'шт', perLoop: 2 },
      { category: 'Метизы', name: 'Шайба 24.21.Ст20 ГОСТ 11371-78', unit: 'шт', perLoop: 2 },
      { category: 'Метизы', name: 'Шайба 24.30х13 Ст20 ГОСТ 6402-70', unit: 'шт', perLoop: 2 },
      { category: 'Метизы', name: 'Гайка М24-7Н.Ст20 ГОСТ 5915-70', unit: 'шт', perLoop: 2 },
      // (2·2·0,03 + 0,2)/4 и 2·0,1/4 — листы на четыре петли, делённые на четыре.
      { category: 'Металлопрокат', name: 'Лист г/к Б-ПН-О-6,0х1500х3000 ГОСТ 19903-74 // Ст3пс ГОСТ 14637-89', unit: 'м²', perLoop: 0.08 },
      { category: 'Металлопрокат', name: 'Лист г/к Б-ПН-О-12,0х1500х3000 ГОСТ 19903-74 // Ст3пс ГОСТ 14637-89', unit: 'м²', perLoop: 0.05 },
      { category: 'Металлопрокат', name: 'Арматура 20-А-I Ст3пс ГОСТ 5781-82 гладкая (А240)', unit: 'м', perLoop: 0.9 },
    ],
    laminationKg: 0.6,
  },
  simple: {
    title: 'Петли монтажные по чертежу НТТ 648',
    lines: [
      { category: 'Метизы', name: 'Болт М12-6gх50.58.12Х18Н10Т ГОСТ 7798-70 (DIN 931, DIN 933)', unit: 'шт', perLoop: 2 },
      { category: 'Метизы', name: 'Гайка М12-7Н.5.016.Ст20 ГОСТ 5915-70', unit: 'шт', perLoop: 2 },
      { category: 'Метизы', name: 'Шайба 12.65Г.029.Ст20 ГОСТ 6402-70', unit: 'шт', perLoop: 2 },
      { category: 'Металлопрокат', name: 'Лист г/к Б-ПН-О-3,0х1500х3000 ГОСТ 19903-74 // Ст3пс ГОСТ 16523-97', unit: 'м²', perLoop: 0.004 },
      { category: 'Металлопрокат', name: 'Лист г/к Б-ПН-О-6,0х1500х3000 ГОСТ 19903-74 // Ст3пс ГОСТ 14637-89', unit: 'м²', perLoop: 0.006 },
      { category: 'Металлопрокат', name: 'Арматура 10-А-I Ст3пс ГОСТ 5781-82 гладкая (А240)', unit: 'м', perLoop: 0.4 },
    ],
    laminationKg: 0.4,
  },
} as const satisfies Record<string, { title: string; lines: readonly KitLine[]; laminationKg: number }>

/** Работы узла — позиции прайса «Собственного производства». */
export const MOUNTING_LOOP_WORKS = {
  make: 'Изготовление Петель монтажных',
  mount: 'Монтаж Петель монтажных',
  lamination: LAMINATION_NAME,
} as const

/** Количество на все петли без двоичного хвоста: 4 × 0,08 = 0,32, а не 0,32000000000000006. */
const times = (perLoop: number, loops: number) => Math.round(perLoop * loops * 1e6) / 1e6

/**
 * Узел A10 «Петли монтажные».
 *
 * @param dn DN корпуса, мм — выбирает вариант петли
 */
export function buildMountingLoops(ctx: MaterializeContext, dn: number): CalcComponent {
  const reinforced = dn >= REINFORCED_LOOPS_FROM_DN
  const kit = reinforced ? MOUNTING_LOOP_KITS.reinforced : MOUNTING_LOOP_KITS.simple
  const loops = MOUNTING_LOOPS_COUNT
  const variant = reinforced
    ? `DN ${dn} ≥ ${REINFORCED_LOOPS_FROM_DN} — усиленные`
    : `DN ${dn} < ${REINFORCED_LOOPS_FROM_DN} — простые`
  const hours = roundUp(0.5 * loops, 0)

  return {
    id: nextId('c'),
    nodeCode: 'A10',
    title: `${kit.title} ×${loops}`,
    enabled: true,
    rows: [
      ...kit.lines.map((l) =>
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: l.category,
          name: l.name,
          unit: l.unit,
          qtyCalc: times(l.perLoop, loops),
          note: `ƒ ${l.perLoop.toLocaleString('ru-RU')} на петлю × ${loops} · ${variant}`,
        }),
      ),
      ...operationWithFot(ctx, {
        category: 'Собственное производство',
        name: LAMINATION_NAME,
        unit: 'кг',
        qtyCalc: times(kit.laminationKg, loops),
        fotK: FOT_K_LAMIN,
        note: `ƒ ${kit.laminationKg.toLocaleString('ru-RU')} кг на петлю × ${loops}`,
      }),
      makeRow(ctx, {
        kind: 'ОПЕРАЦИЯ',
        category: 'Собственное производство',
        name: MOUNTING_LOOP_WORKS.make,
        unit: 'чел. ч',
        qtyCalc: hours,
        note: `ƒ ROUNDUP(0,5 × ${loops} петли)`,
      }),
      makeRow(ctx, {
        kind: 'ОПЕРАЦИЯ',
        category: 'Собственное производство',
        name: MOUNTING_LOOP_WORKS.mount,
        unit: 'чел. ч',
        qtyCalc: hours,
        note: `ƒ ROUNDUP(0,5 × ${loops} петли)`,
      }),
    ],
  }
}
