<template>
  <div class="ol">
    <!-- ── Топбар ── -->
    <header class="ol-top">
      <div class="ol-top-l">
        <RouterLink v-if="backTo" class="ol-back" :to="backTo">{{ backLabel ?? '←' }}</RouterLink>
        <span class="ol-name">{{ title }}</span>
        <span class="ol-zayavka">заявка {{ zayavka }} · черновик валиден в любом порядке</span>
      </div>
      <div class="ol-top-r">
        <span class="ol-draft">сохранено {{ draftTime }}</span>
        <slot name="topbar-actions" />
        <button class="ol-btn" title="Переключить тему" @click="toggle">
          {{ theme === 'dark' ? '☾' : '☀' }} тема
        </button>
      </div>
    </header>

    <div class="ol-body">
      <!-- ── Степпер секций ── -->
      <nav class="ol-steps">
        <button
          v-for="sec in sections"
          :key="sec.n"
          class="ol-step"
          :class="{ 'is-active': activeSec === sec.n }"
          @click="$emit('go', sec.n)"
        >
          <!-- ✓ секция заполнена · ● есть незаполненные обязательные -->
          <span class="ol-step-m" :class="sec.done ? 'ok' : 'todo'">{{ sec.done ? '✓' : '●' }}</span>
          <span class="ol-step-t">{{ sec.title }}</span>
        </button>
        <p class="ol-steps-hint">Секции заполняются в любом порядке. ● — есть незаполненные обязательные.</p>
      </nav>

      <!-- ── Форма ── -->
      <main ref="formEl" class="ol-form" @scroll="$emit('scroll')">
        <slot name="form" />
        <div class="ol-tail" />
      </main>

      <!-- ── Live-панель ── -->
      <aside class="ol-live">
        <slot name="live" />
      </aside>
    </div>

    <slot />
    <ToastHost />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import ToastHost from '@/components/ui/ToastHost.vue'
import { useTheme } from '@/composables/useTheme'

/**
 * Каркас экрана опросного листа — общий для КНС, ЕМК и КОЛ.
 *
 * Компоновка по прототипу «Опросный лист v2»: степпер секций 190px ·
 * форма max-width 820px · live-панель 300px. Три изделия делят один каркас;
 * различаются только поля формы и содержимое live-панели.
 */
defineProps<{
  title: string
  zayavka: string
  draftTime: string
  activeSec: number
  sections: ReadonlyArray<{ n: number; title: string; done: boolean }>
  /** Навигация назад (в проект / к списку) — необязательная. */
  backTo?: RouteLocationRaw
  backLabel?: string
}>()

defineEmits<{ go: [n: number]; scroll: [] }>()

const { theme, toggle } = useTheme()

/** Область прокрутки — нужна родителю для scrollspy. */
const formEl = ref<HTMLElement | null>(null)
defineExpose({ formEl })
</script>

<style scoped>
.ol { display: flex; flex-direction: column; height: 100vh; background: var(--bg); color: var(--text); }

.ol-back { font-size: 11px; color: var(--muted); text-decoration: none; margin-right: 4px; }
.ol-back:hover { color: var(--text); }
.ol-top { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 8px 14px; border-bottom: 2px solid var(--line); background: var(--panel); flex: none; }
.ol-top-l { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.ol-name { font-size: 15px; font-weight: 700; }
.ol-zayavka { font-size: 11px; color: var(--muted); }
.ol-top-r { display: flex; align-items: center; gap: 10px; flex: none; }
.ol-draft { font-size: 11px; color: var(--faint); }

.ol-body { flex: 1; display: flex; min-height: 0; }

/* Степпер */
.ol-steps { width: 190px; flex: none; border-right: 1px solid var(--line); background: var(--panel);
  padding: 8px 0; overflow-y: auto; }
.ol-step { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  padding: 7px 12px; background: transparent; border: none; border-left: 3px solid transparent;
  color: var(--muted); font-size: 12px; font-family: inherit; }
.ol-step:hover { color: var(--text); background: var(--panel2); }
.ol-step.is-active { border-left-color: var(--acc); background: var(--panel2); color: var(--text); }
.ol-step-m { font-size: 10px; min-width: 10px; }
.ol-step-m.ok { color: var(--green); }
.ol-step-m.todo { color: var(--acc); }
.ol-step-t { flex: 1; }
.ol-steps-hint { padding: 10px 12px; font-size: 9.5px; color: var(--faint); line-height: 1.5; }

/* Форма */
.ol-form { flex: 1; overflow-y: auto; padding: 16px 20px; min-width: 0; }
.ol-tail { height: 40vh; }

/* Live-панель */
.ol-live { width: 300px; flex: none; border-left: 2px solid var(--line); background: var(--panel);
  padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }

.ol-btn { background: transparent; border: 1px solid var(--line2); color: var(--muted);
  padding: 5px 11px; font-size: 11.5px; font-family: inherit; }
.ol-btn:hover:not(:disabled) { color: var(--text); }

@media (max-width: 1100px) { .ol-steps { display: none; } }
</style>

<!--
  Стили содержимого формы и live-панели — не scoped: их применяют дочерние
  экраны (КНС/ЕМК/КОЛ) к своей разметке внутри слотов.
-->
<style>
.ol-sec { max-width: 820px; margin: 0 auto 26px; }
.ol-h { font-size: 15px; font-weight: 700; margin-bottom: 10px; padding-bottom: 6px;
  border-bottom: 2px solid var(--line); }
.ol-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }

