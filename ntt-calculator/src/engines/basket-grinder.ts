/**
 * Корзина сороудерживающая (узел D3) и дробилка (D4) — по эталону
 * «Шаблон 3.0.xlsx». Состав сверен построчно:
 *
 *   КНС — лист «Калькулятор КНС»: дробилка 74–83 и 93, корзина 101–113;
 *   ЕМК — «Калькулятор ЕМК»: корзина 94–106, дробилки в листе нет;
 *   КОЛ — «Калькулятор колодца»: дробилка 67–75, корзина 93–105.
 *
 * Раньше у ЕМК и колодца корзина была четырьмя строками работ с нормативами
 * «уточните» (8/4/4/2 чел.ч), а у КНС её не было вовсе: тумблер ОЛ ни на что
 * не влиял. Нормативы в эталоне были всё это время: 6 и 5 чел.ч при DN < 2500,
 * 7 и 6 — при большем, направляющие — 2 + 2.
 *
 * Корзина и дробилка опускаются на цепи от поверхности к лотку подводящего
 * трубопровода, поэтому цепь и направляющие считаются от его глубины (ОЛ КНС
 * «Глубина залегания подводящего трубопровода А», ОЛ ёмкости и колодца
 * «Глубина залегания H лотка»):
 *
 *   цепь         = ROUNDUP(H/1000 + 1) м — метр запаса на подъём;
 *   направляющие = ROUNDUP(2·H/1000) м  — две штанги на всю глубину.
 *
 * Без глубины эти строки не выдумываются: количество остаётся пустым,
 * примечание просит заполнить поле ОЛ.
 *
 * Такелаж у изделий разный, и это не ошибка переноса — так в листах: у КНС
 * кольца и скобы (корзина) или кольца и карабин на каждый метр (дробилка),
 * у ёмкости и колодца — пруток «Круг 5 мм» и карабин на два метра цепи.
 */

import { FOT_K_MANUAL, FOT_K_MECH } from './fot'
import { laminationMassKg } from './formulas'
import { roundUp } from './rounding'
import {
  makeRow,
  nextId,
  operationWithFot,
  surveyToggled,
  type CalcComponent,
  type CalcRowNode,
  type MaterializeContext,
} from './template-kns'
import type { Category } from './types'

/** Изделие, под которое собирается узел: такелаж у них разный. */
export type BasketDevice = 'KNS' | 'EMK' | 'KOL'

interface Item {
  category: Category
  name: string
  unit: string
}

/**
 * Позиции прайса узлов. Наименования — ДОСЛОВНО из прайса: ключ поиска цены
 * `категория|наименование|ЕИ`, и опечатка не падает, а даёт «красную» строку.
 * В «Круг 5 мм … ГOCT» буквы «OCT» латинские — так в прайсе.
 */
export const BASKET_GRINDER_ITEMS = {
  basketAngle: { category: 'Металлопрокат', name: 'Уголок 20х20х1,5мм 08Х18Н10Т(AISI304) ГОСТ 8509-93', unit: 'м' },
  perforatedSheet: {
    category: 'Металлопрокат',
    name: 'Лист нержавеющий перфорированный 1х1000х2000мм Qg 10.0-12.0 марка 10х18н10',
    unit: 'м²',
  },
  basketGuidePipe: {
    category: 'Металлопрокат',
    // Между «(AISI 321)» и «(бесшовная» в прайсе неразрывный пробел и
    // обычный — escape вместо невидимого символа, чтобы его не «поправили».
    name: 'Труба 45х3,0 ГОСТ 9941-81 ст 12Х18Н10Т (AISI 321)\u00a0 (бесшовная холоднодеформированная) ГОСТ 9941-81',
    unit: 'м',
  },
  /**
   * В листе КНС — «…А4 5Х50», но такой позиции в прайсе нет, и эталон
   * считал её за 0 ₽ (VLOOKUP под IFERROR). Кольцо 5 мм в прайсе одно —
   * 5Х30; оно и берётся, строка помечается «уточните».
   */
  basketRing: { category: 'Грузоподъем', name: 'Кольцо сварное полированное АРТ 8229 А4 5Х30', unit: 'шт' },
  basketChain: { category: 'Грузоподъем', name: 'Цепь короткозвенная сварная 3 мм DIN 766 А2/А4', unit: 'м' },
  basketShackle: { category: 'Грузоподъем', name: 'Скоба такелажная прямая М6', unit: 'шт' },
  roundBar: { category: 'Металлопрокат', name: 'Круг 5 мм 12Х18Н10Т ГOCT 5949-75', unit: 'м' },
  carabiner: { category: 'Грузоподъем', name: 'Карабин винтовой 5 мм нерж. А4 ART 8253', unit: 'шт' },

  grinderAngle: { category: 'Металлопрокат', name: 'Уголок 50х50х5мм 12Х18Н10Т (AISI304) ГОСТ 8509-93', unit: 'м' },
  grinderFramePipe: { category: 'Металлопрокат', name: 'Труба 60х30х2мм 12Х18Н10Т ГОСТ 8639-82', unit: 'м' },
  grinderRing: { category: 'Грузоподъем', name: 'Кольцо сварное полированное АРТ 8229 А4 10Х60', unit: 'шт' },
  grinderChain: { category: 'Грузоподъем', name: 'Цепь короткозвенная сварная 5 мм DIN 766 А2/А4', unit: 'м' },
} as const satisfies Record<string, Item>

