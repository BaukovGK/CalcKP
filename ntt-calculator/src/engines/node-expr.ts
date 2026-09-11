/**
 * Выражения каталога узлов: количества строк, условия и биндинги шаблона
 * (Библиотека §4, §6.2).
 *
 * Формулы остаются кодом (Библиотека §6, п. 4): выражение лишь связывает
 * параметры узла с функциями реестра `FORMULA_FNS` арифметикой — так ячейка
 * листа эталона связывает соседние ячейки. Новая функция — релиз; новый узел
 * из имеющихся функций — запись каталога без релиза.
 *
 * Отличия от `expr.ts` (ручной ввод количеств в расчёте): здесь есть
 * переменные — параметры узла или поля ОЛ, — вызовы функций реестра и
 * сравнения. Разделитель аргументов — «;», как в русском Excel: запятая здесь
 * десятичная.
 *
 * Грамматика (рекурсивный спуск):
 *   cmp     := sum (('=' | '<>' | '<' | '>' | '<=' | '>=') sum)?
 *   sum     := term (('+' | '-') term)*
 *   term    := unary (('*' | '/') unary)*
 *   unary   := ('+' | '-')* primary
 *   primary := число | имя | имя '(' [cmp (';' cmp)*] ')' | '(' cmp ')'
 *
 * Сравнение даёт 1 или 0; логические параметры в формуле — тоже 1 и 0.
 * eval и Function не используются: выражение пишет технолог, а результат
 * уходит в стоимость.
 */

import {
  anchorCount,
  bottomJointLaminationKg,
  bottomMassKg,
  cutoutHours,
  frameHours,
  ladder,
  laminationMassKg,
  marketableAppearanceHours,
  pipeLengthM,
  pipePrepHours,
  pumpGuidesM,
  pumpLiftChainM,
  topSlabMassKg,
} from './formulas'
import { ExprError } from './expr'
import { roundUp } from './rounding'
import { sleeveDiameter } from './survey-kns'
import type { MaterializeContext } from './template-kns'

export { ExprError }

// ─── Разбор ──────────────────────────────────────────────────────────────────

export type CmpOp = '=' | '<>' | '<' | '>' | '<=' | '>='

export type FormulaNode =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string; pos: number }
  | { t: 'call'; fn: string; args: FormulaNode[]; pos: number }
  | { t: 'neg'; e: FormulaNode }
  | { t: 'bin'; op: '+' | '-' | '*' | '/'; l: FormulaNode; r: FormulaNode }
  | { t: 'cmp'; op: CmpOp; l: FormulaNode; r: FormulaNode }

interface Token {
  kind: 'num' | 'name' | 'op' | 'cmp' | 'lparen' | 'rparen' | 'semi'
  value: string
  pos: number
  /** Исходный текст числа — «,5» выдаёт запятую вместо «;» между аргументами. */
  src?: string
}

const ARG_SEPARATOR_HINT = 'аргументы функции разделяются «;» — запятая здесь десятичная'

/** Буква имени: латиница, кириллица, подчёркивание. */
const NAME_START = /[A-Za-zА-Яа-яЁё_]/
const NAME_PART = /[A-Za-zА-Яа-яЁё_0-9]/

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === '(') { tokens.push({ kind: 'lparen', value: ch, pos: i++ }); continue }
    if (ch === ')') { tokens.push({ kind: 'rparen', value: ch, pos: i++ }); continue }
    if (ch === ';') { tokens.push({ kind: 'semi', value: ch, pos: i++ }); continue }
    if ('+-*/'.includes(ch)) { tokens.push({ kind: 'op', value: ch, pos: i++ }); continue }
    if (ch === '<' || ch === '>' || ch === '=') {
      const two = input.slice(i, i + 2)
      if (two === '<=' || two === '>=' || two === '<>') {
        tokens.push({ kind: 'cmp', value: two, pos: i })
        i += 2
      } else {
        tokens.push({ kind: 'cmp', value: ch, pos: i++ })
      }
      continue
    }
    if ((ch >= '0' && ch <= '9') || ch === '.' || ch === ',') {
      const start = i
      let seenSep = false
      while (i < input.length) {
        const c = input[i]!
        if (c >= '0' && c <= '9') i++
        else if ((c === '.' || c === ',') && !seenSep) { seenSep = true; i++ }
        else break
      }
      const src = input.slice(start, i)
      const raw = src.replace(',', '.')
      if (raw === '.') {
        throw new ExprError(src === ',' ? `Запятая в позиции ${start + 1}: ${ARG_SEPARATOR_HINT}` : `Некорректное число в позиции ${start + 1}`)
      }
      tokens.push({ kind: 'num', value: raw, pos: start, src })
      continue
    }
    if (NAME_START.test(ch)) {
      const start = i
      while (i < input.length && NAME_PART.test(input[i]!)) i++
      tokens.push({ kind: 'name', value: input.slice(start, i), pos: start })
      continue
    }
    throw new ExprError(`Недопустимый символ «${ch}» в позиции ${i + 1}`)
  }
  return tokens
}

