import { computed, ref, watch, type Ref } from 'vue'
import { toLps } from '@/engines/survey-kns'
import { tryEvalExpr } from '@/engines/expr'
import {
  pumpStationApi,
  type PressurePipingResult,
  type PumpCandidate,
  type PumpSelectionResult,
} from '@/api/pumpStation'
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
 * Гидравлика напорного — подсказка и проверка. Расчётный DN автоматически в
 * `napDn` не подставляется: от DN напорного зависят наименования строк расчёта
 * (нитка, кран, отводы), и молчаливая правка увела бы за собой ручные цены
 * (рематериализация сопоставляет строки по наименованию). Вместо этого сервер
 * проверяет скорость в том DN, что стоит в листе, — как лист «Гидравл. расчет».
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

  /** Количество напорных трубопроводов на выходе. */
  const outletCount = computed<number | null>(() => {
    const n = num(form.value.napKol)
    return n != null && Number.isInteger(n) && n > 0 ? n : null
  })

  /** DN напорного из листа — в нём сервер проверяет скорость. */
  const outletDn = computed<number | null>(() => {
    const n = num(form.value.napDn)
    return n != null && Number.isInteger(n) && n > 0 ? n : null
  })

  /** Чего не хватает для подбора — экран объясняет это пользователю. */
  const missing = computed<string[]>(() => {
    const miss: string[] = []
    if (flowM3h.value == null) miss.push('рабочий расход')
    if (headM.value == null) miss.push('расчётный напор')
    if (workingPumps.value == null) miss.push('кол-во рабочих насосов')
    return miss
  })

  const ready = computed(() => missing.value.length === 0)

  const selection = ref<PumpSelectionResult | null>(null)
  const piping = ref<PressurePipingResult | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  let timer: ReturnType<typeof setTimeout> | null = null
  /**
   * Номер последнего запроса: ответы приходят не в том порядке, в каком
   * уходили, и устаревший не должен затереть свежий.
   */
  let seq = 0

  /**
   * Подбор насоса и гидравлика напорного. Напор нужен только подбору: диаметры
   * и скорости считаются по расходу и числу насосов, и без напора лист их
   * всё равно показывает.
   */
  async function request(flow: number, head: number | null, pumps: number, outlets: number, dn: number | null) {
    const mine = ++seq
    loading.value = true
    error.value = null
    try {
      const [sel, nz] = await Promise.all([
        head != null ? pumpStationApi.selectPump(flow, head, pumps) : Promise.resolve(null),
        pumpStationApi.pressurePiping(flow, pumps, outlets, dn),
      ])
      if (mine !== seq) return
      selection.value = sel
      piping.value = nz
    } catch (e) {
      if (mine !== seq) return
      selection.value = null
      piping.value = null
      const r = (e as { response?: { data?: { message?: string } } }).response
      error.value = r?.data?.message ?? 'Не удалось получить подбор с сервера'
    } finally {
      if (mine === seq) loading.value = false
    }
  }

  watch(
    () => [flowM3h.value, headM.value, workingPumps.value, outletCount.value, outletDn.value] as const,
    ([flow, head, pumps, outlets, dn]) => {
      if (timer) clearTimeout(timer)
      if (flow == null || pumps == null) {
        // Ответ на прежние значения уже не относится к делу — гасим его.
        seq++
        selection.value = null
        piping.value = null
        loading.value = false
        error.value = null
        return
      }
      // Ниток по умолчанию столько же, сколько рабочих насосов: пока поле ОЛ
      // не заполнено, считаем прямую нитку, а не коллектор.
      timer = setTimeout(() => void request(flow, head, pumps, outlets ?? pumps, dn), DEBOUNCE_MS)
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
    // Напор — тот, по которому сервер подбирал, а не текущий из поля: пока
    // идёт пауза перед запросом, в поле уже новый, а подбор ещё старый.
    const head = nf(sel.requiredHeadM ?? headM.value ?? 0, 2)
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

  /**
   * Проверка напорного DN из листа — то, что лист «Гидравл. расчет» считает
   * для заданной трубы: скорость при работе на одну нитку (весь приток через
   * одну линию) и, если напорных несколько, когда работают все сразу.
   */
  const pipeExplain = computed<string | null>(() => {
    const p = piping.value
    if (!p) return null
    const c = p.outletCheck
    if (!c) {
      return outletDn.value != null
        ? `DN${outletDn.value}: трубы ПЭ-100 SDR17 такого DN нет в ряду — скорость не проверена`
        : null
    }
    const all = c.outletCount === 2 ? 'обе' : `все ${c.outletCount}`
    const parallel = c.outletCount > 1 ? ` · ${all} сразу — ${nf(c.parallelVelocityMs, 2)} м/с` : ''
    return (
      `напорный DN${c.dn} (⌀${c.diameterMm}×${nf(c.wallMm, 1)}, проход ${nf(c.innerDiameterMm, 0)} мм): ` +
      `${nf(c.velocityMs, 2)} м/с на одну нитку${parallel}`
    )
  })

  /** Скорость в DN из листа вне экономического диапазона 1…2 м/с. */
  const pipeWarnings = computed(() => piping.value?.outletCheck?.warnings ?? [])

  /**
   * Расчётный напорный узел: какой DN брать напорному и коллектору (весь
   * приток) и стояку насоса (расход одного насоса). DN — из ряда патрубков,
   * скорость — ближайшая к целевой 1,5 м/с.
   *
   * Одинаковые диаметры не повторяются: при одном рабочем насосе все участки
   * совпадают, и три раза «DN100» — шум, а не информация.
   */
  const pipingExplain = computed<string | null>(() => {
    const p = piping.value
    if (!p) return null
    const fmt = (r: { dn: number; velocityMs: number }) => `DN${r.dn} (${nf(r.velocityMs, 2)} м/с)`
    if (!p.collectorWiderThanRiser) return `расчётный: весь напорный узел — ${fmt(p.outlet)}`
    return `расчётный: напорный и коллектор ${fmt(p.outlet)} · стояк насоса ${fmt(p.riser)}`
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
    piping,
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
    pipeWarnings,
    pipingExplain,
    warnings,
  }
}
