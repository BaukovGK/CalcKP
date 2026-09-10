import { onBeforeUnmount, ref, watch } from 'vue'
import { useCalcTreeStore } from '@/stores/calcTree'
import { hasInvalidNumericField } from '@/utils/numeric-input'

/**
 * Где сейчас правка ОЛ: ждёт паузы в вводе, уходит на сервер, сохранена, упала
 * или ждёт исправления числового поля, которое не разобралось.
 */
export type SyncStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'invalid'

/**
 * Пауза после последней правки, мс. Меньше — запрос на каждую букву в поле
 * «Заказчик»; больше — инженер успевает уйти со страницы, не дождавшись.
 */
export const SYNC_DELAY_MS = 700

/**
 * JSON с упорядоченными ключами — подпись нагрузки для сравнения.
 *
 * Обычный JSON.stringify зависит от порядка ключей, а PostgreSQL хранит jsonb
 * со своим порядком: сохранённое и то же самое, собранное формой, давали бы
 * разные строки, и лист сохранялся бы без единой правки.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/**
 * Автосохранение опросного листа существующего изделия с пересчётом расчёта.
 *
 * ОЛ — основной экран изделия: расчёт следует за ним сам, без кнопки
 * «Сохранить». Каждая правка — после паузы в вводе — уходит в `applySurvey`
 * стора: дерево пересобирается из новых параметров, ручные правки расчёта
 * переносятся, ОЛ, дерево и итоги сохраняются одним запросом.
 *
 * Следит не за формой, а за ВСЕЙ полезной нагрузкой ОЛ: в ней есть и
 * производные величины, которые приходят асинхронно (марка насоса — ответ
 * сервера подбора). Следи мы только за формой, ответ подбора, пришедший после
 * сохранения, в расчёт бы не попал.
 *
 * Запросы не перекрываются: правка во время сохранения ставит следующее в
 * очередь, и уходит последнее состояние, а не каждое промежуточное.
 */
export function useSurveySync(opts: {
  /** Id изделия; пока его нет (лист ещё не создан), сохранять некуда. */
  estimateId: () => string | null | undefined
  /** Ревизия ОЛ, сохранённая на сервере на момент открытия. */
  initialRev: number
  /** Итог расчёта на момент открытия, ₽ — показывается до первого пересчёта. */
  initialPrice?: number | null
  /**
   * surveyData, сохранённый на сервере на момент открытия. С ним сравнивается
   * нагрузка: одинаковая — сохранять нечего. Без сравнения лист пересобирал
   * расчёт при каждом открытии: марка насоса приходит от подбора асинхронно, и
   * её появление выглядело бы правкой.
   */
  savedPayload?: Record<string, unknown> | null
  /** Полезная нагрузка ОЛ без ревизии: form, kns/emk/kol, derived… */
  payload: () => Record<string, unknown>
  /**
   * Можно ли сохранять. По умолчанию — нет, пока на экране есть числовое поле,
   * которое не разобралось («2**3»): оно ушло бы в расчёт пустым.
   */
  canSave?: () => boolean
}) {
  const canSave = opts.canSave ?? (() => !hasInvalidNumericField())
  const store = useCalcTreeStore()

  const status = ref<SyncStatus>('idle')
  const error = ref<string | null>(null)
  const savedAt = ref<Date | null>(null)
  /** Цена продажи после последнего пересчёта, ₽; `null` — расчёт пока не собрать. */
  const salePriceRub = ref<number | null>(opts.initialPrice ?? null)

  let rev = opts.initialRev
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight = false
  let queued = false
  /** Подпись последней сохранённой нагрузки; `null` — ещё не сравнивали. */
  let lastSaved: string | null = null

  /**
   * Подпись сохранённого на момент открытия — по тем же ключам, что шлёт ОЛ:
   * в surveyData есть и дерево, и итоги, к правкам ОЛ они не относятся.
   */
  function savedSignature(current: Record<string, unknown>): string | null {
    const saved = opts.savedPayload
    if (!saved) return null
    return stableStringify(Object.fromEntries(Object.keys(current).map((k) => [k, saved[k]])))
  }

  function isUnchanged(current: Record<string, unknown>): boolean {
    const sig = stableStringify(current)
    return sig === (lastSaved ?? savedSignature(current))
  }

  async function flush(): Promise<void> {
    const id = opts.estimateId()
    if (!id) return
    if (inFlight) {
      queued = true
      return
    }
    const payload = opts.payload()
    if (isUnchanged(payload)) {
      if (status.value === 'pending') status.value = savedAt.value ? 'saved' : 'idle'
      return
    }
    // Поле с неразобранным числом — ждём исправления: исправление изменит
    // нагрузку, и сохранение запустится само.
    if (!canSave()) {
      status.value = 'invalid'
      return
    }
    inFlight = true
    status.value = 'saving'
    try {
      // Ревизия растёт и при неудаче: на сервере её важна только
      // монотонность, а повтор с тем же номером сервер принял бы за старую.
      rev += 1
      salePriceRub.value = await store.applySurvey(id, { ...payload, surveyRev: rev })
      lastSaved = stableStringify(payload)
      savedAt.value = new Date()
      error.value = null
      status.value = 'saved'
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось сохранить опросный лист'
      status.value = 'error'
    } finally {
      inFlight = false
      if (queued) {
        queued = false
        void flush()
      }
    }
  }

  watch(
    () => opts.payload(),
    (next) => {
      if (!opts.estimateId()) return
      // Нагрузка вернулась к сохранённой (или впервые сошлась с ней после
      // асинхронных подсказок) — ни запроса, ни «изменения…» в статусе.
      if (isUnchanged(next)) {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        if (status.value === 'pending') status.value = savedAt.value ? 'saved' : 'idle'
        return
      }
      status.value = 'pending'
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void flush()
      }, SYNC_DELAY_MS)
    },
    { deep: true },
  )

  // Уход со страницы посреди паузы не должен терять последнюю правку.
  onBeforeUnmount(() => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
    void flush()
  })

  return { status, error, savedAt, salePriceRub, flush }
}
