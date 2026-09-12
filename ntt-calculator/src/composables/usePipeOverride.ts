import { computed, type ComputedRef, type Ref } from 'vue'
import { tryEvalExpr } from '@/engines/expr'
import { PN_SURVEY_DEFAULT, SN_BASE, snDesignation } from '@/engines/survey-kns'

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

/** Ступень списка: в форму идёт расчётная жёсткость, инженер видит обозначение. */
export interface SnOption {
  /** Значение поля — расчётная жёсткость: по ней вес трубы и трудоёмкость. */
  value: string
  /** Что видно в списке: по ТТ МВК та же труба маркируется 8000 и 12000. */
  label: string
}

/**
 * Ступени для списка с учётом ТТ МВК. Под требованиями МВК изделие маркируется
 * 8000 и 12000 — это те же трубы SN 5000 и 10000 с двумя нитками ровинга
 * ({@link snDesignation}), и марка в карточке показывает именно обозначение.
 * Список обязан говорить на том же языке, иначе инженер выбирает «10000», а в
 * марке видит «12000» и не понимает, та ли это ступень. В форме при этом
 * хранится расчётная жёсткость: по ней ищется вес трубы, и снятая галочка ТТ
 * МВК ничего не ломает.
 */
export function snManualOptions(mvk = false): SnOption[] {
  return SN_MANUAL_OPTIONS.map((value) => ({ value, label: String(snDesignation(Number(value), { mvk })) }))
}

/** Подпись выбранного раньше SN: обозначения у 1250 и 2500 свои же. */
export function snManualLabel(value: string, mvk = false): string {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? String(snDesignation(n, { mvk })) : value
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