/**
 * Разбирает выражение в дерево. Бросает {@link ExprError} с позицией ошибки.
 * Начальный «=» допускается — так формулы пишут в Excel.
 */
export function parseFormula(input: string): FormulaNode {
  const body = input.trim().replace(/^=/, '')
  if (!body.trim()) throw new ExprError('Пустое выражение')
  const tokens = tokenize(body)
  let pos = 0
  const peek = (): Token | undefined => tokens[pos]
  const eat = (): Token => {
    const t = tokens[pos]
    if (!t) throw new ExprError('Выражение оборвано')
    pos++
    return t
  }

  function primary(): FormulaNode {
    const t = eat()
    if (t.kind === 'num') {
      const v = Number(t.value)
      if (!Number.isFinite(v)) throw new ExprError(`Некорректное число «${t.value}»`)
      return { t: 'num', v }
    }
    if (t.kind === 'name') {
      if (peek()?.kind !== 'lparen') return { t: 'var', name: t.value, pos: t.pos }
      pos++
      const args: FormulaNode[] = []
      if (peek()?.kind !== 'rparen') {
        for (;;) {
          args.push(cmp())
          const sep = peek()
          if (sep?.kind === 'semi') { pos++; continue }
          break
        }
      }
      const close = peek()
      if (close?.kind !== 'rparen') {
        throw new ExprError(
          close?.kind === 'num' && close.src?.startsWith(',')
            ? `${t.value}: ${ARG_SEPARATOR_HINT}`
            : `Не закрыта скобка функции ${t.value}`,
        )
      }
      pos++
      return { t: 'call', fn: t.value, args, pos: t.pos }
    }
    if (t.kind === 'lparen') {
      const v = cmp()
      if (peek()?.kind !== 'rparen') throw new ExprError('Не закрыта скобка')
      pos++
      return v
    }
    throw new ExprError(`Ожидалось число или имя, получено «${t.value}» в позиции ${t.pos + 1}`)
  }

  function unary(): FormulaNode {
    const t = peek()
    if (t?.kind === 'op' && (t.value === '-' || t.value === '+')) {
      pos++
      const e = unary()
      return t.value === '-' ? { t: 'neg', e } : e
    }
    return primary()
  }

  function term(): FormulaNode {
    let l = unary()
    for (;;) {
      const t = peek()
      if (t?.kind !== 'op' || (t.value !== '*' && t.value !== '/')) return l
      pos++
      l = { t: 'bin', op: t.value, l, r: unary() }
    }
  }

  function sum(): FormulaNode {
    let l = term()
    for (;;) {
      const t = peek()
      if (t?.kind !== 'op' || (t.value !== '+' && t.value !== '-')) return l
      pos++
      l = { t: 'bin', op: t.value, l, r: term() }
    }
  }

  function cmp(): FormulaNode {
    const l = sum()
    const t = peek()
    if (t?.kind !== 'cmp') return l
    pos++
    return { t: 'cmp', op: t.value as CmpOp, l, r: sum() }
  }

  const root = cmp()
  if (pos < tokens.length) {
    const t = tokens[pos]!
    throw new ExprError(`Лишний фрагмент «${t.value}» в позиции ${t.pos + 1}`)
  }
  return root
}

// ─── Реестр функций ──────────────────────────────────────────────────────────

export type FormulaGroup = 'Excel' | 'Корпус' | 'Конструкции' | 'Оборудование' | 'Справочники'

export interface FormulaArg {
  name: string
  label: string
  optional?: boolean
}

