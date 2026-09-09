<template>
  <div class="dt">
    <div class="dt-row">
      <button
        v-for="t in types"
        :key="t.value"
        class="dt-btn"
        :class="{ active: modelValue === t.value, locked: !canChange }"
        type="button"
        :disabled="!canChange"
        @click="$emit('update:modelValue', t.value)"
      >
        <span class="dt-code">{{ t.value }}</span>
        <span class="dt-name">{{ t.label }}</span>
      </button>
    </div>

    <!-- У существующего расчёта тип зафиксирован: сменить его — значит
         пересобрать расчёт другим шаблоном, а вместе с ним потерять все
         ручные правки строк. Поэтому не «недоступно», а объяснено. -->
    <p v-if="!canChange" class="dt-note">
      Тип задан при создании расчёта и не меняется: другой тип — другой шаблон,
      и ручные правки строк в него не перенести. Нужен другой тип — создайте
      новый расчёт.
    </p>
    <p v-else-if="projectTitle" class="dt-note">→ в проект «{{ projectTitle }}»</p>
  </div>
</template>

<script setup lang="ts">
import type { DeviceType } from '@/api/estimates'

/**
 * Выбор типа изделия — второй пункт опросного листа.
 *
 * Раньше жил полосой НАД листом (`SurveyView`), но это часть заполнения, а не
 * настройка над ним: инженер сначала пишет заявку и заказчика, потом решает,
 * что считает. Общий компонент на все три ветки листа — состав кнопок и
 * правило блокировки у них одинаковы.
 */
defineProps<{
  modelValue: DeviceType
  types: ReadonlyArray<{ value: DeviceType; label: string }>
  /** Тип меняется только при создании; у сохранённого расчёта он зафиксирован. */
  canChange: boolean
  projectTitle?: string | null
}>()

defineEmits<{ 'update:modelValue': [DeviceType] }>()
</script>

<style scoped>
.dt { display: flex; flex-direction: column; gap: 8px; }
/* Кнопки делят ширину поровну — как один сегментированный переключатель, а
   не как три ярлыка разной длины по левому краю. */
.dt-row { display: flex; flex-wrap: wrap; gap: 8px; }
.dt-row > .dt-btn { flex: 1 1 0; min-width: 160px; }

.dt-btn { display: flex; align-items: baseline; justify-content: center; gap: 7px; padding: 9px 14px;
  background: transparent; border: 1px solid var(--line2); color: var(--muted);
  cursor: pointer; transition: all .1s; }
.dt-btn:hover:not(.locked) { color: var(--text); }
.dt-btn.active { border-color: var(--acc); color: var(--text); background: var(--acc-bg); }
/* Заблокированные кнопки не гасим до нечитаемости: активный тип должен
   оставаться видимым — это информация, а не выключенный элемент. */
.dt-btn.locked { cursor: default; }
.dt-btn.locked:not(.active) { opacity: .45; }

.dt-code { font-size: 15.6px; font-weight: 700; }
.dt-name { font-size: 14.4px; }
.dt-note { font-size: 13.8px; color: var(--muted); margin: 0; max-width: 62ch; }
</style>
