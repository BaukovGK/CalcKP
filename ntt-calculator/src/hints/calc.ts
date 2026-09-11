/**
 * Сноски экрана расчёта: строка таблицы, итоги, фильтры.
 *
 * Строка объясняет себя сама: откуда количество (формула шаблона, ручное
 * выражение, конфликт с ОЛ), откуда цена (прайс, ручная, поле ОЛ) и в какую
 * корзину итогов она идёт. Формулы итогов — эталон «Шаблон 3.0.xlsx», лист
 * «Калькулятор КНС», строки 441–458 (engines/economics.ts).
 */

import type { Hint } from '@/directives/hint'
import { classifyRow, type CostBucket } from '@/engines/economics'
import { computeRow } from '@/engines/row'
import type { CalcRowNode } from '@/engines/template-kns'
import type { PriceBinding, RowResult } from '@/engines/types'
import { UNIT_HOURS, UNIT_MASS } from '@/engines/types'

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
const fmtK = (k: number) => k.toLocaleString('ru-RU', { minimumFractionDigits: 2 })

/** Поле ОЛ, с которым связана цена строки, — подпись как на экране листа. */
export const BOUND_FIELD_LABEL: Record<PriceBinding, string> = {
  pipePrice: '«Цена трубы, ₽/м.п.» (труба корпуса)',
  pumpPrice: '«Цена насоса, ₽/шт»',
  servicePipePrice: '«Цена трубы» шахты или горловины',
}

/** Что делает коэффициент ФОТ — по значению (engines/fot.ts). */
function fotKMeaning(k: number): string {
  if (k === 0.28) return 'механическая формовка'
  if (k === 0.56) return 'ламинирование'
  return 'ручная формовка и особые ламинирования'
}

/** Корзина строки на языке итогов: почему строка попала именно туда. */
function bucketReason(row: CalcRowNode): string {
  const bucket = classifyRow(row)
  if (row.bucket === 'Труба, муфта') return 'В итогах — «Труба, муфта»: труба и муфты корпуса выделены отдельно.'
  if (row.unit === UNIT_HOURS) return 'В итогах — «Работы, ФОТ» (ЕИ «чел. ч»); часы идут и в ПЗР, СИЗ и накладные.'
  if (row.unit === UNIT_MASS) return 'В итогах — «Формовка» (ЕИ «кг»); 5 % массы уходит в ацетон.'
  return `В итогах — «${bucket}» (ЕИ «${row.unit}»).`
}

export interface RowHintContext {
  conflict: boolean
  /** Расчётное до правки ОЛ — у строки в конфликте. */
  prevCalc: number | null
  /** Коэффициент ФОТ — у спутника. */
  fotK: number | null
  /** Родительская операция спутника: её масса — основа часов. */
  parent?: CalcRowNode | null
  /** Раздел или узел выключен. */
  disabled: boolean
  tirage: number
  /** Цена прайса сдвинулась при пересчёте, отметка не принята. */
  priceDelta?: boolean
  /** Прежняя цена прайса; `null` — её не было. */
  pricePrev?: number | null
}

/**
 * Сноска строки расчёта: полное наименование (в таблице оно обрезано),
 * количество, цена, сумма и корзина итогов.
 */