/** Справочники, которые функции читают из контекста материализации. */
export type FormulaRefs = Partial<Pick<MaterializeContext, 'pipeWeightOf' | 'nozzleNormOf' | 'jointLayerMassOf'>>

export interface FormulaFn {
  /** Имя в выражении. Регистр не важен. */
  name: string
  /** Другие написания — английские имена функций Excel. */
  aliases?: readonly string[]
  group: FormulaGroup
  /** Что считает — для палитры редактора. */
  label: string
  args: readonly FormulaArg[]
  /** Любое число аргументов (МАКС, МИН, И, ИЛИ); `args` — образец. */
  variadic?: boolean
  /** Единица результата. */
  unit?: string
  /**
   * Вычисление. `null` — значения нет (промах справочника): строка родится
   * с пустым количеством, как у встроенных узлов.
   */
  fn(args: number[], refs: FormulaRefs): number | null
}

const digits = (n: number | undefined) => (n === undefined ? 0 : Math.trunc(n))

/** Excel-округления до `n` знаков: ОКРУГЛ — к ближайшему, ОКРВНИЗ — к нулю. */
function roundTo(x: number, n: number, mode: 'near' | 'down'): number {
  const f = 10 ** n
  const scaled = Number((x * f).toPrecision(15))
  const r = mode === 'near' ? Math.sign(scaled) * Math.round(Math.abs(scaled)) : Math.trunc(scaled)
  return r / f
}

/**
 * Функции, доступные выражениям каталога. Предметные — обёртки над реестром
 * формул `formulas.ts`: те же функции считают встроенные узлы, поэтому узел
 * технолога и узел из кода на одних входах дают одно и то же.
 */
