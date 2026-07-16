import { computed, type Ref } from 'vue'
import {
  ballValveCount,
  computeDepth,
  gateValveCount,
  pipeGradeName,
  PN_SURVEY_DEFAULT,
  snByDepth,
} from '@/engines/survey-kns'
import { tryEvalExpr } from '@/engines/expr'
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
      : snByDepth(depthMm.value, { underRoadway: form.value.underRoadway, mvk: form.value.mvk }),
  )

  const sn = computed<number | null>(() =>
    form.value.pipeManual ? (num(form.value.snManual) ?? snCalc.value) : snCalc.value,
  )

  const pn = computed<number>(() =>
    form.value.pipeManual ? (num(form.value.pnManual) ?? PN_SURVEY_DEFAULT) : PN_SURVEY_DEFAULT,
  )

  /** Марка трубы корпуса: PN здесь — из ОЛ, а не подобранная (ТЗ §9.4). */
  const pipeGrade = computed(() => {
    const dn = num(form.value.dn)
    if (dn == null || sn.value == null) return null
    return pipeGradeName(dn, pn.value, sn.value)
  })

  /** Пояснение расчёта SN — показывается под маркой. */
  const snExplain = computed(() => {
    if (depthMm.value == null) return null
    const base =
      depthMm.value > 8000
        ? 'глубина > 8000 мм → 10000'
        : depthMm.value > 5000
          ? 'глубина > 5000 мм → 5000'
          : depthMm.value > 3000
            ? 'глубина > 3000 мм → 2500'
            : 'глубина ≤ 3000 мм → 1250'
    const raised =
      form.value.underRoadway || form.value.mvk
        ? `, ${form.value.underRoadway ? 'проезжая часть' : 'ТТ МВК'} → на ступень выше`
        : ''
    return `SN: ${base}${raised}`
  })

  // ── Арматура: вычисляемая с override ──

  const gatesCalc = computed(() =>
    gateValveCount(num(form.value.podvKol) ?? 0, form.value.valveOnInlet),
  )
  const gates = computed(() => num(form.value.zadvManual) ?? gatesCalc.value)
  const gatesOverridden = computed(() => num(form.value.zadvManual) != null)

  const ballsCalc = computed(() =>
    ballValveCount(num(form.value.nRab) ?? 0, num(form.value.nRez) ?? 0, form.value.emergency),
  )
  const balls = computed(() => num(form.value.kranManual) ?? ballsCalc.value)
  const ballsOverridden = computed(() => num(form.value.kranManual) != null)

  const gatesExplain = computed(
    () => `= подводящих (${form.value.podvKol}) × ${form.value.valveOnInlet ? 'арматура на подводящем' : 'без арматуры'}`,
  )
  const ballsExplain = computed(
    () =>
      `= раб ${form.value.nRab} + рез ${form.value.nRez} + коллектор 1${form.value.emergency ? ' + аварийный 1' : ''}`,
  )

  // ── Полный габарит и мини-превью изделия ──

  const fullHeightMm = computed<number | null>(() =>
    depthMm.value == null ? null : depthMm.value + (num(form.value.vozv) ?? 0),
  )

  const title = computed(() => {
    const dn = num(form.value.dn)
    if (dn == null || fullHeightMm.value == null) return 'КНС'
    return `КНС ${dn}×${fullHeightMm.value} мм`
  })

  /** Обязательные поля: без них «Создать расчёт» заблокирована. */
  const missingRequired = computed<string[]>(() => {
    const miss: string[] = []
    if (num(form.value.dn) == null) miss.push('DN корпуса')
    if (num(form.value.podvLotok) == null) miss.push('глубина лотка подводящего')
    if (num(form.value.rashod) == null) miss.push('максимальный приток')
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
    snExplain,
    gates,
    gatesCalc,
    gatesOverridden,
    gatesExplain,
    balls,
    ballsCalc,
    ballsOverridden,
    ballsExplain,
    fullHeightMm,
    title,
    missingRequired,
    canCreate,
  }
}