.fld { display: flex; flex-direction: column; gap: 3px; }
.fld--wide { grid-column: span 2; }
.fld > span { font-size: 11px; color: var(--muted); }
.req { color: var(--acc); }
.fld input, .fld select {
  background: var(--cellbg); border: 1px solid var(--line2); color: var(--text);
  padding: 5px 9px; font-size: 12.5px; font-family: inherit;
}
.fld input.num { text-align: right; }
.fld input.is-missing { border-color: var(--acc); background: var(--acc-bg); }

.ol-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ol-card { border: 1px solid var(--line); background: var(--panel); padding: 10px; margin-top: 10px; }
.ol-card-h { font-size: 10px; text-transform: uppercase; letter-spacing: .07em; color: var(--faint); margin-bottom: 8px; }
.f-mark { color: var(--faint); font-size: 9px; }
.ol-grade { font-size: 14px; font-weight: 600; }
.ol-grade--empty { color: var(--faint); font-weight: 400; }
.ol-explain { font-size: 11px; color: var(--muted); margin-top: 3px; }
.ol-chk { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 11.5px; color: var(--muted); }
.ol-manual { display: flex; gap: 10px; align-items: flex-end; margin-top: 8px;
  padding: 8px; background: var(--blue-bg); border-left: 3px solid var(--blue); }
.ol-reset { background: transparent; border: none; color: var(--blue); font-size: 11px; text-decoration: underline; }
.ol-toggles { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px; }
.ol-unit { display: flex; }
.ol-unit input { flex: 1; min-width: 0; }
.ol-unit-sel { border-left: none; }

/* Live-панель */
.ol-live-h { font-size: 10px; text-transform: uppercase; letter-spacing: .07em; color: var(--faint); }
.ol-live-lbl { font-size: 10.5px; color: var(--muted); }
.ol-live-npodz { font-size: 22px; font-weight: 700; }
.ol-live-u { font-size: 13px; font-weight: 400; color: var(--muted); }
.ol-live-ovr { font-size: 10px; color: var(--blue); margin-top: -8px; }
.ol-live-vals { display: flex; flex-direction: column; gap: 3px; border-top: 1px solid var(--line); padding-top: 8px; }
.ol-live-row { display: flex; justify-content: space-between; font-size: 11.5px; }
.ol-live-row dt { color: var(--muted); }
.ol-f { color: var(--faint); font-size: 9px; }
.ol-live-act { display: flex; gap: 8px; align-items: flex-end; border-top: 1px solid var(--line); padding-top: 8px; }
.ol-live-prev { border: 1px solid var(--line); padding: 8px; background: var(--panel2); }
.ol-prev-t { font-size: 12.5px; font-weight: 600; }
.ol-prev-s { font-size: 11px; color: var(--muted); margin-top: 2px; }
.ol-live-hint { font-size: 9.5px; color: var(--faint); line-height: 1.5; }
.ol-live-foot { margin-top: auto; display: flex; flex-direction: column; gap: 6px; }
.ol-hint { font-size: 11px; color: var(--amber); }
.ol-lnk { font-size: 11px; color: var(--muted); text-decoration: none; }
.ol-lnk:hover { color: var(--text); }

.ol-btn--acc { border-color: var(--acc); color: var(--acc); }
.ol-btn:disabled { opacity: .4; }
.ol-create { background: var(--acc); border: 1px solid var(--acc); color: #fff;
  padding: 8px 14px; font-size: 12.5px; font-weight: 600; font-family: inherit; }
.ol-create:disabled { opacity: .4; }

/* Модал-превью */
.mo-sub { font-size: 11.5px; color: var(--muted); margin: 4px 0 10px; }
.mo-list { list-style: none; display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
.mo-on { color: var(--green); }
.mo-off { color: var(--faint); }

@media (max-width: 1100px) { .ol-cards { grid-template-columns: 1fr; } }
</style>
