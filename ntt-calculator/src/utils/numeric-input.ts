/**
 * Числовые поля ввода: текст в них не попадает.
 *
 * Поле, значение которого превращается в число (`tryEvalExpr`), раньше
 * принимало что угодно: «двадцать», «≈150», «договорная». Парсер отвечал
 * `null`, и ввод молча превращался в «пусто» — цена трубы пропадала из
 * расчёта, расход становился незаполненным, а инженер видел в поле свой текст
 * и считал, что всё введено.
 *
 * Правило одно на всё приложение: в поле с классом `num` (или атрибутом
 * `data-numeric`) печатаются только символы грамматики выражений
 * (`engines/expr.ts`) — цифры, запятая и точка, пробел-разделитель разрядов,
 * `+ − * /`, скобки и `=` в начале, как в Excel. Буква просто не появляется;
 * вставленный текст очищается от лишнего. Если и после этого значение не
 * разбирается («2**3», «(»), поле подсвечивается и объясняет, что не так.
 *
 * Слушатели ставятся на документ в фазе перехвата: они срабатывают раньше
 * `v-model` самого поля, поэтому модель получает уже очищенное значение, а
 * размечать сотню полей по отдельности не нужно.
 *
 * @module utils/numeric-input
 */

import { tryEvalExpr } from '@/engines/expr'

/** Поля, к которым применяется правило. `type="number"` браузер стережёт сам. */
export const NUMERIC_SELECTOR = 'input.num:not([type="number"]), input[data-numeric]:not([type="number"])'

/**
 * Символ допустим в числовом поле: цифры, разделители дробной части и
 * разрядов (обычный, неразрывный и узкий неразрывный пробелы — их даёт вставка
 * отформатированных чисел; все три входят в \s), знаки выражения и «=» в начале.
 */
const ALLOWED_CHAR = /[0-9.,+\-*/()=\s]/

/** Подсказка у поля, которое не разобралось как число. */
export const INVALID_HINT = 'Только число или выражение: 12,5 · 980 000 · 2*3,1'

/** Убрать из строки всё, что не может быть частью числа или выражения. */
export function sanitizeNumeric(value: string): string {
  let out = ''
  for (const ch of value) if (ALLOWED_CHAR.test(ch)) out += ch
  return out
}

/** Строка допустима как числовой ввод: пусто или разбирается в число. */
export function isNumericValid(value: string): boolean {
  return value.trim() === '' || tryEvalExpr(value) != null
}

/**
 * На экране есть числовое поле, которое не разобралось как число.
 *
 * Им пользуется автосохранение ОЛ: сохранять лист с «2**3» в поле рано —
 * такое значение ушло бы в расчёт пустым, и расчёт пересобрался бы без него.
 */
export function hasInvalidNumericField(root: ParentNode = document): boolean {
  return root.querySelector('input.is-invalid') != null
}

function isNumericField(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && target.matches(NUMERIC_SELECTOR)
}

/** Подсветить поле по состоянию значения. */
function mark(el: HTMLInputElement) {
  const bad = !isNumericValid(el.value)
  el.classList.toggle('is-invalid', bad)
  if (bad) {
    el.setAttribute('aria-invalid', 'true')
    // Свою подсказку поля (формулу, «вернуть расчётное») не затираем навсегда:
    // прячем её на время ошибки и возвращаем, когда значение исправят.
    if (!el.dataset.titleBackup) el.dataset.titleBackup = el.title || ' '
    el.title = INVALID_HINT
  } else {
    el.removeAttribute('aria-invalid')
    if (el.dataset.titleBackup) {
      el.title = el.dataset.titleBackup.trim()
      delete el.dataset.titleBackup
    }
  }
}

/**
 * Поставить правило на документ. Возвращает функцию снятия — для тестов.
 */
export function installNumericGuard(root: Document = document): () => void {
  // Набор с клавиатуры: буква не вставляется вовсе — ни мигания, ни прыжка
  // курсора. Вставка целиком из недопустимого — тоже. А смесь («2а7», текст
  // из буфера, диктовка) пропускается: её вычистит onInput, сохранив цифры —
  // отказ целиком потерял бы и то, что введено правильно.
  const onBeforeInput = (e: Event) => {
    const ev = e as InputEvent
    if (!isNumericField(ev.target)) return
    if (ev.inputType.startsWith('insert') && ev.data != null && sanitizeNumeric(ev.data) === '' && ev.data !== '') {
      ev.preventDefault()
    }
  }

  // Вставка, автозаполнение, IME — всё, что прошло мимо beforeinput: чистим
  // значение ДО того, как его прочтёт v-model поля.
  const onInput = (e: Event) => {
    const el = e.target
    if (!isNumericField(el)) return
    const clean = sanitizeNumeric(el.value)
    if (clean !== el.value) {
      const caret = el.selectionStart ?? clean.length
      const removedBefore = el.value.slice(0, caret).length - sanitizeNumeric(el.value.slice(0, caret)).length
      el.value = clean
      const pos = Math.max(0, caret - removedBefore)
      el.setSelectionRange(pos, pos)
    }
    mark(el)
  }

  // Уход с поля и фокус: подсветить и то, что пришло из сохранённых данных.
  const onFocusChange = (e: Event) => {
    if (isNumericField(e.target)) mark(e.target)
  }

  root.addEventListener('beforeinput', onBeforeInput, true)
  root.addEventListener('input', onInput, true)
  root.addEventListener('focusin', onFocusChange, true)
  root.addEventListener('focusout', onFocusChange, true)

  return () => {
    root.removeEventListener('beforeinput', onBeforeInput, true)
    root.removeEventListener('input', onInput, true)
    root.removeEventListener('focusin', onFocusChange, true)
    root.removeEventListener('focusout', onFocusChange, true)
  }
}