export const FORMULA_FNS: readonly FormulaFn[] = [
  // Excel
  { name: 'ОКРВВЕРХ', aliases: ['ROUNDUP'], group: 'Excel', label: 'Округление вверх до n знаков (n = 0 — до целого, −2 — до сотен)', args: [{ name: 'x', label: 'число' }, { name: 'n', label: 'знаков', optional: true }], fn: ([x, n]) => roundUp(x!, digits(n)) },
  { name: 'ОКРУГЛ', aliases: ['ROUND'], group: 'Excel', label: 'Округление к ближайшему до n знаков', args: [{ name: 'x', label: 'число' }, { name: 'n', label: 'знаков', optional: true }], fn: ([x, n]) => roundTo(x!, digits(n), 'near') },
  { name: 'ОКРВНИЗ', aliases: ['ROUNDDOWN'], group: 'Excel', label: 'Округление вниз (к нулю) до n знаков', args: [{ name: 'x', label: 'число' }, { name: 'n', label: 'знаков', optional: true }], fn: ([x, n]) => roundTo(x!, digits(n), 'down') },
  { name: 'МАКС', aliases: ['MAX'], group: 'Excel', label: 'Наибольшее из чисел', args: [{ name: 'a', label: 'число' }, { name: 'b', label: 'число' }], variadic: true, fn: (a) => Math.max(...a) },
  { name: 'МИН', aliases: ['MIN'], group: 'Excel', label: 'Наименьшее из чисел', args: [{ name: 'a', label: 'число' }, { name: 'b', label: 'число' }], variadic: true, fn: (a) => Math.min(...a) },
  { name: 'ЕСЛИ', aliases: ['IF'], group: 'Excel', label: 'Если условие не 0 — второе значение, иначе третье', args: [{ name: 'условие', label: 'условие' }, { name: 'да', label: 'значение, если да' }, { name: 'нет', label: 'значение, если нет', optional: true }], fn: ([c, a, b]) => (c ? a! : (b ?? 0)) },
  { name: 'И', aliases: ['AND'], group: 'Excel', label: '1, если все условия не 0', args: [{ name: 'a', label: 'условие' }, { name: 'b', label: 'условие' }], variadic: true, fn: (a) => (a.every((x) => x !== 0) ? 1 : 0) },
  { name: 'ИЛИ', aliases: ['OR'], group: 'Excel', label: '1, если хоть одно условие не 0', args: [{ name: 'a', label: 'условие' }, { name: 'b', label: 'условие' }], variadic: true, fn: (a) => (a.some((x) => x !== 0) ? 1 : 0) },
  { name: 'НЕ', aliases: ['NOT'], group: 'Excel', label: '1, если условие равно 0', args: [{ name: 'a', label: 'условие' }], fn: ([a]) => (a === 0 ? 1 : 0) },
  { name: 'ПИ', aliases: ['PI'], group: 'Excel', label: 'Число π', args: [], fn: () => Math.PI },
  { name: 'КОРЕНЬ', aliases: ['SQRT'], group: 'Excel', label: 'Квадратный корень', args: [{ name: 'x', label: 'число' }], fn: ([x]) => (x! < 0 ? null : Math.sqrt(x!)) },
  { name: 'ABS', group: 'Excel', label: 'Модуль числа', args: [{ name: 'x', label: 'число' }], fn: ([x]) => Math.abs(x!) },

  // Корпус
  { name: 'pipeLengthM', group: 'Корпус', label: 'Длина трубы корпуса по глубине', unit: 'м', args: [{ name: 'depthMm', label: 'глубина, мм' }], fn: ([d]) => pipeLengthM(d!) },
  { name: 'marketableAppearanceHours', group: 'Корпус', label: 'Придание товарного вида: DN/1300 × L', unit: 'чел. ч', args: [{ name: 'dn', label: 'DN, мм' }, { name: 'lengthM', label: 'длина, м' }], fn: ([dn, l]) => marketableAppearanceHours(dn!, l!) },
  { name: 'pipePrepHours', group: 'Корпус', label: 'Подготовка трубы: DN/(200·6) × L', unit: 'чел. ч', args: [{ name: 'dn', label: 'DN, мм' }, { name: 'lengthM', label: 'длина, м' }], fn: ([dn, l]) => pipePrepHours(dn!, l!) },
  { name: 'bottomMassKg', group: 'Корпус', label: 'Масса формованного дна', unit: 'кг', args: [{ name: 'dn', label: 'DN, мм' }], fn: ([dn]) => bottomMassKg(dn!) },
  { name: 'laminationMassKg', group: 'Корпус', label: 'Ламинирование детали к корпусу: масса × 3/10', unit: 'кг', args: [{ name: 'massKg', label: 'масса детали, кг' }], fn: ([m]) => laminationMassKg(m!) },
  { name: 'topSlabMassKg', group: 'Корпус', label: 'Масса верхнего перекрытия за вычетом люков', unit: 'кг', args: [{ name: 'dn', label: 'DN, мм' }, { name: 'hatchMassKg', label: 'масса горловины люка, кг', optional: true }, { name: 'hatchCount', label: 'люков', optional: true }], fn: ([dn, m, n]) => topSlabMassKg(dn!, m ?? 0, n ?? 0) },
  { name: 'cutoutHours', group: 'Корпус', label: 'Прорезка отверстия: Ø·π/1000 × 0,5 × кол-во', unit: 'чел. ч', args: [{ name: 'diameterMm', label: 'Ø отверстия, мм' }, { name: 'count', label: 'кол-во', optional: true }], fn: ([d, n]) => cutoutHours(d!, n ?? 1) },
  { name: 'sleeveDiameter', group: 'Корпус', label: 'Диаметр гильзы патрубка по его DN', unit: 'мм', args: [{ name: 'dn', label: 'DN патрубка, мм' }], fn: ([dn]) => sleeveDiameter(dn!) },
  { name: 'bottomJointLaminationKg', group: 'Корпус', label: 'Ламинация днища по косым и центральному стыкам', unit: 'кг', args: [{ name: 'jointKg', label: 'Мс, кг' }], fn: ([m]) => bottomJointLaminationKg(m!) },

  // Конструкции
  { name: 'ladderMaterialM', group: 'Конструкции', label: 'Уголок тетив лестницы: 2 × H', unit: 'м', args: [{ name: 'heightM', label: 'высота, м' }], fn: ([h]) => ladder(h!).materialM },
  { name: 'ladderRungPipeM', group: 'Конструкции', label: 'Труба ступеней: H × 0,44 / 0,35', unit: 'м', args: [{ name: 'heightM', label: 'высота, м' }], fn: ([h]) => ladder(h!).rungPipeM },
  { name: 'ladderHours', group: 'Конструкции', label: 'Изготовление лестницы: 1,25 × H (монтаж — половина)', unit: 'чел. ч', args: [{ name: 'heightM', label: 'высота, м' }], fn: ([h]) => ladder(h!).fabricationHours },
  { name: 'anchorCount', group: 'Конструкции', label: 'Анкеры против всплытия: выталкивающая сила / 27 500 Н', unit: 'шт', args: [{ name: 'outerDiameterM', label: 'Дн, м' }, { name: 'depthM', label: 'глубина, м' }], fn: ([d, h]) => anchorCount(d!, h!) },
  { name: 'frameMakeHours', group: 'Конструкции', label: 'Изготовление рамы: 6 при DN < 2500, иначе 7', unit: 'чел. ч', args: [{ name: 'dn', label: 'DN, мм' }], fn: ([dn]) => frameHours(dn!).make },
  { name: 'frameMountHours', group: 'Конструкции', label: 'Монтаж рамы: 5 при DN < 2500, иначе 6', unit: 'чел. ч', args: [{ name: 'dn', label: 'DN, мм' }], fn: ([dn]) => frameHours(dn!).mount },

  // Оборудование
  { name: 'pumpGuidesM', group: 'Оборудование', label: 'Направляющие насосов: L × (раб + рез) × 2', unit: 'м', args: [{ name: 'depthM', label: 'высота, м' }, { name: 'working', label: 'рабочих' }, { name: 'reserve', label: 'резервных' }], fn: ([h, w, r]) => pumpGuidesM(h!, w!, r!) },
  { name: 'pumpLiftChainM', group: 'Оборудование', label: 'Цепь подъёма: насосов × (H + 1), вверх до метра', unit: 'м', args: [{ name: 'pumps', label: 'насосов' }, { name: 'heightM', label: 'высота подъёма, м' }], fn: ([n, h]) => pumpLiftChainM(n!, h!) },

  // Справочники
  { name: 'pipeKgPerM', group: 'Справочники', label: 'Вес трубы GRP по (DN; PN трубы; SN)', unit: 'кг/пм', args: [{ name: 'dn', label: 'DN, мм' }, { name: 'pn', label: 'PN трубы' }, { name: 'sn', label: 'SN' }], fn: ([dn, pn, sn], r) => r.pipeWeightOf?.(dn!, pn!, sn!) ?? null },
  { name: 'nozzleMoldingKg', group: 'Справочники', label: 'Мф общая — масса формовки патрубка по DN', unit: 'кг', args: [{ name: 'dn', label: 'DN, мм' }], fn: ([dn], r) => r.nozzleNormOf?.(dn!)?.moldingMassKg ?? null },
  { name: 'flangeMoldingKg', group: 'Справочники', label: 'Мф фланца по DN', unit: 'кг', args: [{ name: 'dn', label: 'DN, мм' }], fn: ([dn], r) => r.nozzleNormOf?.(dn!)?.flangeMassKg ?? null },
  { name: 'jointLayerKg', group: 'Справочники', label: 'Мс — масса формованных слоёв на стыке по Dу', unit: 'кг', args: [{ name: 'd', label: 'Dу, мм' }], fn: ([d], r) => r.jointLayerMassOf?.(d!) ?? null },
]

