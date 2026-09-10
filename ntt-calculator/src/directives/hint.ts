import { reactive, type Directive } from 'vue'

/**
 * Всплывающие сноски с пояснениями — единое правило оформления (Дизайн-бриф
 * §8): у пункта или строки, где есть что пояснить, пояснение показывается
 * во всплывающем окне при наведении. Нативный `title` в шаблонах не
 * используется — он появляется через секунду, не переносит строки и
 * выглядит системной подсказкой, а не частью интерфейса (правило ESLint
 * `vue/no-restricted-static-attribute`).
 *
 * Два режима:
 *  - `v-hint` — пункт: подпись поля, строка итогов, кнопка. Появляется после
 *    короткой паузы и при фокусе с клавиатуры; у подписей — пунктир снизу,
 *    по нему видно, что сноска есть;
 *  - `v-hint.row` — строка таблицы. Пауза длиннее и считается от остановки
 *    указателя: при движении по таблице сноски не мелькают, а появляются
 *    там, где взгляд задержался.
 *
 * Прячется при уходе указателя, нажатии кнопки мыши, вводе с клавиатуры и
 * прокрутке — сноска не мешает работать с тем, что под ней.
 */

export interface Hint {
  /** Что это — первая строка сноски. */
  title?: string
  /** Пояснение: строка или несколько абзацев. */
  text?: string | ReadonlyArray<string>
  /** Правило расчёта — строки с ƒ. */
  formula?: string | ReadonlyArray<string>
  /** Откуда взято: лист эталона, справочник, поле ОЛ. */
  source?: string
  /** Тон: предупреждение (янтарь), ошибка (акцент), ручной ввод (синий). */
  tone?: 'warn' | 'error' | 'ovr'
}

export type HintValue = string | Hint | null | undefined | false

/** Сноска из значения директивы; пустое значение — сноски нет. */
export function toHint(value: HintValue): Hint | null {
  if (!value) return null
  if (typeof value === 'string') return value.trim() ? { text: value } : null
  const has = (v: string | ReadonlyArray<string> | undefined) =>
    v != null && (typeof v === 'string' ? v.trim() !== '' : v.some((s) => s.trim() !== ''))
  return has(value.title) || has(value.text) || has(value.formula) || has(value.source) ? value : null
}

export type HintMode = 'item' | 'row'

/** Паузы до показа, мс. У строк дольше: по таблице водят указателем. */
export const HINT_DELAY_MS: Record<HintMode, number> = { item: 300, row: 650 }

/** Id окна сноски — на него ссылается `aria-describedby` показанного пункта. */
export const HINT_ID = 'app-hint'

/** Что сейчас показано — читает слой сносок (components/ui/HintLayer.vue). */
export const hintView = reactive({
  hint: null as Hint | null,
  mode: 'item' as HintMode,
  /** Прямоугольник пункта на момент показа. */
  rect: null as { top: number; left: number; right: number; bottom: number } | null,
  /** Где стоял указатель — строка длинная, сноска встаёт рядом с ним. */
  pointerX: 0,
  /** Растёт с каждым показом: слой по нему переставляет окно. */
  seq: 0,
})

interface HintState {
  value: HintValue
  mode: HintMode
  x: number
  onEnter: (e: PointerEvent) => void
  onMove: (e: PointerEvent) => void
  onLeave: () => void
  onFocus: () => void
  onBlur: () => void
}

const states = new WeakMap<HTMLElement, HintState>()

let timer: ReturnType<typeof setTimeout> | null = null
let pending: HTMLElement | null = null
let current: HTMLElement | null = null

function cancel() {
  if (timer) clearTimeout(timer)
  timer = null
  pending = null
}

/** Прячет сноску. Вызывается и снаружи — например, при смене экрана. */
export function hideHint() {
  cancel()
  if (current) current.removeAttribute('aria-describedby')
  current = null
  hintView.hint = null
  hintView.rect = null
}

function show(el: HTMLElement) {
  const st = states.get(el)
  const hint = st ? toHint(st.value) : null
  if (!st || !hint || !el.isConnected) return
  if (current && current !== el) current.removeAttribute('aria-describedby')
  const r = el.getBoundingClientRect()
  current = el
  el.setAttribute('aria-describedby', HINT_ID)
  hintView.hint = hint
  hintView.mode = st.mode
  hintView.rect = { top: r.top, left: r.left, right: r.right, bottom: r.bottom }
  hintView.pointerX = st.mode === 'row' ? st.x : r.left
  hintView.seq += 1
}

function schedule(el: HTMLElement) {
  const st = states.get(el)
  if (!st || !toHint(st.value)) return
  cancel()
  pending = el
  timer = setTimeout(() => {
    timer = null
    pending = null
    show(el)
  }, HINT_DELAY_MS[st.mode])
}

let globalsInstalled = false

/**
 * Общие слушатели — один раз на документ: любое действие пользователя,
 * кроме наведения, убирает сноску, чтобы она не закрывала то, с чем работают.
 */
