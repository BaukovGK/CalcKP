/**
 * Реестр цен: поиск, фильтры и порядок строк — без Vue, чтобы проверялось
 * тестами.
 *
 * Фильтры складываются: строка видна, если подходит под поиск, под выбранные
 * категории (ни одной не выбрано — все) и под включённые флаги («без цены»,
 * «с замечаниями»). Счётчики у категорий считаются по остальным фильтрам,
 * без фильтра категорий: так видно, сколько найдётся, если категорию
 * добавить.
 */

export interface RegistryItem {
  id: string
  category: string
  name: string
  unit: string
  priceRub: number | null
  supplier: string | null
  comment: string | null
  updatedAt: string
  /** Замечание к цене с сервера (utils/price-issues.ts на бэкенде) или `null`. */
  issue?: string | null
}

export interface RegistryFilter {
  query: string
  /** Выбранные категории; пусто — все. */
  categories: ReadonlySet<string>
  noPrice: boolean
  issues: boolean
}

export type RegistrySortKey = 'name' | 'price' | 'updated'
export interface RegistrySort {
  key: RegistrySortKey
  dir: 1 | -1
}

/** Ставки и своё производство — сверху, как в листе «НН»; остальное по алфавиту. */
const FIRST_CATEGORIES = ['ФОТ', 'Собственное производство']

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' })

export function orderCategories(categories: Iterable<string>): string[] {
  const rank = (c: string) => {
    const i = FIRST_CATEGORIES.indexOf(c)
    return i === -1 ? FIRST_CATEGORIES.length : i
  }
  return [...new Set(categories)].sort((a, b) => rank(a) - rank(b) || collator.compare(a, b))
}

/** Текст для поиска: строчные, «ё» как «е», пробелы схлопнуты. */
export function searchText(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

/** Где ищется запрос: наименование, ЕИ, поставщик, комментарий. */
export function haystack(item: RegistryItem): string {
  return searchText([item.name, item.unit, item.supplier ?? '', item.comment ?? ''].join(' '))
}

/**
 * Подходит ли строка. Запрос — слова через пробел, каждое должно найтись
 * (порядок не важен): «болт 16 din» найдёт «Болт М16-6gх… (DIN 931)».
 */
export function matches(
  item: RegistryItem,
  hay: string,
  filter: RegistryFilter,
  opts: { ignoreCategories?: boolean } = {},
): boolean {
  if (!opts.ignoreCategories && filter.categories.size > 0 && !filter.categories.has(item.category)) return false
  if (filter.noPrice && item.priceRub != null) return false
  if (filter.issues && !item.issue) return false
  const words = searchText(filter.query).split(' ').filter(Boolean)
  return words.every((w) => hay.includes(w))
}

/**
 * Порядок строк: по категориям в порядке «НН», внутри — по выбранному полю.
 * Строки без цены при сортировке по цене — в конце в любом направлении:
 * иначе «без цены» заслоняли бы собой самые дешёвые или самые дорогие.
 */
export function sortItems<T extends RegistryItem>(items: T[], sort: RegistrySort): T[] {
  const order = orderCategories(items.map((i) => i.category))
  const rank = new Map(order.map((c, i) => [c, i]))
  const byKey = (a: T, b: T): number => {
    if (sort.key === 'price') {
      if (a.priceRub == null || b.priceRub == null) {
        return a.priceRub == null && b.priceRub == null ? 0 : a.priceRub == null ? 1 : -1
      }
      return (a.priceRub - b.priceRub) * sort.dir
    }
    if (sort.key === 'updated') return (Date.parse(a.updatedAt) - Date.parse(b.updatedAt)) * sort.dir
    return collator.compare(a.name, b.name) * sort.dir
  }
  return [...items].sort(
    (a, b) =>
      (rank.get(a.category)! - rank.get(b.category)!) ||
      byKey(a, b) ||
      collator.compare(a.name, b.name) ||
      collator.compare(a.unit, b.unit),
  )
}

export function countByCategory(items: RegistryItem[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const i of items) m.set(i.category, (m.get(i.category) ?? 0) + 1)
  return m
}

/** Строки с заголовками категорий — ровно столько строк, сколько велено показать. */
export type RegistryLine<T> = { kind: 'group'; category: string; total: number } | { kind: 'item'; item: T }

export function withGroups<T extends RegistryItem>(sorted: T[], limit: number): RegistryLine<T>[] {
  const totals = countByCategory(sorted)
  const out: RegistryLine<T>[] = []
  let shown = 0
  let current: string | null = null
  for (const item of sorted) {
    if (shown >= limit) break
    if (item.category !== current) {
      current = item.category
      out.push({ kind: 'group', category: current, total: totals.get(current) ?? 0 })
    }
    out.push({ kind: 'item', item })
    shown++
  }
  return out
}