export function calcRowHint(row: CalcRowNode, res: RowResult, ctx: RowHintContext): Hint {
  const text: string[] = []
  const formula: string[] = []
  let tone: Hint['tone']

  const isSatellite = row.kind === 'ФОТ' && row.parentId != null

  if (ctx.disabled) {
    text.push('Узел или раздел выключен — строка в итог не входит, ручные значения сохранены.')
  }

  // ── Количество ──
  if (isSatellite && ctx.fotK != null) {
    // Масса родителя — за один корпус и с его ручной правкой: так её берёт
    // пересчёт спутников (engines/fot.ts).
    const parentQty = ctx.parent ? computeRow(ctx.parent, { tirage: 1 }).qty : null
    const base = ctx.parent ? `«${ctx.parent.name}»` : 'масса операции'
    formula.push(
      `${base} ${fmt(parentQty)} ${ctx.parent?.unit ?? 'кг'} × k ${fmtK(ctx.fotK)} = ${fmt(row.qtyCalc)} чел.ч, вверх до 0,1`,
    )
    text.push(`ФОТ-спутник: часы считаются от массы операции, k ${fmtK(ctx.fotK)} — ${fotKMeaning(ctx.fotK)}.`)
  }
  if (ctx.conflict) {
    tone = 'warn'
    text.push(
      `Конфликт: опросный лист изменил расчётное количество (${fmt(ctx.prevCalc)} → ${fmt(row.qtyCalc)}), а здесь стоит ручное. ` +
        '«Оставить моё» сохранит ручное, «Принять новое» вернёт расчётное.',
    )
  }
  if (res.qtyOverridden) {
    tone ??= 'ovr'
    text.push(`Количество введено вручную: «${row.qtyManual}». Расчётное — ${fmt(row.qtyCalc)}, ↺ вернёт его.`)
  } else if (row.qtyCalc == null && !isSatellite) {
    text.push('Количество шаблон не выводит — введите его.')
  }
  if (row.note) {
    // Примечание шаблона — формула («ƒ …») или пояснение, откуда число.
    if (row.note.startsWith('ƒ')) formula.push(row.note.replace(/^ƒ\s*/, ''))
    else text.push(row.note)
  }
  if (ctx.tirage >= 2) text.push(`Тираж ${ctx.tirage} корпусов: количество в таблице — на все корпуса.`)

  // ── Цена ──
  if (res.missingPrice) {
    tone = 'error'
    text.push('Цены нет ни в прайсе, ни вручную: строка «красная» и не даёт выпустить КП. Введите цену в ячейку.')
  } else if (row.priceBinding) {
    text.push(`Цена связана с полем опросного листа ${BOUND_FIELD_LABEL[row.priceBinding]}: правка здесь вернётся туда, и наоборот.`)
  } else if (res.priceOverridden) {
    tone ??= 'ovr'
    text.push(`Цена введена вручную: ${fmt(res.price)} ₽. В прайсе — ${fmt(row.priceCatalog)} ₽, ↺ вернёт её.`)
  } else {
    text.push(`Цена — из прайса по категории «${row.category}», наименованию и ЕИ: ${fmt(res.price)} ₽ за ${row.unit}.`)
  }
  if (ctx.priceDelta) {
    tone ??= 'warn'
    const was = ctx.pricePrev == null ? 'цены в прайсе не было' : `было ${fmt(ctx.pricePrev)} ₽`
    text.push(
      res.priceOverridden
        ? `Прайс под ручной ценой сдвинулся при пересчёте: ${was}, стало ${fmt(row.priceCatalog)} ₽. Применяется ручная — ${fmt(res.price)} ₽; ✓ снимет отметку.`
        : `Цена прайса изменилась при пересчёте по новой версии: ${was}, стало ${fmt(row.priceCatalog)} ₽. ✓ — принять новую, ↶ — оставить прежнюю ручной ценой.`,
    )
  }
  if (!res.missingPrice && res.qty) formula.push(`сумма = ${fmt(res.qty)} × ${fmt(res.price)} = ${fmt(res.sum)} ₽`)

  text.push(bucketReason(row))

  // У спутника имя «ФОТ» ничего не говорит — в заголовке его операция.
  const title = isSatellite && ctx.parent ? `ФОТ · ${ctx.parent.name}` : row.name
  return { title, text, formula, tone }
}

/** Сноски итогов — по корзинам и строкам панели. */
export const BUCKET_HINTS: Record<CostBucket, Hint> = {
  'Материалы на закупку': {
    title: 'Материалы на закупку',
    text: 'Покупные позиции: строки в штуках, метрах, м² и комплектах — всё, что не «кг» и не «чел. ч», кроме трубы и муфт корпуса.',
    formula: 'Σ кол-во × цена',
  },
  'Труба, муфта': {
    title: 'Труба, муфта',
    text: 'Стеклопластиковая труба корпуса, её сегменты, труба шахты или горловины и муфты. Цена трубы договорная — из поля опросного листа.',
    formula: 'Σ метры × цена за метр',
  },
  Формовка: {
    title: 'Формовка',
    text: 'Строки в килограммах: формовка и ламинирование. Та же масса даёт ацетон в «Прочих».',
    formula: 'Σ масса × цена за кг',
  },
  'Работы, ФОТ': {
    title: 'Работы, ФОТ',
    text: 'Строки в человеко-часах — работы и ФОТ-спутники — плюс ПЗР.',
    formula: 'Σ чел.ч × ставка + ПЗР',
    source: 'Эталон N453 = N441 + N443 + N442',
  },
  'Прочие затраты': {
    title: 'Прочие затраты',
    text: 'Ацетон, СИЗ и накладные. Своих строк у них нет — считаются от итогов; разложение — в «Прочие — из чего».',
    formula: 'ацетон + СИЗ и РМ + накладные',
    source: 'Эталон N455',
  },
}

