/**
 * Узел каталога, заведённый технологом в редакторе шаблонов (Библиотека §1.1,
 * §4, §6.2).
 *
 * Узел — единица каталога: параметры (вход), строки состава с формулами
 * количеств и генераторами наименований, признак включения. Встроенные узлы
 * (корпус, лестница, напорный трубопровод…) остаются кодом —
 * engines/code-nodes.ts; этот модуль описывает узлы-ДАННЫЕ, которые технолог
 * собирает без релиза из функций реестра (`node-expr.ts`, FORMULA_FNS).
 *
 * Материализация узла — такая же, как у встроенного: строки рождаются с
 * зафиксированным расчётным количеством и ценой прайса, у операций в кг —
 * ФОТ-спутник. Дальше расчёт с узлом не связан: правка каталога меняет
 * только новые материализации (Библиотека §6, п. 2), а версия узла остаётся в
 * компоненте для аудита состава.
 */

import { CATEGORIES, UNIT_MASS, type Category, type RowKind } from './types'
import {
  checkFormula,
  checkNameTemplate,
  evalFormula,
  formulaWithValues,
  fmtFormulaNum,
  isFormulaFnName,
  parseFormula,
  renderNameTemplate,
  type FormulaRefs,
  type Scope,
  type VarKind,
} from './node-expr'
import {
  makeRow,
  nextId,
  operationWithFot,
  surveyToggled,
  type CalcComponent,
  type CalcRowNode,
  type MaterializeContext,
} from './template-kns'

/** Рубрики каталога (Библиотека §2) — для группировки, без логики. */
export const NODE_TAGS = ['корпус', 'конструкции обслуживания', 'инженерные системы', 'оборудование'] as const
export type NodeTag = (typeof NODE_TAGS)[number]

export type NodeParamType = VarKind

/** Параметр узла — вход, который связывается с полем ОЛ или вводится вручную. */
export interface NodeParamDef {
  /** Имя в формулах и шаблонах наименований: латиница или кириллица, без пробелов. */
  key: string
  /** Подпись в редакторе и в форме вставки узла. */
  label: string
  type: NodeParamType
  unit?: string
  /** Значение, если биндинг не задан или поле ОЛ пусто. */
  default?: number | boolean | string | null
}

/**
 * Строка состава. ФОТ отдельной строкой не заводится: у операции в кг он
 * рождается спутником с коэффициентом `fotK` (Механика §6).
 */
export interface NodeRowDef {
  kind: Exclude<RowKind, 'ФОТ'>
  category: Category
  /** Генератор наименования: «Уголок {a}х{a}х{t}мм». Наименование — ключ цены. */
  name: string
  unit: string
  /** Формула количества; пусто — количество вводит инженер в расчёте. */
  qty: string
  /** Коэффициент ФОТ, чел.ч/кг — только у операции в кг, и там обязателен. */
  fotK?: number | null
  /** Условие строки: формула, строка есть, если результат не 0. Пусто — всегда. */
  when?: string
  /** Пояснение в примечании строки; допускает вставки, как наименование. */
  note?: string
}

/** Тело узла — то, что правит технолог и что хранит версия узла. */
export interface NodeDefBody {
  /** Код каталога: «B8», «C5». Коды встроенных узлов заняты. */
  code: string
  /** Название компонента в расчёте — тоже генератор: «Площадка Ø{d}». */
  name: string
  tag: NodeTag
  description?: string
  params: NodeParamDef[]
  rows: NodeRowDef[]
  /**
   * Условие включения узла (формула). Пусто — узел включён всегда. Ложно —
   * узел собирается выключенным «призраком», как узлы под тумблером ОЛ, и
   * инженер может включить его в расчёте.
   */
  enabledBy?: string
}

/** Опубликованная версия узла — то, что читает материализация. */
export interface CatalogNode {
  code: string
  version: number
  body: NodeDefBody
}

export type NodeParamValues = Record<string, number | boolean | string | null>

/** Имя параметра: буква или «_», дальше буквы, цифры, «_». */
export const PARAM_KEY_RE = /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*$/
/** Код узла: буква, дальше буквы, цифры, точка, дефис — до 16 знаков. */
export const NODE_CODE_RE = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9.-]{0,15}$/

/** Значения параметров по умолчанию. */
export function defaultParams(body: Pick<NodeDefBody, 'params'>): NodeParamValues {
  const out: NodeParamValues = {}
  for (const p of body.params) {
    out[p.key] = p.default ?? (p.type === 'bool' ? false : p.type === 'text' ? '' : null)
  }
  return out
}

