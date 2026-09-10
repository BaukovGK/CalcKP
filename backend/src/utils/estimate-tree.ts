/**
 * Разбор дерева расчёта, хранящегося в `Estimate.surveyData` (Json).
 *
 * Понимает две формы:
 *  - целевую (§9, Библиотека §6.3): `tree.sections[].components[].rows[]`;
 *  - устаревшую (фаза 1): `bundles[].groups[].subgroups[].rows[]`.
 *
 * Обе поддерживаются намеренно: фронт мигрирует на дерево в рамках этапа 5,
 * а валидация статусов нужна уже сейчас и не должна зависеть от порядка работ.
 */

export interface TreeRow {
  id?: string
  name?: string
  unit?: string
  /** Вид строки: МАТЕРИАЛ · ОПЕРАЦИЯ · ФОТ (Механика §5.3). */
  kind?: string
  /** Категория прайса — первая часть ключа цены. У спутника ФОТ она «ФОТ». */
  category?: string
  enabled?: boolean
  qtyCalc?: number | null
  /**
   * Ручное количество. Это ВЫРАЖЕНИЕ, а не число: инженер вводит «1,55*2+2,88*2»
   * или «=980 000», как считал бы в Excel (Механика §5.1). Разбирает его парсер
   * фронта (`engines/expr.ts`) — на бэкенде парсера нет и быть не должно, иначе
   * появится вторая реализация одной грамматики.
   */
  qtyManual?: string | number | null
  /**
   * Количество, УЖЕ вычисленное движком фронта, за одно изделие (без тиража).
   * Пишется при сохранении (`stores/calcTree.ts`, save) — благодаря ему бэкенду
   * не нужно толковать `qtyManual`.
   *
   * Отсутствует у снапшотов, снятых до появления поля: тогда количество строки
   * с выражением считается НЕОПРЕДЕЛЁННЫМ, см. {@link resolveRowQty}.
   */
  qtyResolved?: number | null
  priceCatalog?: number | null
  priceManual?: number | null
  /** Устаревшая форма хранит количество и цену строками. */
  qty?: string | number | null
  price?: string | number | null
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Собирает все строки расчёта независимо от формы хранения. */
export function extractRows(surveyData: unknown): TreeRow[] {
  if (!isObj(surveyData)) return []
  const rows: TreeRow[] = []

  // Целевая форма.
  const tree = isObj(surveyData.tree) ? surveyData.tree : null
  const sections = asArray(tree?.sections ?? surveyData.sections)
  for (const s of sections) {
    if (!isObj(s)) continue
    // Раздел выключен целиком — строки в итог не входят.
    if (s.enabled === false) continue
    for (const c of asArray(s.components)) {
      if (!isObj(c) || c.enabled === false) continue
      for (const r of asArray(c.rows)) if (isObj(r)) rows.push(r as TreeRow)
    }
  }

  // Устаревшая форма.
  for (const b of asArray(surveyData.bundles)) {
    if (!isObj(b)) continue
    for (const g of asArray(b.groups)) {
      if (!isObj(g)) continue
      for (const sg of asArray(g.subgroups)) {
        if (!isObj(sg)) continue
        for (const r of asArray(sg.rows)) if (isObj(r)) rows.push(r as TreeRow)
      }
    }
  }

  return rows
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Результат определения количества строки за ОДНО изделие (без тиража). */
export interface RowQty {
  /** Количество, если его удалось определить. */
  qty: number | null
  /**
   * Количество задано, но бэкенд не может его вычислить: в `qtyManual` лежит
   * выражение, а `qtyResolved` в снапшоте нет (снят до появления поля).
   * Трактуется как «есть, но неизвестно», а не как «нет».
   */
  unresolved: boolean
}

/**
 * Количество строки за одно изделие: ручное переопределение приоритетнее
 * расчётного (Механика §5.1).
 *
 * Порядок источников:
 *  1. `qtyResolved` — движок фронта уже посчитал, включая выражения;
 *  2. `qtyManual`, если это простое число (или числовая строка);
 *  3. `qtyCalc` — расчётное значение шаблона;
 *  4. `qty` — устаревшая форма хранения.
 *
 * Если `qtyManual` задано выражением и `qtyResolved` нет — возвращается
 * `unresolved`. Прежняя версия отдавала в этом случае `null`, то есть «нет
 * количества»: строка без цены переставала блокировать выпуск КП и пропадала
 * из спецификации. Молчаливое «нет» на месте «не знаю» — худший из исходов,
 * потому что оба потребителя этого значения принимают на нём решение.
 */
export function resolveRowQty(row: TreeRow): RowQty {
  if (typeof row.qtyResolved === 'number' && Number.isFinite(row.qtyResolved)) {
    return { qty: row.qtyResolved, unresolved: false }
  }

  if (row.qtyManual != null && String(row.qtyManual).trim() !== '') {
    const manual = num(row.qtyManual)
    if (manual != null) return { qty: manual, unresolved: false }
    return { qty: null, unresolved: true }
  }

  const calc = row.qtyCalc ?? num(row.qty)
  return { qty: calc, unresolved: false }
}

/**
 * Строка «без цены»: нет ни каталожной, ни ручной цены (Механика §5.2).
 * Выключенные строки и строки с нулевым количеством не считаются проблемой —
 * они в итог не входят.
 */
export function isRowWithoutPrice(row: TreeRow): boolean {
  if (row.enabled === false) return false

  const price = row.priceManual ?? row.priceCatalog ?? num(row.price)
  if (price != null) return false

  const { qty, unresolved } = resolveRowQty(row)
  // Количество задано выражением, которое бэкенд не считает: строка может
  // стоить денег, поэтому гейт срабатывает. Пропустить её — значит выпустить
  // КП с заниженным итогом, а это ровно то, ради чего гейт и сделан.
  if (unresolved) return true
  // Нулевое количество: строка ничего не стоит и не блокирует проверку.
  if (qty == null || qty === 0) return false

  return true
}

/** Строки без цены — они блокируют переход CALC → REVIEW (Механика §10). */
export function rowsWithoutPrice(surveyData: unknown): TreeRow[] {
  return extractRows(surveyData).filter(isRowWithoutPrice)
}

/**
 * Строка ФОТ — спутник операции, а не позиция изделия.
 *
 * Материализация добавляет её к каждой операции формовки и ламинирования
 * (`engines/template-kns.ts`, operationWithFot): те же часы, умноженные на
 * коэффициент, по ставке из прайса. Заказчику она не говорит ничего о том,
 * что он покупает, а в спецификации выглядит дублем — «Ламинирование 112 кг»
 * и сразу «ФОТ 112 чел. ч».
 *
 * На итог отказ от печати не влияет: цена берётся из снапшота, а ФОТ входит
 * в неё через себестоимость. Из гейта «строки без цены» ФОТ тоже не
 * исключается — там он занижал бы сумму по-настоящему.
 *
 * Признаков два: `kind` — то, чем строка является, `category` — ключ прайса.
 * Достаточно любого: у снапшотов, снятых до появления `kind`, остаётся
 * категория.
 */
export function isFotRow(row: TreeRow): boolean {
  const label = (v: unknown) => String(v ?? '').trim().toUpperCase()
  return label(row.kind) === 'ФОТ' || label(row.category) === 'ФОТ'
}

/**
 * Работа — операция собственного производства и её спутник ФОТ.
 *
 * В документ заказчику не идут ни те, ни другие: он покупает изделие, а не
 * трудозатраты. «Ламинирование частей корпуса 112 кг» и «Прорезка отверстия
 * 0,7 чел. ч» — это как мы делаем, а не что он получает; в спецификации они
 * занимали три четверти строк и прятали то, ради чего документ читают.
 *
 * Цена от этого не меняется: она берётся из снапшота, а работы входят в неё
 * через себестоимость. Гейт «строки без цены» при выпуске КП работы тоже
 * проверяет — там они занижают сумму по-настоящему.
 *
 * Признак — `kind` (`МАТЕРИАЛ` · `ОПЕРАЦИЯ` · `ФОТ`, Библиотека §1.1). Запасной
 * путь на случай строк без него: ЕИ «чел. ч» — это всегда труд.
 */
export function isWorkRow(row: TreeRow): boolean {
  const kind = String(row.kind ?? '').trim().toUpperCase()
  if (kind) return kind === 'ОПЕРАЦИЯ' || kind === 'ФОТ'
  return isFotRow(row) || String(row.unit ?? '').trim().toLowerCase() === 'чел. ч'
}

/** Позиция спецификации — строка расчёта, попавшая в документ заказчику. */
export interface SpecRow {
  name: string
  unit: string
  /** Количество на весь тираж — так же, как его показывает экран расчёта. */
  qty: number
}

/** Раздел спецификации: номер и заголовок из каркаса шаблона (Реверс §4.2). */
export interface SpecSection {
  code: string
  title: string
  rows: SpecRow[]
}

/** Спецификация целиком плюс то, что помешало собрать её точно. */
export interface Specification {
  sections: SpecSection[]
  /** Тираж, применённый к количествам (Механика §9.1). */
  tirage: number
  /**
   * Строки, количество которых определить не удалось. Пока список непуст,
   * печатать документ нельзя: любое число в нём будет выдумано.
   */
  unresolved: Array<{ name: string; unit: string; section: string }>
}

/** Тираж из сохранённых итогов расчёта; по умолчанию одно изделие. */
export function tirageOf(surveyData: unknown): number {
  if (!isObj(surveyData)) return 1
  const totals = isObj(surveyData.totals) ? surveyData.totals : null
  const t = totals?.tirage
  return typeof t === 'number' && Number.isInteger(t) && t >= 1 ? t : 1
}

/**
 * Спецификация изделия по разделам — состав для печатной формы КП.
 *
 * Отличие от {@link extractRows}: сохраняются номер и заголовок раздела, а
 * строки схлопываются до «наименование · ЕИ · количество». Цены сюда
 * намеренно не попадают — см. `utils/kp-document.ts`.
 *
 * Выключенные разделы, компоненты и строки, а также строки с нулевым
 * количеством отбрасываются: в итог они не входят, и в документе заказчику им
 * делать нечего. Работы и ФОТ не печатаются — см. {@link isWorkRow}: заказчик
 * покупает изделие, а не трудозатраты.
 *
 * КОЛИЧЕСТВА — НА ВЕСЬ ТИРАЖ. Экран расчёта показывает их так же (`engines/row.ts`,
 * resolveQty умножает на тираж), и цена продажи в снапшоте — тоже за весь тираж.
 * Спецификация за одно изделие рядом с ценой за N дала бы документ, в котором
 * состав и сумма относятся к разным вещам.
 *
 * Строки, количество которых определить не удалось, НЕ отбрасываются молча:
 * они попадают в `unresolved`, и печать по такой спецификации запрещается.
 *
 * Понимает только целевую форму (`tree.sections`): устаревшие `bundles[]`
 * не имеют разделов с номерами, а КП выпускается из снапшота, который
 * снимается уже с дерева.
 */
export function extractSpecification(surveyData: unknown): Specification {
  const tirage = tirageOf(surveyData)
  if (!isObj(surveyData)) return { sections: [], tirage, unresolved: [] }

  const tree = isObj(surveyData.tree) ? surveyData.tree : null
  const sections = asArray(tree?.sections ?? surveyData.sections)

  const out: SpecSection[] = []
  const unresolved: Specification['unresolved'] = []

  for (const s of sections) {
    if (!isObj(s) || s.enabled === false) continue
    const sectionTitle = String(s.title ?? '').trim() || 'Без названия'

    const rows: SpecRow[] = []
    for (const c of asArray(s.components)) {
      if (!isObj(c) || c.enabled === false) continue
      for (const r of asArray(c.rows)) {
        if (!isObj(r)) continue
        const row = r as TreeRow
        if (row.enabled === false) continue
        // Работы отбрасываются ДО разбора количества: строку, которой в
        // документе нет, незачем блокировать печать своим неразобранным
        // выражением.
        if (isWorkRow(row)) continue

        const name = String(row.name ?? '').trim() || '(без наименования)'
        const unit = String(row.unit ?? '').trim()

        const { qty, unresolved: bad } = resolveRowQty(row)
        if (bad) {
          unresolved.push({ name, unit, section: sectionTitle })
          continue
        }
        if (qty == null || qty <= 0) continue

        rows.push({ name, unit, qty: qty * tirage })
      }
    }

    // Раздел, из которого всё выключено, в документ не выводим.
    if (rows.length === 0) continue
    out.push({ code: String(s.code ?? '').trim(), title: sectionTitle, rows })
  }

  return { sections: out, tirage, unresolved }
}