export const TOTAL_HINTS = {
  cost: {
    title: 'Себестоимость',
    text: 'Сумма пяти корзин. НДС отдельно не выделяется: цены прайса — с НДС.',
    formula: 'материалы + труба и муфта + формовка + работы и ФОТ + прочие',
    source: 'Эталон N449',
  },
  markup: {
    title: 'Наценка',
    text: 'Доля к себестоимости: 0,43 — это +43 %. Сохраняется вместе с расчётом.',
    formula: 'цена продажи = ROUNDUP(себестоимость × (1 + наценка); до 100 ₽)',
  },
  price: {
    title: 'Цена продажи',
    text: 'Себестоимость с наценкой, округлённая вверх до 100 ₽. Идёт в КП.',
    formula: 'ROUNDUP(себестоимость × (1 + наценка); −2)',
    source: 'Эталон N457',
  },
  profitability: {
    title: 'Рентабельность',
    text: 'Доля прибыли в цене. Зелёная от 25 %, янтарная от 15 %, ниже — красная.',
    formula: '(цена − себестоимость) / цена',
    source: 'Эталон N458',
  },
  tirage: {
    title: 'Корпусов',
    text: 'Тираж: все количества умножаются на число корпусов, итоги — за весь тираж.',
  },
  perUnit: {
    title: 'Цена одного корпуса',
    text: 'Считается отдельным прогоном с тиражом 1: ПЗР, СИЗ и округления не делятся на число корпусов поровну.',
  },
  pzr: {
    title: 'ПЗР — подготовительно-заключительные работы',
    text: 'Входят в «Работы, ФОТ», а не в «Прочие».',
    formula: 'ROUNDUP(часы работ без «изготов» / 11; 0,1) × ставка ФОТ',
    source: 'Эталон J443',
  },
  acetone: {
    title: 'Ацетон',
    formula: 'ROUNDUP(масса формовки × 0,05; 0,1) кг × цена ацетона',
    source: 'Эталон J445; цена — позиция прайса',
  },
  ppe: {
    title: 'СИЗ и расходные материалы',
    text: 'Константа 302 — из эталона, её смысл уточняется у завода.',
    formula: 'ROUNDUP(часы работ без «изготов» + 302) ед. × цена СИЗ и РМ',
    source: 'Эталон J446',
  },
  overhead: {
    title: 'Накладные',
    formula: 'ROUNDUP(часы работ без «изготов» + ПЗР; 0,1) × ставка накладных',
    source: 'Эталон J447; ставка — позиция прайса',
  },
} satisfies Record<string, Hint>

/** Фильтры и счётчики над таблицей. */
export const FILTER_HINTS = {
  missing: {
    title: 'Без цены',
    text: 'Строки без цены прайса и без ручной. Пока они есть, КП не выпустить.',
    tone: 'error',
  },
  conflict: {
    title: 'Конфликты',
    text: 'Опросный лист изменил расчётное количество у строки, где стоит ручное. Решите в строке: оставить своё или принять новое.',
    tone: 'warn',
  },
  override: {
    title: 'Ручной ввод',
    text: 'Строки, где количество или цена введены вручную (синие). ↺ в ячейке возвращает расчётное.',
    tone: 'ovr',
  },
  repriced: {
    title: 'Цены изменились',
    text: 'Строки, у которых пересчёт по новой версии прайса сдвинул цену. В строке ✓ принимает новую цену, ↶ оставляет прежнюю ручной.',
    tone: 'warn',
  },
  ghosts: {
    title: 'Выключенные',
    text: 'Показать строки выключенных разделов и узлов. В итог они не входят; ручные значения в них сохраняются.',
  },
} satisfies Record<string, Hint>
