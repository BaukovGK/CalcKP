import { readonly, ref } from 'vue'

/**
 * Тосты вместо браузерных alert/confirm.
 *
 * Антицель хендоффа: «Не использовать браузерные alert/confirm».
 * Прежний код звал `confirm()` прямо внутри actions стора калькулятора —
 * это не только противоречит дизайну, но и делает стор нетестируемым без
 * подмены window.
 */

export type ToastKind = 'info' | 'error' | 'success'

export interface Toast {
  id: number
  message: string
  kind: ToastKind
}

const items = ref<Toast[]>([])
let seq = 0

/** Показывает тост. Ошибки висят дольше — их надо успеть прочитать. */
export function toast(message: string, kind: ToastKind = 'info'): void {
  const id = ++seq
  items.value.push({ id, message, kind })
  const ttl = kind === 'error' ? 5000 : 2400
  setTimeout(() => dismiss(id), ttl)
}

export function dismiss(id: number): void {
  items.value = items.value.filter((t) => t.id !== id)
}

export function useToasts() {
  return { items: readonly(items), dismiss }
}