/** Работы узлов — тоже позиции прайса (категория «Собственное производство»). */
export const BASKET_GRINDER_WORKS = {
  basketMake: 'Изготовление Сороудерживающей корзины',
  basketMount: 'Монтаж Сороудерживающей корзины',
  guidesMake: 'Изготовление направляющих корзины',
  guidesMount: 'Монтаж направляющих корзины',
  grinderGuidesMount: 'Монтаж направляющих дробилки',
  grinderChannel: 'Механическая формовка деталей канала под дробилку',
  grinderLamination: 'Ламинирование деталей площадки под дробилку в сборке',
} as const

/**
 * Масса формованных деталей канала под дробилку, кг: 4,7 м² листа толщиной
 * 7 мм при плотности 1850 кг/м³ = 60,9 кг. Формула — из листа колодца
 * (H68); в образце КНС на её месте вписано вручную 60.
 */
export const GRINDER_CHANNEL_MASS_KG = 4.7 * 0.007 * 1850

/** Длина цепи, м: от поверхности до лотка плюс метр на подъём. */
export function chainLengthM(trayDepthMm: number): number {
  return roundUp(trayDepthMm / 1000 + 1, 0)
}

/** Направляющие, м: две штанги на всю глубину лотка. */
export function guideLengthM(trayDepthMm: number): number {
  return roundUp((2 * trayDepthMm) / 1000, 0)
}

/**
 * Пруток «Круг 5 мм», м: 3,14 × 0,05 м на метр цепи. В эталоне стоит
 * именно 3,14, а не π; результат округлён до миллиметра — дробный хвост
 * двоичной арифметики иначе доехал бы до КП.
 */
export function roundBarLengthM(chainM: number): number {
  return Math.round(chainM * 3.14 * 0.05 * 1000) / 1000
}

/** Глубина лотка, пригодная для расчёта; иначе `null`. */
function validDepth(mm: number | null | undefined): number | null {
  return typeof mm === 'number' && Number.isFinite(mm) && mm > 0 ? mm : null
}

const NO_DEPTH = 'укажите в ОЛ глубину лотка подводящего — от неё длина цепи и направляющих'

const fmtM = (mm: number) => (mm / 1000).toLocaleString('ru-RU')

function material(ctx: MaterializeContext, item: Item, qtyCalc: number | null, note: string): CalcRowNode {
  return makeRow(ctx, { kind: 'МАТЕРИАЛ', ...item, qtyCalc, note })
}

function work(ctx: MaterializeContext, name: string, qtyCalc: number, note: string): CalcRowNode {
  return makeRow(ctx, {
    kind: 'ОПЕРАЦИЯ',
    category: 'Собственное производство',
    name,
    unit: 'чел. ч',
    qtyCalc,
    note,
  })
}

