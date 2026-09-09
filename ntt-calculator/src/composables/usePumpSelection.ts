import { computed, ref, watch, type Ref } from 'vue'
import { toLps } from '@/engines/survey-kns'
import { tryEvalExpr } from '@/engines/expr'
import { pumpStationApi, type PipeDiameterResult, type PumpCandidate, type PumpSelectionResult } from '@/api/pumpStation'
import type { KnsSurveyForm } from '@/types/survey'

/**
 * Подбор насосного оборудования для опросного листа КНС.
 *
 * Алгоритм и каталог — на сервере (`/api/pump-station`), здесь только
 * реактивная обвязка: следим за притоком, напором и числом рабочих насосов,
 * спрашиваем сервер и отдаём результат экрану.
 *
 * Марка подчиняется тому же правилу «расчёт + override», что PN/SN и арматура
 * (Механика §5.1): подобранная марка — расчётное значение, поле «Марка насосов»
 * — ручное переопределение. Пустое поле означает «взять подобранную», а не
 * «марки нет», поэтому автоподстановка в поле не нужна: она затёрла бы
 * возможность вернуться к расчётной.
 *
 * Диаметр напорного трубопровода — только подсказка. Автоматически подставлять
 * его в `napDn` нельзя: от DN напорного зависят наименования строк расчёта
 * (нитка, кран, отводы), и молчаливая правка увела бы за собой ручные цены
 * (рематериализация сопоставляет строки по наименованию).
 */

/** Пауза перед запросом, мс: приток и напор набирают посимвольно. */
const DEBOUNCE_MS = 400

