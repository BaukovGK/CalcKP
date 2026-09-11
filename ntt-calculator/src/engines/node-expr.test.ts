import { describe, expect, it } from 'vitest'
import {
  checkFormula,
  checkNameTemplate,
  evalFormulaText,
  formulaFn,
  formulaVars,
  formulaWithValues,
  parseFormula,
  renderNameTemplate,
  type VarKind,
} from './node-expr'
import { ladder, pipePrepHours, pumpLiftChainM, topSlabMassKg } from './formulas'
import { roundUp } from './rounding'
import { sleeveDiameter } from './survey-kns'

const ev = (src: string, scope: Record<string, number | boolean | string | null> = {}) => evalFormulaText(src, scope)
const kinds = (o: Record<string, VarKind>) => new Map(Object.entries(o))

describe('выражения каталога: арифметика', () => {
  it('приоритеты, скобки, унарный минус, запятая — десятичная', () => {
    expect(ev('2 + 3 * 4')).toBe(14)
    expect(ev('(2 + 3) * 4')).toBe(20)
    expect(ev('-2 * -3')).toBe(6)
    expect(ev('1,5 * 2')).toBe(3)
    expect(ev('=10 / 4')).toBe(2.5)
  })

  it('сравнения дают 1 и 0', () => {
    expect(ev('dn >= 2000', { dn: 2000 })).toBe(1)
    expect(ev('dn > 2000', { dn: 2000 })).toBe(0)
    expect(ev('dn <> 2000', { dn: 1500 })).toBe(1)
    expect(ev('0,1 + 0,2 = 0,3')).toBe(1)
  })

  it('переменные: числа, логика как 1/0, пустое значение — пустой результат', () => {
    expect(ev('h * 2', { h: 11.6 })).toBeCloseTo(23.2, 9)
    expect(ev('n * 4', { n: true })).toBe(4)
    expect(ev('h * 2', { h: null })).toBeNull()
  })

  it('деление на ноль, неизвестное имя и текст в формуле — ошибки', () => {
    expect(() => ev('1 / (a - a)', { a: 3 })).toThrow(/Деление на ноль/)
    expect(() => ev('x + 1')).toThrow(/Неизвестное имя «x»/)
    expect(() => ev('model * 2', { model: 'VSL' })).toThrow(/текст/)
  })

  it('кириллические имена параметров', () => {
    expect(ev('Н * 2', { Н: 3 })).toBe(6)
  })
})

describe('выражения каталога: функции реестра', () => {
  it('ОКРВВЕРХ — тот же roundUp, что считает эталон; английское имя тоже работает', () => {
    expect(ev('ОКРВВЕРХ(h / 0,35; 0)', { h: 11.6 })).toBe(roundUp(11.6 / 0.35, 0))
    expect(ev('roundup(1234; -2)')).toBe(1300)
    expect(ev('ОКРУГЛ(2,345; 2)')).toBe(2.35)
    expect(ev('ОКРВНИЗ(2,349; 2)')).toBe(2.34)
  })

  it('предметные функции — обёртки над реестром formulas.ts: узел технолога и встроенный считают одинаково', () => {
    expect(ev('pipePrepHours(3000; 11,6)')).toBe(pipePrepHours(3000, 11.6))
    expect(ev('ladderRungPipeM(11,6)')).toBe(ladder(11.6).rungPipeM)
    expect(ev('ladderHours(11,6)')).toBe(ladder(11.6).fabricationHours)
    expect(ev('pumpLiftChainM(3; 12,1)')).toBe(pumpLiftChainM(3, 12.1))
    expect(ev('topSlabMassKg(3000)')).toBe(topSlabMassKg(3000))
    expect(ev('sleeveDiameter(250)')).toBe(sleeveDiameter(250))
  })

  it('МАКС/МИН с любым числом аргументов, логика Excel', () => {
    expect(ev('МАКС(1; 7; 3)')).toBe(7)
    expect(ev('МИН(4; 2)')).toBe(2)
    expect(ev('И(1; 1; 0)')).toBe(0)
    expect(ev('ИЛИ(0; 0; 2)')).toBe(1)
    expect(ev('НЕ(0)')).toBe(1)
  })

  it('ЕСЛИ ленива: пустое поле в невыбранной ветке результат не обнуляет', () => {
    expect(ev('ЕСЛИ(flag; depth; 0)', { flag: false, depth: null })).toBe(0)
    expect(ev('ЕСЛИ(flag; depth; 0)', { flag: true, depth: null })).toBeNull()
    expect(ev('ЕСЛИ(dn >= 2000; 7; 6)', { dn: 2500 })).toBe(7)
    expect(ev('ЕСЛИ(0; 5)')).toBe(0)
  })

  it('справочники — через контекст; без него значения нет', () => {
    const refs = { nozzleNormOf: (dn: number) => (dn === 300 ? { dn, odMm: null, minLengthMm: null, moldingMassKg: 0.7, h1Mm: null, s1Mm: null, flangeMassKg: 2.9, bolt: null, boltCount: null } : null) }
    expect(evalFormulaText('nozzleMoldingKg(300) * 2', {}, refs)).toBeCloseTo(1.4, 9)
    expect(evalFormulaText('flangeMoldingKg(300)', {}, refs)).toBe(2.9)
    expect(evalFormulaText('nozzleMoldingKg(350)', {}, refs)).toBeNull()
    expect(ev('jointLayerKg(3000)')).toBeNull()
  })

  it('число аргументов проверяется', () => {
    expect(() => ev('ОКРВВЕРХ()')).toThrow(/нужно аргументов — 1/)
    expect(() => ev('bottomMassKg(1; 2)')).toThrow(/не больше 1/)
    expect(() => ev('нетТакой(1)')).toThrow(/Неизвестная функция/)
  })

  it('запятая вместо «;» между аргументами — понятная ошибка', () => {
    expect(() => parseFormula('ОКРВВЕРХ(h, 0)')).toThrow(/разделяются «;»/)
    expect(() => parseFormula('ОКРВВЕРХ(h,0)')).toThrow(/разделяются «;»/)
  })

  it('имена функций не зависят от регистра', () => {
    expect(formulaFn('окрвверх')?.name).toBe('ОКРВВЕРХ')
    expect(formulaFn('ROUNDUP')?.name).toBe('ОКРВВЕРХ')
    expect(formulaFn('PIPEPREPHOURS')?.name).toBe('pipePrepHours')
  })
})