/** Типы параметров — область видимости формул узла. */
export function paramKinds(body: Pick<NodeDefBody, 'params'>): Map<string, VarKind> {
  return new Map(body.params.map((p) => [p.key, p.type]))
}

// ─── Проверка ────────────────────────────────────────────────────────────────

export interface NodeIssue {
  /** Где: «code», «params[1].key», «rows[3].qty». */
  path: string
  message: string
  /** Предупреждение публикации не мешает. */
  warn?: boolean
}

/**
 * Проверка узла перед публикацией. Ошибки — то, что сломало бы материализацию
 * или дало бы строку-мусор; предупреждения — то, что стоит проверить глазами.
 *
 * @param opts.reservedCodes коды встроенных узлов (engines/code-nodes.ts)
 */
export function validateNodeDef(body: NodeDefBody, opts: { reservedCodes?: ReadonlySet<string> } = {}): NodeIssue[] {
  const issues: NodeIssue[] = []
  const err = (path: string, message: string) => issues.push({ path, message })
  const warn = (path: string, message: string) => issues.push({ path, message, warn: true })

  const code = body.code.trim()
  if (!code) err('code', 'Код узла обязателен')
  else if (!NODE_CODE_RE.test(code)) err('code', 'Код — буква, дальше буквы, цифры, точка или дефис, до 16 знаков')
  else if (opts.reservedCodes?.has(code.toUpperCase())) err('code', `Код ${code} занят встроенным узлом`)
  if (!body.name.trim()) err('name', 'Название узла обязательно')
  if (!(NODE_TAGS as readonly string[]).includes(body.tag)) err('tag', 'Выберите рубрику каталога')

  const seen = new Set<string>()
  body.params.forEach((p, i) => {
    const at = `params[${i}]`
    if (!PARAM_KEY_RE.test(p.key)) err(`${at}.key`, `Имя «${p.key}» — буквы, цифры и «_», начинается с буквы`)
    else if (isFormulaFnName(p.key)) err(`${at}.key`, `Имя «${p.key}» занято функцией`)
    else if (seen.has(p.key)) err(`${at}.key`, `Параметр «${p.key}» повторяется`)
    seen.add(p.key)
    if (!p.label.trim()) err(`${at}.label`, 'Подпись параметра обязательна')
    if (p.default != null && p.default !== '') {
      const ok =
        (p.type === 'number' && typeof p.default === 'number' && Number.isFinite(p.default)) ||
        (p.type === 'bool' && typeof p.default === 'boolean') ||
        (p.type === 'text' && typeof p.default === 'string')
      if (!ok) err(`${at}.default`, 'Значение по умолчанию не того типа')
    }
  })

  const vars = paramKinds(body)
  const nameErr = checkNameTemplate(body.name, vars)
  if (nameErr) err('name', nameErr)
  if (body.enabledBy?.trim()) {
    const e = checkFormula(body.enabledBy, vars)
    if (e) err('enabledBy', e)
  }

  if (!body.rows.length) err('rows', 'В узле нет ни одной строки')
  body.rows.forEach((r, i) => {
    const at = `rows[${i}]`
    if (r.kind !== 'МАТЕРИАЛ' && r.kind !== 'ОПЕРАЦИЯ') err(`${at}.kind`, 'Тип строки — материал или операция')
    if (!(CATEGORIES as readonly string[]).includes(r.category) || r.category === 'ФОТ') {
      err(`${at}.category`, 'Категория — из списка прайса; ФОТ рождается спутником операции')
    }
    if (!r.name.trim()) err(`${at}.name`, 'Наименование обязательно — по нему ищется цена')
    else {
      const e = checkNameTemplate(r.name, vars)
      if (e) err(`${at}.name`, e)
    }
    if (!r.unit.trim()) err(`${at}.unit`, 'ЕИ обязательна — она часть ключа цены')
    if (r.qty.trim()) {
      const e = checkFormula(r.qty, vars)
      if (e) err(`${at}.qty`, e)
    } else {
      warn(`${at}.qty`, 'Количество пустое — его введут в расчёте')
    }
    if (r.when?.trim()) {
      const e = checkFormula(r.when, vars)
      if (e) err(`${at}.when`, e)
    }
    if (r.note?.trim()) {
      const e = checkNameTemplate(r.note, vars)
      if (e) err(`${at}.note`, e)
    }
    const massOp = r.kind === 'ОПЕРАЦИЯ' && r.unit.trim() === UNIT_MASS
    if (massOp && !(typeof r.fotK === 'number' && r.fotK > 0 && r.fotK <= 5)) {
      err(`${at}.fotK`, 'Операции в кг нужен коэффициент ФОТ (0,28 · 0,56 · 1): ФОТ считается от массы')
    }
    if (!massOp && r.fotK != null) err(`${at}.fotK`, 'Коэффициент ФОТ — только у операции в кг')
  })
  return issues
}