const FN_INDEX: ReadonlyMap<string, FormulaFn> = new Map(
  FORMULA_FNS.flatMap((f) => [f.name, ...(f.aliases ?? [])].map((n) => [n.toUpperCase(), f] as const)),
)

/** Функция реестра по имени из выражения (регистр не важен). */
export function formulaFn(name: string): FormulaFn | null {
  return FN_INDEX.get(name.toUpperCase()) ?? null
}

/** Имена, занятые функциями, — параметр так назвать нельзя. */
export function isFormulaFnName(name: string): boolean {
  return FN_INDEX.has(name.toUpperCase())
}

// ─── Вычисление ──────────────────────────────────────────────────────────────

/** Значение переменной: параметр узла или поле ОЛ. */
export type ScopeValue = number | boolean | string | null | undefined
export type Scope = Readonly<Record<string, ScopeValue>>

/**
 * Вычисляет дерево выражения.
 *
 * @returns число; `null` — у переменной нет значения (пустое поле ОЛ) или
 *   справочник промахнулся: строка родится с пустым количеством
 * @throws ExprError — неизвестное имя, текст в формуле, деление на ноль
 */
export function evalFormula(node: FormulaNode, scope: Scope, refs: FormulaRefs = {}): number | null {
  switch (node.t) {
    case 'num':
      return node.v
    case 'var': {
      if (!(node.name in scope)) throw new ExprError(`Неизвестное имя «${node.name}»`)
      const v = scope[node.name]
      if (v == null || v === '') return null
      if (typeof v === 'boolean') return v ? 1 : 0
      if (typeof v === 'string') throw new ExprError(`«${node.name}» — текст, в формуле нужен числовой параметр`)
      return Number.isFinite(v) ? v : null
    }
    case 'neg': {
      const v = evalFormula(node.e, scope, refs)
      return v == null ? null : -v
    }
    case 'bin': {
      const l = evalFormula(node.l, scope, refs)
      const r = evalFormula(node.r, scope, refs)
      if (l == null || r == null) return null
      switch (node.op) {
        case '+': return l + r
        case '-': return l - r
        case '*': return l * r
        case '/':
          if (r === 0) throw new ExprError('Деление на ноль')
          return l / r
      }
      break
    }
    case 'cmp': {
      const l = evalFormula(node.l, scope, refs)
      const r = evalFormula(node.r, scope, refs)
      if (l == null || r == null) return null
      const eq = Math.abs(l - r) < 1e-9
      switch (node.op) {
        case '=': return eq ? 1 : 0
        case '<>': return eq ? 0 : 1
        case '<': return !eq && l < r ? 1 : 0
        case '>': return !eq && l > r ? 1 : 0
        case '<=': return eq || l < r ? 1 : 0
        case '>=': return eq || l > r ? 1 : 0
      }
      break
    }
    case 'call': {
      const f = formulaFn(node.fn)
      if (!f) throw new ExprError(`Неизвестная функция «${node.fn}»`)
      checkArity(f, node.args.length)
      // ЕСЛИ ленива: невыбранная ветка не считается — пустое поле в ней не
      // должно обнулять результат.
      if (f.name === 'ЕСЛИ') {
        const c = evalFormula(node.args[0]!, scope, refs)
        if (c == null) return null
        const branch = c !== 0 ? node.args[1] : node.args[2]
        return branch ? evalFormula(branch, scope, refs) : 0
      }
      const args: number[] = []
      for (const a of node.args) {
        const v = evalFormula(a, scope, refs)
        if (v == null) return null
        args.push(v)
      }
      const v = f.fn(args, refs)
      return v == null || !Number.isFinite(v) ? null : v
    }
  }
  return null
}

