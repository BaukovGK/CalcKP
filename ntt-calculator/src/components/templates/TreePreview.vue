<template>
  <div class="tp">
    <div v-if="totals" class="tp-tot">
      <template v-if="sumOnly">
        <span v-hint.plain="'Материалы, работы и ФОТ строк узла. Накладные, ПЗР, ацетон и СИЗ считаются по расчёту целиком, а не по узлу'">Сумма строк <b class="num">{{ rub(treeSum) }}</b></span>
      </template>
      <template v-else>
        <span>Себестоимость <b class="num">{{ rub(totals.costRub) }}</b></span>
        <span>цена продажи <b class="num">{{ rub(totals.salePriceRub) }}</b></span>
      </template>
      <span class="tp-muted">строк {{ totals.rows }}</span>
      <span v-if="totals.unpriced" v-hint.plain="'Строки без цены в прайсе: у инженера они будут красными до ввода цены'" class="tp-red">без цены {{ totals.unpriced }}</span>
    </div>

    <div v-if="diff" class="tp-diff">
      <span v-hint="TEMPLATE_HINTS.diff" class="tp-diff-h">К действующей версии:</span>
      <template v-if="noChanges">изменений в составе нет</template>
      <template v-else>
        <span v-if="diff.added.length" class="tp-add">+ {{ diff.added.map((c) => c.title).join(', ') }}</span>
        <span v-if="diff.removed.length" class="tp-del">− {{ diff.removed.map((c) => c.title).join(', ') }}</span>
        <span v-for="m in diff.moved" :key="m.title" class="tp-mov">↷ {{ m.title }}: «{{ m.from }}» → «{{ m.section }}»</span>
        <span v-if="diff.changedRows" class="tp-muted">новое количество у {{ diff.changedRows }} строк</span>
      </template>
      <span v-if="costBefore != null && totals" class="tp-muted">себестоимость {{ shift }}</span>
    </div>

    <details v-for="s in tree?.sections ?? []" :key="s.id" class="tp-s" :open="openAll">
      <summary>
        <span class="tp-st">{{ s.code }} · {{ s.title }}</span>
        <span class="tp-sum num">{{ rub(sectionSum(s)) }}</span>
      </summary>
      <div v-if="!s.components.length" class="tp-empty">раздел пуст — строки добавят вручную</div>
      <div v-for="c in s.components" :key="c.id" class="tp-c" :class="{ off: !c.enabled }">
        <div class="tp-ct">
          └ {{ c.title }}
          <span v-if="c.nodeCode" class="tp-code">{{ c.nodeCode }}{{ c.nodeVersion ? ` v${c.nodeVersion}` : '' }}</span>
          <span v-if="!c.enabled" class="tp-muted">выключен</span>
        </div>
        <div v-for="r in c.rows" :key="r.id" v-hint.row="r.note || null" class="tp-r" :class="{ red: isRed(r, s, c), fot: r.kind === 'ФОТ' }">
          <span class="tp-n">{{ r.kind === 'ФОТ' ? '↳ ФОТ' : r.name }}</span>
          <span class="num">{{ qtyText(r) }}</span>
          <span class="tp-u">{{ r.unit }}</span>
          <span class="num">{{ priceText(r) }}</span>
          <span class="num">{{ rub(rowSum(r, s, c)) }}</span>
        </div>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { computeRow } from '@/engines/row'
import type { CalcComponent, CalcRowNode, CalcSection, CalcTree } from '@/engines/template-kns'
import type { TreeDiff, TreeTotals } from '@/utils/tree-preview'
import { costShiftText } from '@/utils/reprice-text'
import { TEMPLATE_HINTS } from '@/hints/templates'

/**
 * Предпросмотр материализации: разделы, компоненты и строки с количеством,
 * ценой и суммой — как у инженера; сверху итоги и отличия от действующей
 * версии.
 */
const props = defineProps<{
  tree: CalcTree | null
  totals?: TreeTotals | null
  diff?: TreeDiff | null
  /** Себестоимость по действующей версии — для сдвига в процентах. */
  costBefore?: number | null
  openAll?: boolean
  /**
   * Только сумма строк — у одиночного узла. Экономический хвост (накладные,
   * ПЗР, СИЗ от базы) считается по расчёту целиком и у узла дал бы
   * себестоимость даже пустому.
   */
  sumOnly?: boolean
}>()

const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 3 })

const on = (s: CalcSection, c: CalcComponent) => s.enabled && c.enabled
const res = (r: CalcRowNode, s: CalcSection, c: CalcComponent) => computeRow(r, { sectionEnabled: on(s, c), tirage: 1 })
const rowSum = (r: CalcRowNode, s: CalcSection, c: CalcComponent) => res(r, s, c).sum
const isRed = (r: CalcRowNode, s: CalcSection, c: CalcComponent) => {
  const x = res(r, s, c)
  return x.missingPrice && x.qty !== 0
}
const qtyText = (r: CalcRowNode) => (r.qtyCalc == null ? '—' : fmt(r.qtyCalc))
const priceText = (r: CalcRowNode) => {
  const p = r.priceManual ?? r.priceCatalog
  return p == null ? 'нет цены' : fmt(p)
}
const sectionSum = (s: CalcSection) =>
  s.components.reduce((a, c) => a + c.rows.reduce((b, r) => b + rowSum(r, s, c), 0), 0)

const treeSum = computed(() => (props.tree?.sections ?? []).reduce((a, s) => a + sectionSum(s), 0))

const noChanges = computed(
  () => !!props.diff && !props.diff.added.length && !props.diff.removed.length && !props.diff.moved.length && !props.diff.changedRows,
)
const shift = computed(() =>
  props.costBefore != null && props.totals ? costShiftText(props.costBefore, props.totals.costRub) : '',
)
</script>

<style scoped>
.tp { font-size: 13.2px; }
.tp-tot { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline; padding: 6px 8px; border: 1px solid var(--line); background: var(--panel2); }
.tp-tot b { font-weight: 700; }
.tp-diff { display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 5px 8px; border: 1px solid var(--line); border-top: 0; font-size: 12.6px; }
.tp-diff-h { color: var(--muted); }
.tp-add { color: var(--green); }
.tp-del { color: var(--acc); }
.tp-mov { color: var(--amber); }
.tp-muted { color: var(--faint); }
.tp-red { color: var(--acc); }

.tp-s { border-bottom: 1px solid var(--line); }
.tp-s summary { display: flex; justify-content: space-between; gap: 8px; padding: 5px 4px; cursor: pointer; font-weight: 600; }
.tp-sum { color: var(--muted); font-weight: 400; }
.tp-empty { padding: 2px 16px 6px; color: var(--faint); font-size: 12.6px; }
.tp-c { padding: 0 0 4px 8px; }
.tp-c.off { opacity: .55; }
.tp-ct { padding: 2px 0; color: var(--muted); }
.tp-code { font-family: ui-monospace, Consolas, monospace; font-size: 11.4px; color: var(--faint); margin-left: 4px; }
.tp-r { display: grid; grid-template-columns: minmax(0, 1fr) 70px 50px 86px 96px; gap: 6px; padding: 1px 0 1px 12px; }
.tp-r.fot { color: var(--muted); }
.tp-r.red .tp-n, .tp-r.red span:nth-child(4) { color: var(--acc); }
.tp-n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tp-u { color: var(--faint); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
</style>