// ─── Корзина ─────────────────────────────────────────────────────────────────

export interface BasketParams {
  device: BasketDevice
  /** DN корпуса, мм — от него нормы изготовления и монтажа корзины. */
  dn: number
  /** Глубина лотка подводящего трубопровода, мм. */
  trayDepthMm: number | null | undefined
  /** Корзина выбрана в ОЛ. Выключенный узел остаётся «призраком». */
  enabled: boolean
  /**
   * Вместе с корзиной стоит дробилка (у КНС). Тогда эталон трубу
   * направляющих корзины не считает: строка 105 листа КНС даёт её только
   * при «Корзина для мусора» без дробилки.
   */
  withGrinder?: boolean
}

export function buildBasket(ctx: MaterializeContext, p: BasketParams): CalcComponent {
  const I = BASKET_GRINDER_ITEMS
  const W = BASKET_GRINDER_WORKS
  const depth = validDepth(p.trayDepthMm)
  const chain = depth == null ? null : chainLengthM(depth)
  const small = p.dn < 2500

  let guides: { qty: number | null; note: string }
  if (p.device === 'KNS' && p.withGrinder) {
    guides = { qty: 0, note: 'при корзине вместе с дробилкой эталон направляющие корзины не считает (лист КНС, строка 105)' }
  } else if (depth == null) {
    guides = { qty: null, note: NO_DEPTH }
  } else {
    guides = { qty: guideLengthM(depth), note: `ƒ ROUNDUP(2 × ${fmtM(depth)} м): две направляющие на глубину лотка` }
  }

  const chainNote = chain == null ? NO_DEPTH : `ƒ ROUNDUP(${fmtM(depth!)} м + 1 м на подъём)`

  const rigging: CalcRowNode[] =
    p.device === 'KNS'
      ? [
          material(
            ctx,
            I.basketRing,
            chain,
            chain == null
              ? NO_DEPTH
              : `ƒ по кольцу на метр цепи · в эталоне «5Х50»: такой позиции в прайсе нет, лист считал её за 0 ₽; ` +
                  'взято кольцо 5Х30, единственное 5-мм в прайсе — уточните артикул',
          ),
          material(ctx, I.basketChain, chain, chainNote),
          material(ctx, I.basketShackle, chain, chain == null ? NO_DEPTH : 'ƒ по скобе на метр цепи'),
        ]
      : [
          material(ctx, I.roundBar, chain == null ? null : roundBarLengthM(chain), chain == null ? NO_DEPTH : `ƒ цепь ${chain} м × 3,14 × 0,05`),
          material(ctx, I.basketChain, chain, chainNote),
          material(ctx, I.carabiner, chain == null ? null : roundUp(chain / 2, 0), chain == null ? NO_DEPTH : 'ƒ по карабину на два метра цепи'),
        ]

  // У ёмкости и колодца формула норм ссылается на пустую ячейку (G2 и G1
  // вместо DN в G5 — сдвиг при копировании блока из листа КНС) и даёт 6 и 5
  // при любом DN. Замысел виден по листу КНС: ступень на DN 2500.
  const dnNote = `DN ${p.dn} ${small ? '<' : '≥'} 2500`

  return {
    id: nextId('c'),
    nodeCode: 'D3',
    title: 'Корзина сороудерживающая',
    ...surveyToggled(p.enabled),
    rows: [
      material(ctx, I.basketAngle, 10, 'ƒ норматив эталона: 10 м на корзину'),
      material(ctx, I.perforatedSheet, 2, 'ƒ норматив эталона: 2 м² на корзину'),
      material(ctx, I.basketGuidePipe, guides.qty, guides.note),
      ...rigging,
      work(ctx, W.basketMake, small ? 6 : 7, `ƒ норматив эталона: ${small ? 6 : 7} чел.ч при ${dnNote}`),
      work(ctx, W.basketMount, small ? 5 : 6, `ƒ норматив эталона: ${small ? 5 : 6} чел.ч при ${dnNote}`),
      work(ctx, W.guidesMake, 2, 'ƒ норматив эталона: 2 направляющие — 2 чел.ч'),
      work(ctx, W.guidesMount, 2, 'ƒ норматив эталона: 2 направляющие — 2 чел.ч'),
    ],
  }
}

