<template>
  <Teleport to="body">
    <div
      v-if="view.hint"
      :id="HINT_ID"
      ref="box"
      role="tooltip"
      class="hn"
      :class="[`hn--${view.mode}`, view.hint.tone ? `hn--${view.hint.tone}` : '', { 'hn--ready': placed }]"
      :style="style"
    >
      <div v-if="view.hint.title" class="hn-t">{{ view.hint.title }}</div>
      <p v-for="(t, i) in texts" :key="`t${i}`" class="hn-p">{{ t }}</p>
      <div v-for="(f, i) in formulas" :key="`f${i}`" class="hn-f"><span class="hn-fm">ƒ</span>{{ f }}</div>
      <div v-if="view.hint.source" class="hn-s">{{ view.hint.source }}</div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { HINT_ID, hintView as view } from '@/directives/hint'
import { placeHint } from '@/utils/hint-position'

/**
 * Окно сноски — одно на приложение (монтируется в App.vue). Содержимое и
 * место задаёт директива `v-hint` (directives/hint.ts).
 *
 * Окно рисуется невидимым, измеряется и только потом ставится на место:
 * иначе на кадр оно мелькало бы в левом верхнем углу.
 */

const box = ref<HTMLElement | null>(null)
const placed = ref(false)
const pos = ref({ top: 0, left: 0 })

const list = (v: string | ReadonlyArray<string> | undefined): string[] =>
  v == null ? [] : typeof v === 'string' ? [v] : [...v]
const texts = computed(() => list(view.hint?.text))
const formulas = computed(() => list(view.hint?.formula))

const style = computed(() => ({ top: `${pos.value.top}px`, left: `${pos.value.left}px` }))

async function place() {
  placed.value = false
  await nextTick()
  const el = box.value
  const rect = view.rect
  if (!el || !rect) return
  pos.value = placeHint({
    anchor: rect,
    box: { width: el.offsetWidth, height: el.offsetHeight },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    mode: view.mode,
    pointerX: view.pointerX,
  })
  placed.value = true
}

// Новый показ — новое место; смена текста открытой сноски (пересчёт) может
// изменить её высоту, поэтому место пересчитывается и тогда.
watch(() => [view.seq, view.hint], () => {
  if (view.hint) void place()
})
</script>

<style scoped>
.hn {
  position: fixed; z-index: 2500;
  max-width: min(400px, calc(100vw - 16px));
  padding: 9px 12px 10px;
  background: var(--panel2); color: var(--text);
  border: 1px solid var(--line2);
  box-shadow: 0 6px 22px rgba(0, 0, 0, .28);
  font-family: Archivo, system-ui, sans-serif;
  font-size: 13px; line-height: 1.45;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  /* Без анимации: окно появляется сразу на своём месте. Плавное появление
     в фоновой вкладке и во фрейме (Битрикс24) дорисовывалось не всегда, и
     сноска оставалась полупрозрачной поверх таблицы. */
  visibility: hidden;
}
.hn--ready { visibility: visible; }
.hn--row { max-width: min(460px, calc(100vw - 16px)); }
/* Тон — полоса слева, цвета семантики ДС: ошибка акцентом, конфликт янтарём,
   ручной ввод синим (main.css). */
.hn--error { border-left: 3px solid var(--acc); }
.hn--warn { border-left: 3px solid var(--amber); }
.hn--ovr { border-left: 3px solid var(--blue); }

.hn-t { font-weight: 600; margin-bottom: 3px; overflow-wrap: anywhere; }
.hn-p { color: var(--text); overflow-wrap: anywhere; }
.hn-p + .hn-p { margin-top: 4px; }
.hn-f { margin-top: 5px; display: flex; gap: 6px; color: var(--text); overflow-wrap: anywhere; }
.hn-fm { color: var(--blue); font-style: italic; flex-shrink: 0; }
.hn-s { margin-top: 6px; font-size: 11.6px; color: var(--faint); }
</style>
