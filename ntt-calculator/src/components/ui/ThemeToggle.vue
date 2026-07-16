<template>
  <button class="theme-btn" @click="toggle" :title="isDark ? 'Светлая тема' : 'Тёмная тема'">
    <span class="theme-icon">{{ isDark ? '☀' : '☾' }}</span>
    <span class="theme-lbl">{{ isDark ? 'Светлая' : 'Тёмная' }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTheme } from '@/composables/useTheme'

const { theme, toggle } = useTheme()
const isDark = computed(() => theme.value === 'dark')
</script>

<style scoped>
.theme-btn {
  display: flex; align-items: center; gap: 5px;
  width: 100%; padding: 5px 8px; border-radius: 4px;
  background: transparent; border: none; cursor: pointer;
  font-size: 11px; color: var(--tx2); transition: background .12s, color .12s;
  font-family: inherit;
}
.theme-btn:hover { background: var(--bg3); color: var(--tx1); }
.theme-icon { font-size: 12px; flex-shrink: 0; }
.theme-lbl  { opacity: .7; }
</style>
