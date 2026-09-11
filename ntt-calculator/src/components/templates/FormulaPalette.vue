<template>
  <details class="pal" :open="!collapsed">
    <summary class="pal-h"><span v-hint="TEMPLATE_HINTS.palette">Имена и функции</span></summary>
    <details v-if="vars.length" class="pal-g" open>
      <summary>{{ varsTitle }}</summary>
      <button
        v-for="v in vars"
        :key="v.key"
        type="button"
        class="pal-i"
        @mousedown.prevent
        @click="emit('insert', v.key)"
      >
        <code>{{ v.key }}</code>
        <span>{{ v.label }}{{ v.unit ? `, ${v.unit}` : '' }}{{ v.type === 'bool' ? ' — да/нет' : v.type === 'text' ? ' — текст' : '' }}</span>
      </button>
    </details>
    <details v-for="g in groups" :key="g.name" class="pal-g" :open="g.name === 'Excel'">
      <summary>{{ g.name }}</summary>
      <button
        v-for="f in g.fns"
        :key="f.name"
        v-hint.plain="fnHint(f)"
        type="button"
        class="pal-i"
        @mousedown.prevent
        @click="emit('insert', callText(f))"
      >
        <code>{{ f.name }}</code>
        <span>{{ f.label }}</span>
      </button>
    </details>
  </details>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { FORMULA_FNS, type FormulaFn, type FormulaGroup, type VarKind } from '@/engines/node-expr'
import { TEMPLATE_HINTS } from '@/hints/templates'

/**
 * Палитра выражений редактора: имена (параметры узла или поля ОЛ) и
 * функции реестра. Щелчок вставляет текст в поле формулы, где стоял курсор
 * (composables/useFormulaTarget.ts).
 */
defineProps<{
  vars: ReadonlyArray<{ key: string; label: string; unit?: string; type: VarKind }>
  varsTitle: string
  /** Свёрнута при открытии — когда формулы правят не всё время. */
  collapsed?: boolean
}>()
const emit = defineEmits<{ insert: [text: string] }>()

const ORDER: FormulaGroup[] = ['Excel', 'Корпус', 'Конструкции', 'Оборудование', 'Справочники']
const groups = computed(() => ORDER.map((name) => ({ name, fns: FORMULA_FNS.filter((f) => f.group === name) })))

/** Вызов с именами аргументов вместо значений — их заменяют своими. */
const callText = (f: FormulaFn) => `${f.name}(${f.args.filter((a) => !a.optional).map((a) => a.name).join('; ')})`

const fnHint = (f: FormulaFn) =>
  `${f.name}(${f.args.map((a) => (a.optional ? `[${a.label}]` : a.label)).join('; ')})${f.unit ? ` → ${f.unit}` : ''}`

</script>

<style scoped>
.pal { border: 1px solid var(--line); background: var(--panel2); font-size: 12.6px; max-height: 360px; overflow-y: auto; }
.pal-h { padding: 5px 8px; color: var(--muted); border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--panel2); cursor: pointer; z-index: 1; }
.pal-g summary { padding: 4px 8px; cursor: pointer; color: var(--faint); font-size: 11.4px; text-transform: uppercase; letter-spacing: .05em; }
.pal-i { display: flex; gap: 8px; width: 100%; text-align: left; background: transparent; border: 0; border-top: 1px solid var(--line);
  padding: 3px 8px; color: var(--text); cursor: pointer; font: inherit; }
.pal-i:hover { background: var(--acc-bg); }
.pal-i code { font-family: ui-monospace, Consolas, monospace; color: var(--acc); white-space: nowrap; }
.pal-i span { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