function installGlobals() {
  if (globalsInstalled || typeof document === 'undefined') return
  globalsInstalled = true
  const hideAll = () => {
    if (current || pending) hideHint()
  }
  document.addEventListener('pointerdown', hideAll, true)
  document.addEventListener('keydown', hideAll, true)
  document.addEventListener('scroll', hideAll, true)
  window.addEventListener('resize', hideAll)
  window.addEventListener('blur', hideAll)
}

/** Фокус с клавиатуры — показываем сразу; фокус щелчком — нет. */
function isKeyboardFocus(el: HTMLElement): boolean {
  try {
    return el.matches(':focus-visible')
  } catch {
    return false
  }
}

function attach(el: HTMLElement, value: HintValue, mode: HintMode) {
  const st: HintState = {
    value,
    mode,
    x: 0,
    onEnter: (e) => {
      // На сенсорном экране наведения нет: касание — это нажатие, и сноска
      // закрыла бы то, что нажимают.
      if (e.pointerType === 'touch' || e.buttons) return
      st.x = e.clientX
      schedule(el)
    },
    onMove: (e) => {
      st.x = e.clientX
      // Строка: пауза считается от остановки указателя. Уже показанная
      // сноска стоит на месте, пока указатель в строке.
      if (st.mode !== 'row' || current === el || e.buttons || e.pointerType === 'touch') return
      // Движение над кнопкой со своей сноской (↺, ✎) всплывает и сюда —
      // строка не должна перебивать сноску кнопки своей.
      const inner = e.target instanceof Element ? e.target.closest('[data-hint]') : null
      if (inner && inner !== el) return
      schedule(el)
    },
    onLeave: () => {
      if (pending === el) cancel()
      if (current === el) hideHint()
    },
    onFocus: () => {
      if (st.mode === 'item' && isKeyboardFocus(el)) {
        cancel()
        show(el)
      }
    },
    onBlur: () => {
      if (current === el) hideHint()
    },
  }
  states.set(el, st)
  el.addEventListener('pointerenter', st.onEnter)
  el.addEventListener('pointermove', st.onMove)
  el.addEventListener('pointerleave', st.onLeave)
  el.addEventListener('focusin', st.onFocus)
  el.addEventListener('focusout', st.onBlur)
}

function detach(el: HTMLElement) {
  const st = states.get(el)
  if (!st) return
  el.removeEventListener('pointerenter', st.onEnter)
  el.removeEventListener('pointermove', st.onMove)
  el.removeEventListener('pointerleave', st.onLeave)
  el.removeEventListener('focusin', st.onFocus)
  el.removeEventListener('focusout', st.onBlur)
  states.delete(el)
}

/**
 * Пунктир под подписью — знак сноски. Только у текста: у строк таблицы,
 * кнопок и полей его нет — там сноска и так ожидаема, а подчёркивание
 * читалось бы как ссылка.
 */
const MARKED_TAGS = new Set(['SPAN', 'DT', 'TH', 'ABBR', 'B', 'STRONG', 'EM', 'SUMMARY', 'H2', 'H3', 'H4'])

function syncMarks(el: HTMLElement, value: HintValue, mode: HintMode, modifiers: Partial<Record<string, boolean>>) {
  const has = toHint(value) != null
  if (has) el.setAttribute('data-hint', mode)
  else el.removeAttribute('data-hint')
  const mark = has && mode === 'item' && !modifiers.plain && (modifiers.mark || MARKED_TAGS.has(el.tagName))
  if (mark) el.setAttribute('data-hint-mark', '')
  else el.removeAttribute('data-hint-mark')
}

/**
 * Директива сноски.
 *
 * ```vue
 * <span v-hint="'Глубина от поверхности до лотка, мм'">Глубина лотка</span>
 * <span v-hint="{ title: 'SN', text: '…', formula: 'SN = …', source: 'лист …' }">SN</span>
 * <div v-hint.row="rowHint">…</div>
 * ```
 *
 * Модификаторы: `.row` — строка таблицы; `.mark` — пунктир и у блочного
 * элемента; `.plain` — без пунктира у текста.
 */
export const vHint: Directive<HTMLElement, HintValue> = {
  mounted(el, binding) {
    installGlobals()
    const mode: HintMode = binding.modifiers.row ? 'row' : 'item'
    attach(el, binding.value, mode)
    syncMarks(el, binding.value, mode, binding.modifiers)
  },
  updated(el, binding) {
    const st = states.get(el)
    if (!st) return
    st.value = binding.value
    syncMarks(el, binding.value, st.mode, binding.modifiers)
    if (current !== el) return
    // Сноска открыта, а пояснение изменилось (пересчёт) — показываем новое.
    const hint = toHint(binding.value)
    if (!hint) hideHint()
    else hintView.hint = hint
  },
  beforeUnmount(el) {
    if (current === el || pending === el) hideHint()
    detach(el)
  },
}

declare module 'vue' {
  interface GlobalDirectives {
    vHint: typeof vHint
  }
}
