/**
 * Расчёт глазами снабженца.
 *
 * Снабженец видит только закупочные цены — те, что сам ведёт в прайсе, — и
 * только по закупаемым позициям. Заявке на закупку нужен расчёт: дерево с
 * количествами, по нему фронт считает строки тем же движком, что калькулятор.
 * Всё остальное из расчёта убирается здесь, на сервере, а не прячется
 * экраном:
 *  - итоги, наценка и цена продажи (`totals`, `totalRub`), слепки КП;
 *  - привязка к проекту — проекты снабженцу закрыты;
 *  - параметры ОЛ (в них цены трубы, насоса и т. п.) — дерево отдаётся как
 *    сохранено, без пересборки;
 *  - ставки экономики дерева и потерянные правки;
 *  - у строк — ручные цены инженера, а у незакупаемых (собственное
 *    производство, работы, ФОТ) и операций — любые цены.
 *
 * @module utils/purchase-view
 */

/** Категории, которые не закупаются (Механика §5.3; копия engines/types.ts). */
const NON_PURCHASE_CATEGORIES = ['Собственное производство', 'Работы', 'ФОТ']

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

/** Строка дерева для снабженца: цена прайса только у закупаемой позиции. */
function purchaseRow(row: unknown): unknown {
  if (!isObject(row)) return row
  const purchase = row.kind !== 'ОПЕРАЦИЯ' && !NON_PURCHASE_CATEGORIES.includes(String(row.category ?? ''))
  const out: Json = { ...row, priceManual: null }
  delete out.priceBinding
  delete out.priceCatalogPrev
  if (!purchase) out.priceCatalog = null
  return out
}

/** Дерево для снабженца: состав и количества как есть, цены — см. модуль. */
export function purchaseTree(tree: unknown): unknown {
  if (!isObject(tree)) return tree
  const out: Json = { ...tree, survey: {} }
  delete out.rates
  delete out.lostEdits
  if (Array.isArray(tree.sections)) {
    out.sections = tree.sections.map((section) => {
      if (!isObject(section) || !Array.isArray(section.components)) return section
      return {
        ...section,
        components: section.components.map((c) =>
          isObject(c) && Array.isArray(c.rows) ? { ...c, rows: c.rows.map(purchaseRow) } : c,
        ),
      }
    })
  }
  return out
}

/** Расчёт для снабженца — ответ `GET /api/estimates/:id` его роли. */
export function purchaseEstimateView<T extends { surveyData: unknown }>(estimate: T): T {
  const saved = isObject(estimate.surveyData) ? estimate.surveyData : {}
  const rev = typeof saved.treeSurveyRev === 'number' ? saved.treeSurveyRev : 0
  // Ревизии равны — фронт поднимет сохранённое дерево и не станет
  // пересобирать его из ОЛ, которого здесь нет.
  const surveyData = saved.tree ? { tree: purchaseTree(saved.tree), surveyRev: rev, treeSurveyRev: rev } : {}
  return { ...estimate, surveyData, totalRub: null, projectId: null, snapshots: [] }
}