// ─── Дробилка ────────────────────────────────────────────────────────────────

export interface GrinderParams {
  /** В листе ёмкости узла дробилки нет — только КНС и колодец. */
  device: 'KNS' | 'KOL'
  trayDepthMm: number | null | undefined
  /** DN подводящего трубопровода, мм — от него труба рамы у КНС. */
  inletDn?: number
  enabled: boolean
}

/**
 * Канал под дробилку, её направляющие и подвес. Сам измельчитель (ПОТОК
 * П-200…П-800) эталон не материализует — модель подбирается по притоку и
 * добавляется в «Оборудование» из каталога.
 */
export function buildGrinder(ctx: MaterializeContext, p: GrinderParams): CalcComponent {
  const I = BASKET_GRINDER_ITEMS
  const W = BASKET_GRINDER_WORKS
  const depth = validDepth(p.trayDepthMm)
  const chain = depth == null ? null : chainLengthM(depth)
  const chainNote = chain == null ? NO_DEPTH : `ƒ ROUNDUP(${fmtM(depth!)} м + 1 м на подъём)`
  const mass = GRINDER_CHANNEL_MASS_KG

  const rows: CalcRowNode[] = [
    ...operationWithFot(ctx, {
      category: 'Собственное производство',
      name: W.grinderChannel,
      unit: 'кг',
      qtyCalc: mass,
      fotK: FOT_K_MECH,
      note: 'ƒ 4,7 м² × 7 мм × 1850 кг/м³ (лист колодца; в образце КНС вписано 60 кг)',
    }),
    ...operationWithFot(ctx, {
      category: 'Собственное производство',
      name: W.grinderLamination,
      unit: 'кг',
      qtyCalc: laminationMassKg(mass),
      // В эталоне у этой строки особый коэффициент: 1, а не 0,56, как у
      // прочего ламинирования («Коэффициент ламинации 1»).
      fotK: FOT_K_MANUAL,
      note: 'ƒ масса канала × 3/10 · ФОТ с коэффициентом 1, как в эталоне',
    }),
    material(
      ctx,
      I.grinderAngle,
      depth == null ? null : guideLengthM(depth),
      depth == null ? NO_DEPTH : `ƒ ROUNDUP(2 × ${fmtM(depth)} м): две направляющие на глубину лотка`,
    ),
  ]

  if (p.device === 'KNS') {
    const dn = typeof p.inletDn === 'number' && p.inletDn > 0 ? p.inletDn : null
    rows.push(
      material(
        ctx,
        I.grinderFramePipe,
        dn == null ? null : roundUp((2 * dn) / 1000, 0),
        dn == null
          ? 'ƒ ROUNDUP(2 × DА/1000) — укажите в ОЛ DN подводящего'
          : `ƒ ROUNDUP(2 × DА ${dn}/1000) — формула эталона; в образце КНС вписано 11 м, уточните по чертежу`,
      ),
      material(ctx, I.grinderRing, chain, chain == null ? NO_DEPTH : 'ƒ по кольцу на метр цепи'),
      material(ctx, I.grinderChain, chain, chainNote),
      material(ctx, I.carabiner, chain, chain == null ? NO_DEPTH : 'ƒ по карабину на метр цепи'),
      work(ctx, W.grinderGuidesMount, 2, 'ƒ норматив эталона: 2 направляющие — 2 чел.ч'),
    )
  } else {
    rows.push(
      material(ctx, I.roundBar, chain == null ? null : roundBarLengthM(chain), chain == null ? NO_DEPTH : `ƒ цепь ${chain} м × 3,14 × 0,05`),
      material(ctx, I.grinderChain, chain, chainNote),
      material(ctx, I.carabiner, chain == null ? null : roundUp(chain / 2, 0), chain == null ? NO_DEPTH : 'ƒ по карабину на два метра цепи'),
    )
  }

  return {
    id: nextId('c'),
    nodeCode: 'D4',
    title: 'Дробилка: канал и направляющие',
    ...surveyToggled(p.enabled),
    rows,
  }
}
