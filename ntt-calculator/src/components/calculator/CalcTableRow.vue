<template>
  <div class="r" :class="rowClass">
    <!-- Категория-чип -->
    <div class="c-cat"><span class="chip" :title="row.category">{{ row.category }}</span></div>

    <!-- Наименование; ФОТ-спутник — с отступом и меткой -->
    <div class="c-name" :class="{ 'is-sat': isSatellite }">
      <span class="nm" :title="row.name">{{ row.name }}</span>
      <span v-if="isSatellite && fotK != null" class="sat-tag">ФОТ · k={{ fmtK(fotK) }}</span>
    </div>

    <!-- Кол-во -->
    <div class="c-qty">
      <button v-if="res.qtyOverridden && !readonly" class="rst" :title="qtyResetTitle" @click="$emit('resetQty', row.id)">↺</button>
      <input
        class="cell num"
        :class="{ 'is-ovr': res.qtyOverridden, 'is-conflict': conflict }"
        :value="qtyText"
        :disabled="disabled || readonly"
        :title="qtyTitle"
        @focus="onFocus"
        @change="onQty"
        @keydown="$emit('nav', $event, row.id, 'qty')"
      />
    </div>

    <div class="c-unit">{{ row.unit }}</div>

    <!-- Цена -->
    <div class="c-price">
      <button v-if="res.priceOverridden && !readonly" class="rst" :title="`↺ вернуть цену прайса: ${fmt(row.priceCatalog)}`" @click="$emit('resetPrice', row.id)">↺</button>
      <input
        class="cell num"
        :class="{ 'is-ovr': res.priceOverridden, 'is-missing': res.missingPrice }"
        :value="priceText"
        :disabled="disabled || readonly"
        :placeholder="res.missingPrice ? 'цена?' : ''"
        :title="priceTitle"
        @focus="onFocus"
        @change="onPrice"
        @keydown="$emit('nav', $event, row.id, 'price')"
      />
    </div>

    <!-- Сумма -->
    <div class="c-sum num">{{ res.missingPrice ? '—' : fmtInt(res.sum) }}</div>

    <!-- Примечание / разрешение конфликта -->
    <div class="c-note">
      <template v-if="conflict">
        <span class="was">было {{ fmt(prevCalc) }}</span>
        <template v-if="!readonly">
          <button class="btn-amber" @click="$emit('keep', row.id)">Оставить моё</button>
          <button class="btn-plain" @click="$emit('drop', row.id)">Принять новое</button>
        </template>
      </template>
      <span v-else-if="res.missingPrice" class="note-red">указать цену</span>
      <span v-else class="note" :title="row.note ?? ''">{{ row.note ?? '' }}</span>

      <!-- Удалять можно только строки, добавленные вручную: строки шаблона
           лишь выключаются (Механика §12.5). -->
      <button v-if="row.isCustom && !readonly" class="rm" title="удалить строку" @click="emit('remove', row.id)">✕</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick } from 'vue'
import { tryEvalExpr } from '@/engines/expr'
import type { CalcRowNode } from '@/engines/template-kns'
import type { RowResult } from '@/engines/types'

/**
 * Строка таблицы расчёта — главный дизайн-контракт (README хендоффа).
 *
 * Шесть состояний ячейки:
 *   расчётное · override (синий + ↺) · нет цены (красная подложка, «цена?»)
 *   конфликт (янтарь + разрешение) · ФОТ-спутник (отступ, пунктир, метка)
 *   выключено (призрак, ввод disabled)
 */
const props = defineProps<{
  row: CalcRowNode
  res: RowResult
  conflict: boolean
  prevCalc: number | null
  fotK: number | null
  disabled: boolean
  /** Режим наблюдателя (VIEWER): значения видны, правка недоступна. */
  readonly?: boolean
}>()

const emit = defineEmits<{
  qty: [id: string, expr: string]
  price: [id: string, value: number | null]
  resetQty: [id: string]
  resetPrice: [id: string]
  keep: [id: string]
  drop: [id: string]
  nav: [e: KeyboardEvent, id: string, col: 'qty' | 'price']
  remove: [id: string]
}>()

const isSatellite = computed(() => props.row.kind === 'ФОТ' && props.row.parentId != null)

const rowClass = computed(() => ({
  'is-ghost': props.disabled,
  'is-red': props.res.missingPrice && !props.disabled,
  'is-sat-row': isSatellite.value,
}))

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
const fmtInt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
const fmtK = (k: number) => k.toLocaleString('ru-RU', { minimumFractionDigits: 2 })

/** Override хранит ВЫРАЖЕНИЕ, показываем результат (Механика §5.1). */
const qtyText = computed(() => (props.res.qty === 0 && props.disabled ? '0' : fmt(props.res.qty)))
const priceText = computed(() => (props.res.price == null ? '' : fmt(props.res.price)))

const qtyTitle = computed(() => {
  if (props.conflict) return `⚠ конфликт: расчётное изменилось (${fmt(props.prevCalc)} → ${fmt(props.row.qtyCalc)}), а количество переопределено вручную`
  if (props.res.qtyOverridden) return `Переопределено вручную. Выражение: ${props.row.qtyManual}\nƒ расчёт из ОЛ: ${fmt(props.row.qtyCalc)}`
  return `ƒ расчёт из ОЛ: ${fmt(props.row.qtyCalc)}`
})
const qtyResetTitle = computed(() => `↺ вернуть расчётное: ${fmt(props.row.qtyCalc)}`)

