import { computed, type ComputedRef, type Ref } from 'vue'
import { tryEvalExpr } from '@/engines/expr'
import { PN_SURVEY_DEFAULT, SN_BASE } from '@/engines/survey-kns'

/**
 * Ручной SN трубы корпуса — только ступени завода, 5000 и 10000 (решение Р9,
 * План_устранения 3.8). Список предлагал ещё 1250 и 2500, но корпус завод
 * делает из двух жёсткостей (`SN_BASE`), а для 1250 в справочнике нет и веса
 * трубы.
 */
export const SN_MANUAL_OPTIONS: readonly string[] = [String(SN_BASE.normal), String(SN_BASE.raised)]

/**
 * Ручной SN, выбранный до сужения списка (1250, 2500). Лист хранит его и
 * считает по нему, пока инженер не выберет другой: итог сохранённого
 * расчёта сам не меняется. `null` — значение из списка или расчётное.
 */
export function legacySnManual(value: string): string | null {
  const v = value.trim()
  return v && !SN_MANUAL_OPTIONS.includes(v) ? v : null
}

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
