<template>
  <button
    v-if="bugReportReady"
    v-hint="BUG_REPORT_HINT"
    type="button"
    class="bug-btn"
    :class="{ 'bug-btn--compact': compact }"
    aria-label="Сообщить о проблеме"
    @click="openBugReport"
  >
    <span class="bug-ic" aria-hidden="true">!</span>
    <span class="bug-btn-t">Сообщить о проблеме</span>
  </button>
</template>

<script setup lang="ts">
/**
 * Кнопка «Сообщить о проблеме» в оболочке экрана — рядом с переключателем
 * темы и так же устроена: в подвале боковой панели — во всю ширину, с
 * подписью; в шапке рабочего экрана (`compact`) — рамкой. Открывает общее
 * окно отчёта (`composables/useBugReport.ts`); нет окна — нет и кнопки: так
 * она не видна на демо-входе и в тестах экранов, смонтированных без приложения.
 *
 * @prop compact — для шапки рабочих экранов: опросный лист, расчёт, заявка.
 */
import { BUG_REPORT_HINT, bugReportReady, openBugReport, useShellButton } from '@/composables/useBugReport'

defineProps<{ compact?: boolean }>()

useShellButton()
</script>

<style scoped>
/* Как ThemeToggle: во всю ширину подвала, знак слева. Знак акцентом — кнопку
   ищут, когда что-то пошло не так, и она должна находиться с первого взгляда. */
.bug-btn {
  display: flex; align-items: center; gap: 7px;
  width: 100%; padding: 5px 8px; border-radius: 4px;
  background: transparent; border: none; cursor: pointer;
  font-family: inherit; font-size: 13.5px; color: var(--tx2); white-space: nowrap;
  transition: background .12s, color .12s;
}
.bug-btn:hover { background: var(--bg3); color: var(--tx1); }
.bug-btn--compact { width: auto; padding: 3px 8px; border: 1px solid var(--bd2); font-size: 13px; }
.bug-ic {
  width: 16px; height: 16px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--acc); color: var(--on-acc); font-weight: 700; font-size: 12px; line-height: 1;
}
/* В узкой шапке — только знак: подпись переносила бы полосу ещё на строку.
   Имя кнопки для экранного диктора остаётся в aria-label. */
@media (max-width: 760px) {
  .bug-btn--compact .bug-btn-t { display: none; }
  .bug-btn--compact { padding: 3px 6px; }
}
</style>