const priceTitle = computed(() => {
  if (props.res.missingPrice) return 'Цены нет в прайсе — введите вручную. Строка блокирует выпуск КП'
  if (props.res.priceOverridden) return `Переопределено вручную.\nЦена прайса: ${fmt(props.row.priceCatalog)}`
  return 'Цена из прайса'
})

function onFocus(e: FocusEvent) {
  ;(e.target as HTMLInputElement).select()
}
/**
 * Возвращает в поле то, что показывает модель.
 *
 * Нужно, потому что отвергнутый ввод часто НЕ меняет состояние: «мусор» в цене
 * даёт priceManual = null, а он и был null — присвоение того же значения не
 * запускает реактивность, перерисовки нет, и напечатанное застревает в ячейке
 * (выглядит как «форматирование не работает»). nextTick — чтобы отработать
 * после перерисовки, когда она всё же случилась.
 */
function resync(el: HTMLInputElement, text: () => string) {
  void nextTick(() => {
    el.value = text()
  })
}

function onQty(e: Event) {
  // Ввод сохраняется ВЫРАЖЕНИЕМ («1,55*2+2,88*2») — вычисляет движок
  // (Механика §5.1). Пустая строка сбрасывает override к расчётному.
  const el = e.target as HTMLInputElement
  emit('qty', props.row.id, el.value)
  resync(el, () =>qtyText.value)
}

function onPrice(e: Event) {
  // Цена принимает арифметику наравне с количеством («1200*2», «=1 200,5»):
  // движок сам разбирает запятую, ведущий «=» и разряды с неразрывным
  // пробелом. В отличие от количества хранится РЕЗУЛЬТАТ, а не выражение —
  // priceManual по модели число (Механика §5.2). Пусто и некорректный ввод
  // дают null, то есть возврат к цене прайса.
  const el = e.target as HTMLInputElement
  emit('price', props.row.id, tryEvalExpr(el.value))
  resync(el, () =>priceText.value)
}
</script>

<style scoped>
.r {
  display: grid;
  grid-template-columns: 104px minmax(180px, 1fr) 96px 52px 96px 100px 168px;
  gap: 8px; align-items: center;
  min-height: 32px; padding: 0 8px;
  border-bottom: 1px solid var(--line);
  font-size: 11.5px;
}
.r:nth-child(even) { background: var(--panel); }
.r.is-red { background: var(--acc-bg); }
/* Выключено — призрак, в итог не входит */
.r.is-ghost { opacity: .38; }

.chip {
  display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 9.5px; padding: 1px 5px; border: 1px solid var(--line2); color: var(--muted);
}
.c-name { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* ФОТ-спутник — вложенная строка с отступом */
.c-name.is-sat { padding-left: 30px; color: var(--muted); }
.sat-tag { font-size: 9px; color: var(--faint); white-space: nowrap; }

.c-qty, .c-price { display: flex; align-items: center; gap: 2px; }
.cell {
  width: 100%; min-width: 0;
  background: var(--cellbg); border: 1px solid transparent; color: var(--text);
  padding: 3px 6px; font-size: 11.5px; font-family: inherit;
}
.cell.num { text-align: right; }
.cell:focus { border-color: var(--blue); box-shadow: 0 0 0 2px var(--blue-bg); outline: none; }
.cell:disabled { background: transparent; }

/* Override — синий текст, рамка и точка в углу */
.cell.is-ovr {
  color: var(--blue); border-color: var(--blue);
  background: radial-gradient(circle at calc(100% - 4px) 4px, var(--blue) 2px, transparent 2.6px), var(--cellbg);
}
/* Нет цены */
.cell.is-missing { border-color: var(--acc); color: var(--acc); }
.cell.is-missing::placeholder { color: var(--acc); opacity: .8; }
/* Конфликт */
.cell.is-conflict { border-color: var(--amber); background: var(--amber-bg); }

/* ФОТ-спутник: пунктирные ячейки */
.is-sat-row .cell { border-style: dashed; border-color: var(--line2); }

.rst { background: transparent; border: none; color: var(--blue); font-size: 12px; padding: 0 1px; line-height: 1; }
.c-unit { font-size: 10.5px; color: var(--muted); }
.c-sum { text-align: right; font-weight: 500; }
.c-note { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--faint); min-width: 0; }
.note { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note-red { color: var(--acc); }
.rm { margin-left: auto; background: transparent; border: none; color: var(--faint); font-size: 12px; padding: 0 3px; }
.rm:hover { color: var(--acc); }
.was { color: var(--amber); white-space: nowrap; }
.btn-amber { border: 1px solid var(--amber); color: var(--amber); background: transparent; font-size: 9.5px; padding: 1px 6px; white-space: nowrap; }
.btn-plain { border: 1px solid var(--line2); color: var(--muted); background: transparent; font-size: 9.5px; padding: 1px 6px; white-space: nowrap; }
</style>