describe('выражения каталога: проверка и печать', () => {
  const vars = kinds({ h: 'number', on: 'bool', model: 'text' })

  it('checkFormula ловит ошибки до публикации', () => {
    expect(checkFormula('ОКРВВЕРХ(h * 2; 0) + on', vars)).toBeNull()
    expect(checkFormula('h * k', vars)).toMatch(/Неизвестное имя «k»/)
    expect(checkFormula('model + 1', vars)).toMatch(/текст/)
    expect(checkFormula('ОКРВВЕРХ()', vars)).toMatch(/нужно аргументов/)
    expect(checkFormula('h *', vars)).toMatch(/оборвано/)
    expect(checkFormula('h # 2', vars)).toMatch(/Недопустимый символ/)
  })

  it('formulaVars — имена, на которые ссылается выражение', () => {
    expect(formulaVars('ОКРВВЕРХ(h / step; 0) + h')).toEqual(['h', 'step'])
    expect(formulaVars('h +')).toEqual([])
  })

  it('пояснение строки: формула со значениями, скобки только где нужны', () => {
    const scope = { h: 11.6, n: 3 }
    expect(formulaWithValues(parseFormula('ОКРВВЕРХ(h / 0,35; 0)'), scope)).toBe('ОКРВВЕРХ(11,6 / 0,35; 0)')
    expect(formulaWithValues(parseFormula('n * (h + 1)'), scope)).toBe('3 × (11,6 + 1)')
    expect(formulaWithValues(parseFormula('n - (h - 1)'), scope)).toBe('3 − (11,6 − 1)')
    expect(formulaWithValues(parseFormula('n * h + 1'), scope)).toBe('3 × 11,6 + 1')
  })
})

describe('шаблоны наименований', () => {
  const scope = { a: 40, t: 3, model: 'VSL 50', on: true, d: null }

  it('вставки — значения параметров и формулы; числа без разрядов, как в прайсе', () => {
    expect(renderNameTemplate('Уголок {a}х{a}х{t}мм', scope)).toBe('Уголок 40х40х3мм')
    expect(renderNameTemplate('Насос {model}', scope)).toBe('Насос VSL 50')
    expect(renderNameTemplate('Гильза Ø{sleeveDiameter(250)}', {})).toBe('Гильза Ø400')
    expect(renderNameTemplate('Труба L={a * 100} мм', scope)).toBe('Труба L=4000 мм')
    expect(renderNameTemplate('Утеплитель: {on}', scope)).toBe('Утеплитель: да')
  })

  it('пустое значение и ошибка — «?»: строка остаётся видимой и красной', () => {
    expect(renderNameTemplate('Площадка Ø{d}', scope)).toBe('Площадка Ø?')
    expect(renderNameTemplate('Площадка {x + 1}', scope)).toBe('Площадка ?')
  })

  it('проверка шаблона', () => {
    const vars = kinds({ a: 'number', model: 'text' })
    expect(checkNameTemplate('Уголок {a}х{a} {model}', vars)).toBeNull()
    expect(checkNameTemplate('Уголок {b}', vars)).toMatch(/Неизвестное имя «b»/)
    expect(checkNameTemplate('Уголок {a', vars)).toMatch(/Непарные/)
    expect(checkNameTemplate('Уголок {}', vars)).toMatch(/Пустая вставка/)
  })
})
