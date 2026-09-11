import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/**
 * Вставка из палитры «Имена и функции» в поле формулы, где стоял курсор.
 *
 * Поле формулы помечается классом `fx`. Палитра ловит `mousedown.prevent`,
 * поэтому фокус не уходит из поля, а вставка встаёт на место каретки и
 * проходит через событие `input` — v-model поля видит её как ввод.
 */
export function useFormulaTarget(root: Ref<HTMLElement | null>) {
  let last: HTMLInputElement | null = null

  const onFocus = (e: FocusEvent) => {
    const t = e.target
    if (t instanceof HTMLInputElement && t.classList.contains('fx')) last = t
  }
  onMounted(() => root.value?.addEventListener('focusin', onFocus))
  onBeforeUnmount(() => root.value?.removeEventListener('focusin', onFocus))

  /** @returns false — поля формулы ещё не выбирали */
  function insert(text: string): boolean {
    const el = last
    if (!el || !el.isConnected) return false
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? start
    el.value = el.value.slice(0, start) + text + el.value.slice(end)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.focus()
    const pos = start + text.length
    el.setSelectionRange(pos, pos)
    return true
  }

  return { insert }
}