export function usePumpSelection(form: Ref<KnsSurveyForm>) {
  const num = (s: string): number | null => tryEvalExpr(s)

  /** Общий приток на станцию в м³/ч — в этих единицах считает сервер. */
  const flowM3h = computed<number | null>(() => {
    const raw = num(form.value.rashod)
    if (raw == null || raw <= 0) return null
    return toLps(raw, form.value.rashodUnit) * 3.6
  })

  const headM = computed<number | null>(() => {
    const h = num(form.value.napor)
    return h != null && h > 0 ? h : null
  })

  const workingPumps = computed<number | null>(() => {
    const n = num(form.value.nRab)
    return n != null && Number.isInteger(n) && n > 0 ? n : null
  })

  /** Чего не хватает для подбора — экран объясняет это пользователю. */
  const missing = computed<string[]>(() => {
    const miss: string[] = []
    if (flowM3h.value == null) miss.push('приток')
    if (headM.value == null) miss.push('расчётный напор')
    if (workingPumps.value == null) miss.push('кол-во рабочих насосов')
    return miss
  })

  const ready = computed(() => missing.value.length === 0)

  const selection = ref<PumpSelectionResult | null>(null)
  const pipe = ref<PipeDiameterResult | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  let timer: ReturnType<typeof setTimeout> | null = null
  /**
   * Номер последнего запроса: ответы приходят не в том порядке, в каком
   * уходили, и устаревший не должен затереть свежий.
   */
  let seq = 0

  async function request(flow: number, head: number, pumps: number) {
    const mine = ++seq
    loading.value = true
    error.value = null
    try {
      const [sel, pd] = await Promise.all([
        pumpStationApi.selectPump(flow, head, pumps),
        pumpStationApi.dischargePipeDiameter(flow, pumps),
      ])
      if (mine !== seq) return
      selection.value = sel
      pipe.value = pd
    } catch (e) {
      if (mine !== seq) return
      selection.value = null
      pipe.value = null
      const r = (e as { response?: { data?: { message?: string } } }).response
      error.value = r?.data?.message ?? 'Не удалось получить подбор с сервера'
    } finally {
      if (mine === seq) loading.value = false
    }
  }

  watch(
    () => [flowM3h.value, headM.value, workingPumps.value] as const,
    ([flow, head, pumps]) => {
      if (timer) clearTimeout(timer)
      if (flow == null || head == null || pumps == null) {
        // Ответ на прежние значения уже не относится к делу — гасим его.
        seq++
        selection.value = null
        pipe.value = null
        loading.value = false
        error.value = null
        return
      }
      timer = setTimeout(() => void request(flow, head, pumps), DEBOUNCE_MS)
    },
    { immediate: true },
  )

  /** Подобранная марка — расчётное значение. */
  const pumpModelCalc = computed<string | null>(() => selection.value?.name ?? null)

  /** Итоговая марка: ручной ввод перекрывает подбор. */
  const pumpModel = computed<string | null>(() => {
    const manual = form.value.marka.trim()
    return manual !== '' ? manual : pumpModelCalc.value
  })

  const pumpModelOverridden = computed(() => form.value.marka.trim() !== '')

  const nf = (v: number, digits = 1) => v.toLocaleString('ru-RU', { maximumFractionDigits: digits })

  /**
   * Пояснение подбора — в стиле остальных подсказок листа. Показывает рабочую
   * точку, а не только марку: инженеру нужно видеть, какой напор насос там
   * реально даёт, с каким запасом и какой мощностью.
   */
  const pumpExplain = computed<string | null>(() => {
    if (!ready.value) return `нужно: ${missing.value.join(', ')}`
    if (loading.value) return 'подбираем…'
    if (error.value) return error.value
    const sel = selection.value
    if (!sel) return null

    const perPump = nf(sel.flowPerPumpM3h)
    const head = nf(headM.value ?? 0, 2)
    if (!sel.name) {
      // Причина отказа важнее самого отказа: по ней видно, что менять.
      return sel.warnings[0]?.message ?? `подходящего насоса нет: ${perPump} м³/ч на насос, напор ${head} м`
    }

    const base = `расчётные: ${perPump} м³/ч на насос · напор ${head} м → ${sel.name}`
    if (!sel.duty) return `${base} · подобран по диапазонам, кривой у модели нет`
    return (
      `${base} · рабочая точка ${nf(sel.duty.h, 2)} м ` +
      `(запас ${nf(sel.headMarginM ?? 0, 2)} м) · КПД ${nf(sel.duty.eff)}% · ${nf(sel.duty.p2, 2)} кВт`
    )
  })

  /** Другие подходящие модели — короткой строкой, по возрастанию мощности. */
  const alternativesExplain = computed<string | null>(() => {
    const alts = selection.value?.alternatives ?? []
    if (!alts.length) return null
    const head = alts
      .slice(0, 3)
      .map((a) => (a.duty ? `${a.name} (${nf(a.duty.p2, 2)} кВт)` : a.name))
      .join(', ')
    return `ещё подходят: ${head}${alts.length > 3 ? ` и ещё ${alts.length - 3}` : ''}`
  })

  /** Подпись модели в списке выбора: по ней видно, чем модели различаются. */
  function optionLabel(c: PumpCandidate): string {
    if (!c.duty) return `${c.name} — без паспортной кривой`
    return (
      `${c.name} — ${nf(c.duty.p2, 2)} кВт · КПД ${nf(c.duty.eff)}% · ` +
      `напор ${nf(c.duty.h, 2)} м (запас ${nf(c.headMarginM ?? 0, 2)} м)`
    )
  }

  /**
   * Модели, доступные для выбора: сначала прошедшие отбор, затем отсечённые по
   * минимальному запасу. Вторые показываются отдельной группой намеренно — их
   * ставят в реальных проектах, и прятать это неправильно, но и предлагать по
   * умолчанию нельзя: на объекте такой насос до расчётной точки может не дойти.
   */
  const choices = computed(() => ({
    fitting: selection.value?.candidates ?? [],
    belowMargin: selection.value?.belowMargin ?? [],
  }))

  /** Окно запаса, применённое сервером, — для подписи группы. */
  const marginBand = computed(() => selection.value?.headMarginBandM ?? null)

  /** Выбрать модель вручную: пишет её в поле «Марка насосов». */
  function choose(name: string) {
    form.value.marka = name
  }

  /** Вернуться к подобранной автоматически. */
  function resetToCalculated() {
    form.value.marka = ''
  }

  /** Подсказка по напорному трубопроводу: расчётный диаметр и скорость. */
  const pipeExplain = computed<string | null>(() => {
    const p = pipe.value
    if (!p) return null
    const v = p.velocityMs.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
    return `расчётный Ø${p.diameterMm} мм · скорость ${v} м/с при целевой ${p.designVelocityMs} м/с`
  })

  /** Предупреждения подбора — показываем как есть, они объясняют границы каталога. */
  const warnings = computed(() => selection.value?.warnings ?? [])

  return {
    flowM3h,
    headM,
    workingPumps,
    ready,
    missing,
    loading,
    error,
    selection,
    pipe,
    pumpModelCalc,
    pumpModel,
    pumpModelOverridden,
    pumpExplain,
    alternativesExplain,
    optionLabel,
    choices,
    marginBand,
    choose,
    resetToCalculated,
    pipeExplain,
    warnings,
  }
}
