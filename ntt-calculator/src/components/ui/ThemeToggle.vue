<template>
  <button
    v-hint="isDark ? 'Светлая тема' : 'Тёмная тема'"
    class="theme-btn"
    :class="{ 'theme-btn--compact': compact }"
    :aria-label="isDark ? 'Светлая тема' : 'Тёмная тема'"
    @click="toggle"
  >
    <span class="theme-icon">{{ isDark ? '☀' : '☾' }}</span>
    <span v-if="!compact" class="theme-lbl">{{ isDark ? 'Светлая' : 'Тёмная' }}</span>
  </button>
</template>

<script setup lang="ts">
/**
 * Переключатель темы. Иконка и подпись называют ЦЕЛЕВУЮ тему: в тёмной
 * показано «☀ Светлая» — куда переключит нажатие.
 *
 * @prop compact — одна иконка, для шапки рабочих экранов (расчёт, лист,
 *   заявка). В подвале боковой панели — с подписью, во всю ширину. Раньше у
 *   рабочих экранов были свои кнопки темы, и иконка на них означала ТЕКУЩУЮ
 *   тему — противоположно этому компоненту.
 */
import { computed } from 'vue'
import { useTheme } from '@/composables/useTheme'

defineProps<{ compact?: boolean }>()

const { theme, toggle } = useTheme()
const isDark = computed(() => theme.value === 'dark')
</script>

<style scoped>
.theme-btn {
  display: flex; align-items: center; gap: 5px;
  width: 100%; padding: 5px 8px; border-radius: 4px;
  background: transparent; border: none; cursor: pointer;
  font-size: 13.5px; color: var(--tx2); transition: background .12s, color .12s;
  font-family: inherit;
}
.theme-btn:hover { background: var(--bg3); color: var(--tx1); }
.theme-btn--compact { width: auto; padding: 4px 8px; border: 1px solid var(--bd2); }
.theme-icon { font-size: 14.5px; flex-shrink: 0; line-height: 1; }
.theme-lbl  { opacity: .7; }
</style>
