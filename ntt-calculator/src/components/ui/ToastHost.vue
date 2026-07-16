<template>
  <div class="th" role="status" aria-live="polite">
    <TransitionGroup name="th">
      <div v-for="t in items" :key="t.id" class="th-i" :class="`th-i--${t.kind}`" @click="dismiss(t.id)">
        {{ t.message }}
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { useToasts } from '@/composables/useToast'

const { items, dismiss } = useToasts()
</script>

<style scoped>
.th {
  position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; gap: 6px; z-index: 100; pointer-events: none;
}
.th-i {
  pointer-events: auto; cursor: pointer;
  background: var(--panel2); border: 1px solid var(--line2); color: var(--text);
  padding: 8px 14px; font-size: 12px; box-shadow: 0 4px 18px rgba(0, 0, 0, .3);
}
.th-i--error { border-color: var(--acc); background: var(--acc-bg); }
.th-i--success { border-color: var(--green); background: var(--green-bg); }

.th-enter-active, .th-leave-active { transition: opacity .18s, transform .18s; }
.th-enter-from, .th-leave-to { opacity: 0; transform: translateY(6px); }
</style>