function checkArity(f: FormulaFn, n: number): void {
  const required = f.args.filter((a) => !a.optional).length
  if (n < required) throw new ExprError(`${f.name}: нужно аргументов — ${required}, передано ${n}`)
  if (!f.variadic && n > f.args.length) throw new ExprError(`${f.name}: аргументов не больше ${f.args.length}, передано ${n}`)
}

/** Разбор и вычисление строкой — для биндингов и условий. */
export function evalFormulaText(src: string, scope: Scope, refs: FormulaRefs = {}): number | null {
  return evalFormula(parseFormula(src), scope, refs)
}

// ─── Проверка без вычисления ─────────────────────────────────────────────────

/** Тип переменной в области видимости выражения. */
export type VarKind = 'number' | 'bool' | 'text'

/**
 * Проверяет выражение до публикации: разбор, известные имена и функции,
 * число аргументов, текстовые параметры вне формул.
 *
 * @returns текст первой ошибки или `null`, если выражение годно
 */
export function checkFormula(src: string, vars: ReadonlyMap<string, VarKind>): string | null {
  let root: FormulaNode
  try {
    root = parseFormula(src)
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  try {
    walk(root, (n) => {
      if (n.t === 'var') {
        const kind = vars.get(n.name)
        if (!kind) throw new ExprError(`Неизвестное имя «${n.name}»`)
        if (kind === 'text') throw new ExprError(`«${n.name}» — текст, в формуле нужен числовой параметр`)
      }
      if (n.t === 'call') {
        const f = formulaFn(n.fn)
        if (!f) throw new ExprError(`Неизвестная функция «${n.fn}»`)
        checkArity(f, n.args.length)
      }
    })
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  return null
}

function walk(n: FormulaNode, visit: (n: FormulaNode) => void): void {
  visit(n)
  if (n.t === 'neg') walk(n.e, visit)
  else if (n.t === 'bin' || n.t === 'cmp') { walk(n.l, visit); walk(n.r, visit) }
  else if (n.t === 'call') n.args.forEach((a) => walk(a, visit))
}

/** Имена переменных, на которые ссылается выражение. */
export function formulaVars(src: string): string[] {
  const out = new Set<string>()
  try {
    walk(parseFormula(src), (n) => { if (n.t === 'var') out.add(n.name) })
  } catch {
    // Неразобранное выражение ни на что не ссылается.
  }
  return [...out]
}

// ─── Печать ──────────────────────────────────────────────────────────────────

const PREC: Record<string, number> = { cmp: 0, '+': 1, '-': 1, '*': 2, '/': 2, neg: 3 }

/** Число в пояснении строки: русская запятая, без разрядов, до 3 знаков. */
export function fmtFormulaNum(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 3, useGrouping: false })
}

