<template>
  <div class="cf">
    <span v-hint="hint" class="cf-l">{{ label }}</span>

    <div class="cf-row">
      <!-- data-numeric: поле числовое, текст в него не пропускается
           (utils/numeric-input.ts). -->
      <input
        class="cf-i"
        data-numeric
        :class="{ 'is-ovr': overridden }"
        :value="displayValue"
        :placeholder="String(calc)"
        @input="onInput"
      />
      <button v-if="overridden" v-hint="`↺ вернуть расчётное: ${calc}`" class="cf-reset" :aria-label="`Вернуть расчётное: ${calc}`" @click="reset">↺</button>
    </div>

    <!-- Подсказка-разбивка формулы под полем (прототип ОЛ).
         Результат в текст не дописываем: `explain` уже содержит его
         («по кол-ву подводящих патрубков = 1») — иначе выходило «= 1 = 1». -->
    <span class="cf-f">ƒ {{ explain }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { HintValue } from '@/directives/hint'

/**
 * Вычисляемое поле с ручным override (§5.6 ТЗ).
 *
 * Расчётное значение никогда не теряется: пустой ввод возвращает его,
 * кнопка ↺ сбрасывает override явно (Механика §5.1).
 */
const props = defineProps<{
  modelValue: string
  label: string
  /** Расчётное значение — показывается плейсхолдером и в подсказке. */
  calc: number
  /** Итоговое значение (override ?? расчётное). */
  value: number
  overridden: boolean
  explain: string
  /** Сноска к подписи. */
  hint?: HintValue
}>()

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const displayValue = computed(() => (props.overridden ? props.modelValue : ''))

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}
function reset() {
  emit('update:modelValue', '')
}
</script>

<style scoped>
.cf { display: flex; flex-direction: column; gap: 3px; }
/* Подпись и подсказка получают по две строки всегда, даже если занимают одну.
   Соседние поля бывают разной длины («Обратные клапаны» против «Задвижки —
   напорная сторона»), и без резерва их высоты расходились: поля ввода вставали
   на разной высоте, а строка «плыла». Резерв делает все поля равными по
   высоте, поэтому выравнивание работает и по верху, и по низу. */
.cf-l { font-size: 13.2px; color: var(--muted); min-height: 2.5em; display: block; }
.cf-row { display: flex; align-items: center; gap: 4px; }
.cf-i {
  flex: 1; min-width: 0; text-align: right;
  background: var(--cellbg); border: 1px solid var(--line2); color: var(--text);
  padding: 5px 9px; font-size: 15px; font-family: inherit;
}
/* Override — синий: канал ручного ввода (Механика §5). */
.cf-i.is-ovr { color: var(--blue); border-color: var(--blue); background: var(--blue-bg); }
.cf-i::placeholder { color: var(--text); opacity: 1; }
.cf-reset { background: transparent; border: none; color: var(--blue); font-size: 14.4px; padding: 0 2px; }
.cf-f { font-size: 12px; color: var(--faint); }
</style>
