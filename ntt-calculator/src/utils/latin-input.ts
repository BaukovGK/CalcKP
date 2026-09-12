/**
 * Логин вводится латиницей: русская раскладка в поле не попадает.
 *
 * Логин — это адрес почты, и «admin@ntt.local», набранное при включённой
 * русской раскладке, выглядит как «фвьшт@тее.дщсфд». Сервер отвечает «неверный
 * email или пароль», и человек ищет ошибку в пароле, хотя дело в раскладке.
 * Поэтому кириллица (и любая другая нелатиница) в поле просто не печатается, а
 * поле говорит почему.
 *
 * Правило одно на всё приложение и ставится на документ, как у числовых полей
 * (`utils/numeric-input.ts`): достаточно пометить поле атрибутом `data-latin`.
 *
 * Пароль этому правилу НЕ подчиняется: он может быть любым, и запрет символов
 * сузил бы его. Пустой ввод и проверка формата адреса — дело формы и сервера,
 * здесь только набор символов.
 *
 * @module utils/latin-input
 */

/** Поля, к которым применяется правило. */
export const LATIN_SELECTOR = 'input[data-latin]'

/**
 * Что допустимо в логине: латинские буквы, цифры и знаки адреса почты.
 * Пробела здесь нет намеренно — в адресе его не бывает.
 */
const ALLOWED_CHAR = /[A-Za-z0-9@._+-]/

/** Событие поля: ввод отклонён (или снова принят). Его слушают экраны. */
export const LATIN_BLOCKED_EVENT = 'latin-blocked'

/** Почему символ не появился — подсказка экрана, а не браузерный `title`. */
export const LATIN_ONLY_HINT = 'Логин вводится латиницей — похоже, включена русская раскладка'

/** Убрать из строки всё, что не может быть частью логина. */
export function sanitizeLatin(value: string): string {
  let out = ''
  for (const ch of value) if (ALLOWED_CHAR.test(ch)) out += ch
  return out
}

/** В строке есть символы, которых в логине быть не может. */
export function hasNonLatin(value: string): boolean {
  return sanitizeLatin(value) !== value
}

/**
 * Поля, у которых браузер разрешает читать и ставить положение курсора.
 * У `type="email"` (а это ровно наше поле логина) `selectionStart` и
 * `setSelectionRange` бросают InvalidStateError — по спецификации выбор
 * текста поддерживают только эти типы.
 */
const SELECTABLE_TYPES = new Set(['text', 'search', 'url', 'tel', 'password'])

function isLatinField(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && target.matches(LATIN_SELECTOR)
}

/**
 * Сообщить полю и экрану, что ввод отклонён или снова принят.
 *
 * Событие шлётся только на смену состояния: иначе каждая буква правильного
 * логина слала бы «всё хорошо», а подсказка мигала бы.
 */
function notify(el: HTMLInputElement, blocked: boolean) {
  const was = el.dataset.latinBlocked === '1'
  if (was === blocked) return
  if (blocked) el.dataset.latinBlocked = '1'
  else delete el.dataset.latinBlocked
  el.dispatchEvent(new CustomEvent(LATIN_BLOCKED_EVENT, { bubbles: true, detail: { blocked } }))
}

/**
 * Поставить правило на документ. Возвращает функцию снятия — для тестов.
 */
export function installLatinGuard(root: Document = document): () => void {
  // Набор с клавиатуры: недопустимый символ не вставляется вовсе — ни мигания,
  // ни прыжка курсора. Смесь («adminф») пропускается сюда и вычищается ниже:
  // отказ целиком потерял бы и то, что набрано верно.
  const onBeforeInput = (e: Event) => {
    const ev = e as InputEvent
    if (!isLatinField(ev.target)) return
    if (ev.inputType.startsWith('insert') && ev.data != null && ev.data !== '' && sanitizeLatin(ev.data) === '') {
      ev.preventDefault()
      notify(ev.target, true)
    }
  }

  // Вставка из буфера, автозаполнение, экранная клавиатура — всё, что прошло
  // мимо beforeinput: чистим значение ДО того, как его прочтёт v-model.
  const onInput = (e: Event) => {
    const el = e.target
    if (!isLatinField(el)) return
    const clean = sanitizeLatin(el.value)
    if (clean !== el.value) {
      // Курсор возвращаем на место только там, где это разрешено: у поля
      // логина (type="email") обращение к выбору текста — исключение, и
      // из-за него не должна пропадать сама очистка значения.
      const selectable = SELECTABLE_TYPES.has(el.type)
      const caret = selectable ? (el.selectionStart ?? clean.length) : null
      // Сколько убрано ЛЕВЕЕ курсора — считаем по грязному значению, до замены.
      const pos = caret == null ? null : Math.max(0, sanitizeLatin(el.value.slice(0, caret)).length)
      el.value = clean
      if (pos != null) el.setSelectionRange(pos, pos)
      notify(el, true)
    } else {
      notify(el, false)
    }
  }

  root.addEventListener('beforeinput', onBeforeInput, true)
  root.addEventListener('input', onInput, true)

  return () => {
    root.removeEventListener('beforeinput', onBeforeInput, true)
    root.removeEventListener('input', onInput, true)
  }
}
