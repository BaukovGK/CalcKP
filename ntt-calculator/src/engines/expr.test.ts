import { describe, expect, it } from 'vitest'
import { evalExpr, ExprError, tryEvalExpr } from './expr'

const NBSP = ' '
const NNBSP = ' '

describe('evalExpr', () => {
  it('вычисляет выражение из Механики §5.1', () => {
    expect(evalExpr('1.55*2+2.88*2')).toBeCloseTo(8.86, 10)
  })

  it('принимает запятую как десятичный разделитель', () => {
    expect(evalExpr('1,55*2+2,88*2')).toBeCloseTo(8.86, 10)
    expect(evalExpr('0,5')).toBe(0.5)
  })

  it('принимает ведущий «=» (привычка из Excel)', () => {
    expect(evalExpr('=1.55*2+2.88*2')).toBeCloseTo(8.86, 10)
  })

  it('соблюдает приоритет операций и скобки', () => {
    expect(evalExpr('2+3*4')).toBe(14)
    expect(evalExpr('(2+3)*4')).toBe(20)
    expect(evalExpr('2*(3+4)/7')).toBe(2)
  })

  it('поддерживает унарный минус', () => {
    expect(evalExpr('-5+8')).toBe(3)
    expect(evalExpr('-(2+3)')).toBe(-5)
    expect(evalExpr('--3')).toBe(3)
  })

  it('игнорирует пробелы вокруг операторов', () => {
    expect(evalExpr(' 1.5 * 2 ')).toBe(3)
  })

  it('простое число возвращается как есть', () => {
    expect(evalExpr('11.6')).toBe(11.6)
  })
})

// UI выводит числа через toLocaleString('ru-RU') с разрядами (README хендоффа:
// «980000 → 980 000»), поэтому такое значение реально может вернуться во ввод.
describe('evalExpr — разряды', () => {
  it('склеивает группы из 3 цифр через обычный пробел', () => {
    expect(evalExpr('980 000')).toBe(980000)
    expect(evalExpr('1 234 567')).toBe(1234567)
    expect(evalExpr('12 000*2')).toBe(24000)
  })

  it('склеивает разряды через неразрывный пробел', () => {
    expect(evalExpr(`980${NBSP}000`)).toBe(980000)
    expect(evalExpr(`1${NNBSP}234${NNBSP}567`)).toBe(1234567)
  })

  // Правило узкое намеренно: склеиваются только группы ровно из 3 цифр.
  // Иначе опечатка «1 2» тихо превратилась бы в «12».
  it('НЕ склеивает то, что разрядами не является', () => {
    expect(() => evalExpr('1 2')).toThrow(ExprError)
    expect(() => evalExpr('1 22')).toThrow(ExprError)
    expect(() => evalExpr('1 2222')).toThrow(ExprError)
  })
})

describe('evalExpr — безопасность и валидация', () => {
  // Ключевое требование Библиотеки §4: парсер без функций, без eval.
  // Значение приходит от пользователя и попадает в расчёт стоимости.
  it.each([
    ['process.exit(1)'],
    ['(()=>1)()'],
    ['1;alert(1)'],
    ['constructor'],
    ['globalThis'],
    ['2**10'],
    ['Math.max(1,2)'],
    ['import("fs")'],
  ])('отвергает недопустимый ввод: %s', (input) => {
    expect(() => evalExpr(input)).toThrow(ExprError)
  })

  it.each([['1+'], ['(1+2'], ['1++'], [''], ['   '], ['abc']])(
    'отвергает некорректное выражение: «%s»',
    (input) => {
      expect(() => evalExpr(input)).toThrow(ExprError)
    },
  )

  it('деление на ноль — ошибка, а не Infinity', () => {
    expect(() => evalExpr('5/0')).toThrow(ExprError)
  })
})

describe('tryEvalExpr', () => {
  it('возвращает null вместо исключения', () => {
    expect(tryEvalExpr('мусор')).toBeNull()
    expect(tryEvalExpr(null)).toBeNull()
    expect(tryEvalExpr(undefined)).toBeNull()
    expect(tryEvalExpr('')).toBeNull()
  })

  it('на корректном вводе возвращает число', () => {
    expect(tryEvalExpr('2*3')).toBe(6)
  })
})
