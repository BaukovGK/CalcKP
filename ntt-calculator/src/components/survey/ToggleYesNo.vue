<template>
  <div class="tg">
    <span class="tg-l">{{ label }}</span>
    <div class="tg-seg">
      <button class="tg-b" :class="{ on: modelValue }" @click="emit('update:modelValue', true)">да</button>
      <button class="tg-b" :class="{ on: !modelValue }" @click="emit('update:modelValue', false)">нет</button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Сегментированный переключатель «да/нет» — по прототипу ОЛ.
// Прогрессивное раскрытие: «нет» сворачивает зависимые поля (решает родитель).
defineProps<{ modelValue: boolean; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
</script>

<style scoped>
.tg { display: flex; align-items: center; gap: 8px; }
.tg-l { font-size: 11.5px; color: var(--muted); }
.tg-seg { display: flex; }
.tg-b {
  padding: 4px 14px; font-size: 12px; font-family: inherit;
  border: 1px solid var(--line2); background: transparent; color: var(--muted);
}
.tg-b + .tg-b { margin-left: -1px; }
.tg-b.on { background: var(--acc); border-color: var(--acc); color: #fff; position: relative; z-index: 1; }
</style>
