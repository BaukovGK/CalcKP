<template>
  <button
    v-hint="BUG_REPORT_HINT"
    class="bug-fab"
    type="button"
    aria-label="Сообщить о проблеме"
    @click="openBugReport"
  >
    <span class="bug-fab-ic" aria-hidden="true">!</span>
    <span class="bug-fab-t">Сообщить о проблеме</span>
  </button>
</template>

<script setup lang="ts">
/**
 * Запасная кнопка «Сообщить о проблеме» — в правом нижнем углу экрана, у
 * которого своей нет: обязательная смена пароля, загрузка и ошибка опросного
 * листа. Показывает её `App.vue`, пока на экране нет кнопки оболочки
 * (`composables/useBugReport.ts`), так что сообщить о проблеме можно отовсюду,
 * и с экрана, в который кнопку забыли поставить.
 */
import { BUG_REPORT_HINT, openBugReport } from '@/composables/useBugReport'
</script>

<style scoped>
.bug-fab {
  position: fixed; right: 14px; bottom: 14px; z-index: 90;
  display: flex; align-items: center; gap: 7px; height: 28px; padding: 0 10px 0 6px;
  background: var(--panel2); border: 1px solid var(--line2); color: var(--tx2);
  font: inherit; font-size: 12.5px; white-space: nowrap; cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, .25);
  transition: color .12s, border-color .12s;
}
.bug-fab:hover, .bug-fab:focus-visible { color: var(--text); border-color: var(--acc); }
.bug-fab-ic {
  width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center;
  background: var(--acc); color: var(--on-acc); font-weight: 700; font-size: 12px; line-height: 1;
}
@media (max-width: 600px) {
  .bug-fab { right: 10px; bottom: 10px; padding: 0 5px; }
  .bug-fab-t { display: none; }
}
@media print {
  .bug-fab { display: none; }
}
</style>
