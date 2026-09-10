<template>
  <div class="tg" :class="{ 'tg--stacked': stacked }">
    <span class="tg-l">{{ label }}</span>
    <div class="tg-seg">
      <button class="tg-b" :class="{ on: modelValue }" @click="emit('update:modelValue', true)">{{ onLabel ?? 'да' }}</button>
      <button class="tg-b" :class="{ on: !modelValue }" @click="emit('update:modelValue', false)">{{ offLabel ?? 'нет' }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Сегментированный переключатель «да/нет» — по прототипу ОЛ.
// Прогрессивное раскрытие: «нет» сворачивает зависимые поля (решает родитель).
defineProps<{
  modelValue: boolean
  label: string
  /**
   * Подпись сверху, «да/нет» под ней — вид ячейки сетки листа: тумблер встаёт
   * рядом с полями и выравнивается по тем же вертикалям. Строчный вид
   * оставлен для мест, где тумблер идёт сам по себе.
   */
  stacked?: boolean
  /**
   * Подписи половин, если выбор не «да/нет», а из двух вариантов
   * («эллиптические / цилиндрические»): левая — `true`, правая — `false`.
   */
  onLabel?: string
  offLabel?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
</script>

<style scoped>
.tg { display: flex; align-items: center; gap: 8px; }
/* Ячейка сетки: подпись сверху — как у обычного поля. Строчная раскладка в
   ячейку на три колонки не влезает: подпись переносится на вторую строку
   («Шкаф / управления»), и ряд разъезжается. */
.tg--stacked { flex-direction: column; align-items: flex-start; gap: 3px; }
.tg-l { font-size: 13.8px; color: var(--muted); }
.tg-seg { display: flex; }
.tg-b {
  padding: 4px 14px; font-size: 14.4px; font-family: inherit;
  border: 1px solid var(--line2); background: transparent; color: var(--muted);
}
.tg-b + .tg-b { margin-left: -1px; }
.tg-b.on { background: var(--acc); border-color: var(--acc); color: #fff; position: relative; z-index: 1; }
</style>
