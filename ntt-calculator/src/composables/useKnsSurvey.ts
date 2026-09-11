import { computed, watch, type Ref } from 'vue'
import {
  checkValveCount,
  convertFlowText,
  formatFlow,
  fromLps,
  toLps,
  pressureGateValveCount,
  computeDepth,
  gateValveCount,
  pipeGradeName,
  snByDepth,
} from '@/engines/survey-kns'
import { tryEvalExpr } from '@/engines/expr'
import { usePipeOverride } from './usePipeOverride'
import type { KnsSurveyForm } from '@/types/survey'

/**
 * Производные величины опросного листа КНС.
 *
 * Вся арифметика — в `engines/survey-kns.ts` (чистые функции, покрыты тестами);
 * здесь только реактивная обвязка. Разделение намеренное: движок обязан
 * оставаться тестируемым без Vue.
 */
export function useKnsSurvey(form: Ref<KnsSurveyForm>) {
  const num = (s: string): number | null => tryEvalExpr(s)

  // Смена единиц расхода пересчитывает само значение: воды столько же, в
  // новых единицах (25,13 л/с → 90,47 м³/ч). Раньше менялась только подпись —
  // и расход тихо становился в 3,6 раза меньше или больше.
  //
  // Пересчёт идёт от ТОЧНОГО значения последнего ручного ввода (в л/с), а не
  // от показанного округлённого: цепочка л/с → м³/ч → м³/сут иначе копила бы
  // ошибку округления (2171,28 вместо 2171,23).
  let anchorLps: number | null = null
  let convertedText: string | null = null

  watch(
    () => form.value.rashod,
    (raw) => {
      if (raw === convertedText) return // это наш пересчёт, а не ввод
      convertedText = null
      const v = num(raw)
      anchorLps = v == null ? null : toLps(v, form.value.rashodUnit)
    },
    { immediate: true },
  )

  watch(
    () => form.value.rashodUnit,
    (to, from) => {
      const text = anchorLps != null ? formatFlow(fromLps(anchorLps, to)) : convertFlowText(form.value.rashod, from, to)
      if (text == null) return
      convertedText = text
      form.value.rashod = text
    },
  )

  /** Подбор глубины — фирменная механика ОЛ (live-панель прототипа). */
  const depth = computed(() =>
    computeDepth({
      flow: num(form.value.rashod) ?? 0,
      flowUnit: form.value.rashodUnit,
      dn: num(form.value.dn) ?? 0,
      pumpsWorking: num(form.value.nRab) ?? 1,
      inletInvertMm: num(form.value.podvLotok),
    }),
  )

  /** Итоговая глубина: ручной ввод перекрывает расчётную. */
  const depthMm = computed<number | null>(() => num(form.value.npodzManual) ?? depth.value.npodzMm)

  const depthOverridden = computed(() => num(form.value.npodzManual) != null)

  // ── PN / SN: вычисляемые с override (решение дизайн-сессии) ──

  const snCalc = computed(() =>
    depthMm.value == null
      ? null
      // ТТ МВК жёсткость НЕ меняет — только её обозначение в марке трубы.
      : snByDepth(depthMm.value, { underRoadway: form.value.underRoadway }),
  )

  const { sn, pn } = usePipeOverride(form, snCalc)

  /** Марка трубы корпуса: PN здесь — из ОЛ, а не подобранная (ТЗ §9.4). */
  const pipeGrade = computed(() => {
    const dn = num(form.value.dn)
    if (dn == null || sn.value == null) return null
    return pipeGradeName(dn, pn.value, sn.value, { mvk: form.value.mvk })
  })

  /**
   * Марка БЕЗ префикса «Труба» — так в прототипе: подпись карточки уже
   * говорит, что это труба корпуса. Полное наименование (с префиксом) нужно
   * только строке расчёта — там оно ключ поиска цены.
   */
  const pipeMark = computed(() => pipeGrade.value?.replace(/^Труба\s+/, '') ?? null)

  /**
   * Пояснение расчёта — формулировка прототипа:
   * «расчётные: глубина 11 600 мм → SN 10000 · ТТ МВК».
   */
  const snExplain = computed(() => {
    if (depthMm.value == null || sn.value == null) return null
    const d = depthMm.value.toLocaleString('ru-RU')
    const flags = [
      form.value.underRoadway ? 'проезжая часть' : null,
      form.value.mvk ? 'ТТ МВК' : null,
    ].filter(Boolean)
    const tail = flags.length ? ` · ${flags.join(' · ')}` : ''
    return `расчётные: глубина ${d} мм → SN ${sn.value}${tail}`
  })

  // ── Арматура: вычисляемая с override ──

  // Задвижка на подводящем есть всегда — по одной на подводящий.
  const gatesCalc = computed(() => gateValveCount(num(form.value.podvKol) ?? 0))
  const gates = computed(() => num(form.value.zadvManual) ?? gatesCalc.value)
  const gatesOverridden = computed(() => num(form.value.zadvManual) != null)

  // Напорная сторона: по схеме завода там ЗАДВИЖКИ, а не шаровые краны —
  // на стояке каждого установленного насоса и на каждом отводящем патрубке.
  // Ключ формы остался прежним (kranManual): переименование осиротило бы
  // сохранённые опросные листы, а значение он несёт то же — ручной override.
  const pressureGatesCalc = computed(() =>
    pressureGateValveCount(
      num(form.value.nRab) ?? 0,
      num(form.value.nRez) ?? 0,
      num(form.value.napKol) ?? 0,
    ),
  )
  const pressureGates = computed(() => num(form.value.kranManual) ?? pressureGatesCalc.value)
  const pressureGatesOverridden = computed(() => num(form.value.kranManual) != null)

  // Обратные клапаны — по одному на установленный насос (включая резервный).
  const checkValvesCalc = computed(() =>
    checkValveCount(num(form.value.nRab) ?? 0, num(form.value.nRez) ?? 0),
  )
  const checkValves = computed(() => num(form.value.klapanManual) ?? checkValvesCalc.value)
  const checkValvesOverridden = computed(() => num(form.value.klapanManual) != null)

  // Формулировки разбивки — как в прототипе: он объясняет смысл, а не
  // повторяет арифметику («по кол-ву подводящих патрубков = 1»).
  const gatesExplain = computed(() => `по кол-ву подводящих патрубков = ${gatesCalc.value}`)
  const pressureGatesExplain = computed(
    () =>
      `насосов (${form.value.nRab}+${form.value.nRez}) + отводящих ${form.value.napKol} = ${pressureGatesCalc.value}` +
      (form.value.emergency ? ' · плюс задвижка аварийной линии' : ''),
  )
  const checkValvesExplain = computed(
    () => `по одному на установленный насос = ${checkValvesCalc.value}`,
  )

  // ── Полный габарит и мини-превью изделия ──

  const fullHeightMm = computed<number | null>(() =>
    depthMm.value == null ? null : depthMm.value + (num(form.value.vozv) ?? 0),
  )

  /** Заголовок изделия. Разряды пробелами — как в прототипе: «КНС 3 000×11 900 мм». */
  const title = computed(() => {
    const dn = num(form.value.dn)
    if (dn == null || fullHeightMm.value == null) return 'КНС'
    const f = (n: number) => n.toLocaleString('ru-RU')
    return `КНС ${f(dn)}×${f(fullHeightMm.value)} мм`
  })

  /** Обязательные поля: без них «Создать расчёт» заблокирована. */
  const missingRequired = computed<string[]>(() => {
    const miss: string[] = []
    if (num(form.value.dn) == null) miss.push('DN корпуса')
    if (num(form.value.podvLotok) == null) miss.push('глубина лотка подводящего')
    if (num(form.value.rashod) == null) miss.push('рабочий расход')
    if ((num(form.value.nRab) ?? 0) < 1) miss.push('кол-во рабочих насосов')
    if (depthMm.value == null) miss.push('глубина подземной части')
    return miss
  })

  const canCreate = computed(() => missingRequired.value.length === 0)

  return {
    depth,
    depthMm,
    depthOverridden,
    snCalc,
    sn,
    pn,
    pipeGrade,
    pipeMark,
    snExplain,
    gates,
    gatesCalc,
    gatesOverridden,
    gatesExplain,
    pressureGates,
    pressureGatesCalc,
    pressureGatesOverridden,
    pressureGatesExplain,
    checkValves,
    checkValvesCalc,
    checkValvesOverridden,
    checkValvesExplain,
    fullHeightMm,
    title,
    missingRequired,
    canCreate,
  }
}