/** Есть ли ошибки, мешающие публикации. */
export const hasBlockingIssues = (issues: readonly NodeIssue[]) => issues.some((i) => !i.warn)

// ─── Материализация ──────────────────────────────────────────────────────────

/** Параметры с подставленными умолчаниями: пустое значение → умолчание. */
export function resolveParams(body: Pick<NodeDefBody, 'params'>, values: NodeParamValues): Scope {
  const scope: Record<string, number | boolean | string | null> = {}
  for (const p of body.params) {
    const v = values[p.key]
    scope[p.key] = v == null || v === '' ? (p.default ?? (p.type === 'bool' ? false : p.type === 'text' ? '' : null)) : v
  }
  return scope
}

interface Evaluated {
  value: number | null
  /** Пояснение: формула с подставленными значениями либо текст ошибки. */
  note: string
  error?: boolean
}

function evaluate(src: string, scope: Scope, refs: FormulaRefs): Evaluated {
  try {
    const ast = parseFormula(src)
    const value = evalFormula(ast, scope, refs)
    const shown = formulaWithValues(ast, scope)
    const plain = ast.t === 'num'
    if (value == null) return { value, note: `ƒ ${shown} — нет значения: введите вручную` }
    return { value, note: plain ? '' : `ƒ ${shown} = ${fmtFormulaNum(value)}` }
  } catch (e) {
    return { value: null, note: `⚠ формула «${src}»: ${e instanceof Error ? e.message : e}`, error: true }
  }
}

/** Условие (включения узла или строки): не 0 — да; пустое — да. */
function condition(src: string | undefined, scope: Scope, refs: FormulaRefs): boolean {
  if (!src?.trim()) return true
  const r = evaluate(src, scope, refs)
  return r.value != null && r.value !== 0
}

/**
 * Материализует узел каталога в компонент расчёта.
 *
 * @param values параметры экземпляра — из биндингов шаблона или из формы
 *   вставки узла в расчёт; пустые берут умолчания
 * @param opts.title своё название экземпляра (генератор), иначе название узла
 */
export function materializeNode(
  ctx: MaterializeContext,
  node: Pick<CatalogNode, 'body'> & { version?: number },
  values: NodeParamValues,
  opts: { title?: string } = {},
): CalcComponent {
  const body = node.body
  const scope = resolveParams(body, values)
  const refs: FormulaRefs = ctx

  const rows: CalcRowNode[] = []
  for (const r of body.rows) {
    if (!condition(r.when, scope, refs)) continue
    const qty = r.qty.trim() ? evaluate(r.qty, scope, refs) : { value: null, note: 'количество вводится в расчёте' }
    const own = r.note?.trim() ? renderNameTemplate(r.note, scope, refs) : ''
    const note = [own, qty.note].filter(Boolean).join(' · ') || undefined
    const spec = {
      category: r.category,
      name: renderNameTemplate(r.name, scope, refs),
      unit: r.unit.trim(),
      qtyCalc: qty.value,
      note,
    }
    if (r.kind === 'ОПЕРАЦИЯ' && spec.unit === UNIT_MASS && typeof r.fotK === 'number') {
      rows.push(...operationWithFot(ctx, { ...spec, fotK: r.fotK }))
    } else {
      rows.push(makeRow(ctx, { ...spec, kind: r.kind }))
    }
  }

  const title = renderNameTemplate(opts.title?.trim() || body.name, scope, refs)
  return {
    id: nextId('c'),
    nodeCode: body.code,
    ...(node.version != null ? { nodeVersion: node.version } : {}),
    title,
    ...(body.enabledBy?.trim() ? surveyToggled(condition(body.enabledBy, scope, refs)) : { enabled: true }),
    rows,
  }
}

/** Пустой узел — заготовка для «+ Новый узел» в редакторе. */
export function blankNodeDef(code = ''): NodeDefBody {
  return {
    code,
    name: '',
    tag: 'конструкции обслуживания',
    description: '',
    params: [],
    rows: [{ kind: 'МАТЕРИАЛ', category: 'Прочие материалы', name: '', unit: 'шт', qty: '1' }],
    enabledBy: '',
  }
}