/**
 * Выражение словами пояснения: переменные заменены значениями — так строки
 * встроенных узлов пишут «ƒ DN/(200·6) × L = 3000/1200 × 11,6 м».
 */
export function formulaWithValues(node: FormulaNode, scope: Scope): string {
  const p = (n: FormulaNode, parent: number): string => {
    switch (n.t) {
      case 'num':
        return fmtFormulaNum(n.v)
      case 'var': {
        const v = scope[n.name]
        if (typeof v === 'number') return fmtFormulaNum(v)
        if (typeof v === 'boolean') return v ? '1' : '0'
        return n.name
      }
      case 'neg':
        return `−${p(n.e, PREC.neg!)}`
      case 'call':
        return `${n.fn}(${n.args.map((a) => p(a, -1)).join('; ')})`
      case 'bin':
      case 'cmp': {
        const prec = n.t === 'cmp' ? PREC.cmp! : PREC[n.op]!
        const op = n.t === 'cmp' ? n.op : { '+': '+', '-': '−', '*': '×', '/': '/' }[n.op]
        // Правый операнд вычитания и деления того же приоритета берётся в
        // скобки: a − (b − c) ≠ a − b − c.
        const right = n.t === 'bin' && (n.op === '-' || n.op === '/') ? prec + 0.5 : prec
        const s = `${p(n.l, prec)} ${op} ${p(n.r, right)}`
        return prec < parent ? `(${s})` : s
      }
    }
  }
  return p(node, -1)
}

// ─── Шаблоны наименований ────────────────────────────────────────────────────

/** Значение в наименовании: числа без разрядов («DN3000»), логика — да/нет. */
function fmtNameValue(v: ScopeValue): string {
  if (typeof v === 'number') return v.toLocaleString('ru-RU', { maximumFractionDigits: 2, useGrouping: false })
  if (typeof v === 'boolean') return v ? 'да' : 'нет'
  return v ?? ''
}

const PLACEHOLDER = /\{([^{}]*)\}/g

/**
 * Наименование из шаблона: `{имя}` — значение параметра, `{выражение}` —
 * результат формулы. «Труба ПЭ Ø{od} мм», «Гильза Ø{sleeveDiameter(dn)}».
 * Наименование — ключ поиска цены в прайсе, поэтому числа идут без
 * разрядных пробелов, как в прайсе.
 *
 * Не вычислилось — на месте вставки «?»: строка останется видимой и
 * «красной», а не пропадёт.
 */
export function renderNameTemplate(template: string, scope: Scope, refs: FormulaRefs = {}): string {
  return template.replace(PLACEHOLDER, (_m, inner: string) => {
    const key = inner.trim()
    if (key in scope) return scope[key] == null ? '?' : fmtNameValue(scope[key])
    try {
      const v = evalFormulaText(key, scope, refs)
      return v == null ? '?' : fmtNameValue(v)
    } catch {
      return '?'
    }
  })
}

/** Проверка шаблона наименования: каждая вставка — имя или годная формула. */
export function checkNameTemplate(template: string, vars: ReadonlyMap<string, VarKind>): string | null {
  const opens = (template.match(/\{/g) ?? []).length
  const closes = (template.match(/\}/g) ?? []).length
  if (opens !== closes) return 'Непарные фигурные скобки'
  for (const m of template.matchAll(PLACEHOLDER)) {
    const key = m[1]!.trim()
    if (!key) return 'Пустая вставка {}'
    if (vars.has(key)) continue
    const err = checkFormula(key, vars)
    if (err) return `{${key}}: ${err}`
  }
  return null
}
