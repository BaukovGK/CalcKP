import { onBeforeUnmount, ref, watch } from 'vue'

/**
 * Автосохранение экрана расчёта (План_устранения 3.2, решение Р6).
 *
 * Прежде правки жили в памяти до кнопки «Сохранить», а уход с экрана их молча
 * терял. Теперь, как у опросного листа: пауза после правки — запись, статус в
 * топбаре; закрыть вкладку с несохранённым браузер не даст без вопроса.
 *
 * Несохранённое — это расхождение подписи текущего состояния с подписью
 * сохранённого (стор, savedSignature): любая запись стора — и отсюда, и
 * пересчёт по прайсу, и выпуск КП — её обновляет, так что лишних записей нет.
 */

/** Пауза после последней правки, мс: ячейку правят подряд — одна запись. */
export const TREE_AUTOSAVE_DELAY_MS = 1500

export type TreeAutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

/** То, что автосохранению нужно от стора расчёта. */
export interface AutosaveStore {
  tree: unknown
  markup: number
  tirage: number
  savedSignature: string | null
  stateSignature(): string
  save(): Promise<void>
}

export function useTreeAutosave(store: AutosaveStore, opts: { enabled: () => boolean; delayMs?: number }) {
  const delay = opts.delayMs ?? TREE_AUTOSAVE_DELAY_MS
  const status = ref<TreeAutosaveStatus>('idle')
  const error = ref<string | null>(null)
  const savedAt = ref<Date | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  /** Есть несохранённое. */
  function dirty(): boolean {
    return store.savedSignature !== store.stateSignature()
  }

  function cancel() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  function schedule() {
    cancel()
    timer = setTimeout(() => void flush().catch(() => undefined), delay)
  }

  /**
   * Записать несохранённое сейчас. Ошибка — в `error` и наверх: кнопка
   * «Сохранить» и уход с экрана решают, что с ней делать.
   */
  async function flush(): Promise<void> {
    cancel()
    if (!opts.enabled() || !dirty()) return
    status.value = 'saving'
    try {
      await store.save()
      savedAt.value = new Date()
      error.value = null
      // Правили, пока запись была в пути, — ещё одна.
      if (dirty()) {
        status.value = 'pending'
        schedule()
      } else {
        status.value = 'saved'
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось сохранить расчёт'
      status.value = 'error'
      throw e
    }
  }

  watch(
    () => [store.tree, store.markup, store.tirage],
    () => {
      if (!opts.enabled() || status.value === 'saving') return
      if (!dirty()) {
        cancel()
        if (status.value === 'pending') status.value = savedAt.value ? 'saved' : 'idle'
        return
      }
      status.value = 'pending'
      schedule()
    },
    { deep: true },
  )

  // Писать стало можно (загрузка закончилась), а несохранённое уже есть —
  // дерево пересобрано при загрузке по изменившемуся ОЛ: записать и его.
  watch(opts.enabled, (on) => {
    if (on && status.value !== 'saving' && dirty()) {
      status.value = 'pending'
      schedule()
    }
  })

  /** Закрыть вкладку с несохранённым — браузер спросит. */
  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (!opts.enabled() || !dirty()) return
    e.preventDefault()
    e.returnValue = ''
  }
  window.addEventListener('beforeunload', onBeforeUnload)
  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', onBeforeUnload)
    cancel()
  })

  return { status, error, savedAt, dirty, flush }
}
