import { computed, type ComputedRef, type Ref } from 'vue'
import { tryEvalExpr } from '@/engines/expr'
import { PN_SURVEY_DEFAULT } from '@/engines/survey-kns'

/**
 * Общий блок «труба корпуса: PN/SN расчётные с ручным override» — единая
 * механика всех трёх опросных листов (КНС/ЕМК/КОЛ): чекбокс `pipeManual`
 * раскрывает селекты, пустое значение селекта означает «расчётное».
 *
 * До выноса этот блок был скопирован в трёх composables дословно.
 */
export interface PipeManualFields {
  pipeManual: boolean
  pnManual: string
  snManual: string
}

export function usePipeOverride<T extends PipeManualFields>(
  form: Ref<T>,
  snCalc: ComputedRef<number | null>,
) {
  const num = (s: string): number | null => tryEvalExpr(s)

  const sn = computed<number | null>(() =>
    form.value.pipeManual ? (num(form.value.snManual) ?? snCalc.value) : snCalc.value,
  )

  const pn = computed<number>(() =>
    form.value.pipeManual ? (num(form.value.pnManual) ?? PN_SURVEY_DEFAULT) : PN_SURVEY_DEFAULT,
  )

  return { sn, pn }
}
