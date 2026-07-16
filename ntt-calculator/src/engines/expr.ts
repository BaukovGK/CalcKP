/**
 * Безопасный парсер арифметических выражений для ручного ввода количеств.
 *
 * Механика §5.1: «Ввод qtyManual разрешает произвольные арифметические
 * выражения (1.55*2+2.88*2) — в Excel так считают длины; выражение
 * сохраняется, отображается результат».
 *
 * Библиотека §4: «вычисляемые безопасным парсером арифметики без функций».
 * eval / Function / new Function здесь недопустимы: значение приходит от
 * пользователя и попадает в расчёт стоимости.
 *
 * Грамматика (рекурсивный спуск):
 *   expr   := term (('+' | '-') term)*
 *   term   := unary (('*' | '/') unary)*
 *   unary  := ('+' | '-')* primary
 *   primary:= number | '(' expr ')'
 *
 * Функций, переменных и возведения в степень нет — намеренно.
 */

export class ExprError extends Error {}

interface Token {
  kind: 'num' | 'op' | 'lparen' | 'rparen'
  value: string
  pos: number
}

const OPS = new Set(['+', '-', '*', '/'])

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < input.length) {
    const ch = input[i]!

    // Пробелы вокруг операторов: обычный, табуляция, неразрывный (U+00A0) и
    // узкий неразрывный (U+202F) — два последних приходят из вставки
    // отформатированных чисел.
    if (/[ 	  ]/.test(ch)) {
      i++
      continue
    }

    if (ch === '(') {
      tokens.push({ kind: 'lparen', value: ch, pos: i++ })
      continue
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', value: ch, pos: i++ })
      continue
    }
    if (OPS.has(ch)) {
      tokens.push({ kind: 'op', value: ch, pos: i++ })
      continue
    }

    // Число: и точка, и запятая как десятичный разделитель — инженер вводит
    // «1,55», раскладка русская.
    if ((ch >= '0' && ch <= '9') || ch === '.' || ch === ',') {
      const start = i
      let seenSep = false
      while (i < input.length) {
        const c = input[i]!
        if (c >= '0' && c <= '9') {
          i++
        } else if ((c === '.' || c === ',') && !seenSep) {
          seenSep = true
          i++
        } else {
          break
        }
      }
      const raw = input.slice(start, i).replace(',', '.')
      if (raw === '.' || raw === '') throw new ExprError(`Некорректное число в позиции ${start + 1}`)
      tokens.push({ kind: 'num', value: raw, pos: start })
      continue
    }

    throw new ExprError(`Недопустимый символ «${ch}» в позиции ${i + 1}`)
  }

  return tokens
}

function parse(tokens: Token[]): number {
  let pos = 0

  const peek = (): Token | undefined => tokens[pos]
  const eat = (): Token => {
    const t = tokens[pos]
    if (!t) throw new ExprError('Выражение оборвано')
    pos++
    return t
  }

  function primary(): number {
    const t = eat()
    if (t.kind === 'num') {
      const n = Number(t.value)
      if (!Number.isFinite(n)) throw new ExprError(`Некорректное число «${t.value}»`)
      return n
    }
    if (t.kind === 'lparen') {
      const v = expr()
      const close = peek()
      if (!close || close.kind !== 'rparen') throw new ExprError('Не закрыта скобка')
      pos++
      return v
    }
    throw new ExprError(`Ожидалось число, получено «${t.value}»`)
  }

  function unary(): number {
    const t = peek()
    if (t?.kind === 'op' && (t.value === '-' || t.value === '+')) {
      pos++
      const v = unary()
      return t.value === '-' ? -v : v
    }
    return primary()
  }

  function term(): number {
    let left = unary()
    for (;;) {
      const t = peek()
      if (t?.kind !== 'op' || (t.value !== '*' && t.value !== '/')) return left
      pos++
      const right = unary()
      if (t.value === '/') {
        if (right === 0) throw new ExprError('Деление на ноль')
        left = left / right
      } else {
        left = left * right
      }
    }
  }

  function expr(): number {
    let left = term()
    for (;;) {
      const t = peek()
      if (t?.kind !== 'op' || (t.value !== '+' && t.value !== '-')) return left
      pos++
      const right = term()
      left = t.value === '+' ? left + right : left - right
    }
  }

  const result = expr()
  if (pos < tokens.length) {
    throw new ExprError(`Лишний фрагмент «${tokens[pos]!.value}» в позиции ${tokens[pos]!.pos + 1}`)
  }
  return result
}

/**
 * Убирает пробел-разделитель разрядов внутри чисел: «980 000» → «980000».
 *
 * Сознательно узкое правило — пробел склеивается только перед группой ровно из
 * трёх цифр. Иначе «1 2» молча превратилось бы в «12», а это не разряды, а
 * опечатка, и её надо показать пользователю. UI выводит числа через
 * toLocaleString('ru-RU'), поэтому такой ввод реален (README хендоффа).
 */
function stripDigitGrouping(s: string): string {
  //   обычный ·   неразрывный (его даёт toLocaleString('ru-RU') в Node)
  // ·   узкий неразрывный (его даёт ICU в части браузеров).
  return s.replace(/(\d)[   ](?=\d{3}(?!\d))/g, '$1')
}

/**
 * Вычисляет арифметическое выражение. Бросает {@link ExprError} на некорректном
 * вводе — вызывающий код решает, показать ошибку или трактовать строку как пустую.
 */
export function evalExpr(input: string): number {
  const trimmed = input.trim()
  if (!trimmed) throw new ExprError('Пустое выражение')

  // В Excel ручной ввод часто начинается с «=» — принимаем и такую форму.
  const body = stripDigitGrouping(trimmed.startsWith('=') ? trimmed.slice(1) : trimmed)

  const value = parse(tokenize(body))
  if (!Number.isFinite(value)) throw new ExprError('Результат не является числом')
  return value
}

/** Мягкий вариант: возвращает `null` вместо исключения. */
export function tryEvalExpr(input: string | null | undefined): number | null {
  if (input == null) return null
  try {
    return evalExpr(input)
  } catch {
    return null
  }
}
