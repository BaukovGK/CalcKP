import type { PrismaClient } from '@prisma/client'
import { lookupKeyOf, type NnDuplicate, type NnParseResult, type NnRow } from './nn-sheet'

/**
 * Импорт прайса из листа «НН»: сначала план (что изменится), потом
 * применение. План строится без записи в базу — на нём держится
 * предпросмотр в интерфейсе: закупщик видит, какие цены поменяются, и
 * только потом соглашается.
 *
 * Правила:
 *  - ключ — тройка (категория, наименование, ЕИ) в каноническом виде;
 *  - позиции, которых нет в файле, не удаляются: в базе живут и позиции,
 *    которых в листе нет вовсе (цены насосов, ставки);
 *  - пустая цена в файле цену базы НЕ стирает: пустая ячейка значит «цену
 *    не знаю», а не «цены больше нет» — такие строки показываются отдельно;
 *  - поставщик меняется, только если в файле есть его колонка и ячейка
 *    заполнена (в листе мастер-шаблона колонки нет).
 */

/** Позиция базы — в объёме, нужном для сравнения. */
export interface ExistingPrice {
  id: string
  category: string
  name: string
  unit: string
  priceBaseRub: number | null
  discountPct: number | null
  currency: string
  priceRub: number | null
  supplier: string | null
  comment: string | null
}

interface RowRef {
  sheetRow: number
  category: string
  name: string
  unit: string
}

export interface PriceChange extends RowRef {
  oldPrice: number | null
  newPrice: number | null
}

export interface ImportPlan {
  /** Новые позиции. */
  created: Array<RowRef & { priceRub: number | null }>
  /** Позиции, у которых меняется цена. */
  changed: PriceChange[]
  /** Совпали с базой полностью — записи не будет. */
  unchanged: number
  /** Цена та же, поменялось сопутствующее (комментарий, цена без скидки…). */
  touched: number
  /** В файле цена пустая, в базе есть — цена базы оставлена. */
  keptPrices: Array<RowRef & { dbPrice: number }>
  /** Позиции базы, которых нет в файле, — остаются как есть. */
  missingInFile: number
  duplicates: NnDuplicate[]
  skipped: NnParseResult['skipped']
  nameFixes: NnParseResult['nameFixes']
  /** Для применения: что писать по каждой строке файла. */
  writes: Array<{ row: NnRow; existingId: string | null; priceChanged: boolean; oldPrice: number | null }>
}

const ref = (r: NnRow): RowRef => ({ sheetRow: r.sheetRow, category: r.category, name: r.name, unit: r.unit })

/** Поля, которые импорт пишет в позицию, — по строке файла и прежнему состоянию. */
export function importedFields(row: NnRow, prev: ExistingPrice | null) {
  const keepPrice = row.priceRub == null && prev?.priceRub != null
  return {
    lookupKey: lookupKeyOf(row.category, row.name, row.unit),
    category: row.category,
    name: row.name,
    unit: row.unit,
    // Пустая цена не стирает цену базы — вместе с ценой без скидки и
    // скидкой, иначе они разошлись бы с оставленной ценой.
    priceBaseRub: keepPrice ? prev!.priceBaseRub : row.priceBaseRub,
    discountPct: keepPrice ? prev!.discountPct : row.discountPct,
    priceRub: keepPrice ? prev!.priceRub : row.priceRub,
    currency: row.currency,
    comment: row.comment,
    supplier: row.supplier ? row.supplier : (prev?.supplier ?? null),
  }
}

function sameFields(a: ReturnType<typeof importedFields>, b: ExistingPrice): boolean {
  return (
    a.priceBaseRub === b.priceBaseRub &&
    a.discountPct === b.discountPct &&
    a.priceRub === b.priceRub &&
    a.currency === b.currency &&
    a.comment === b.comment &&
    a.supplier === b.supplier
  )
}

export function planImport(parsed: NnParseResult, existing: ExistingPrice[]): ImportPlan {
  const byKey = new Map(existing.map((p) => [lookupKeyOf(p.category, p.name, p.unit), p]))
  const plan: ImportPlan = {
    created: [],
    changed: [],
    unchanged: 0,
    touched: 0,
    keptPrices: [],
    missingInFile: 0,
    duplicates: parsed.duplicates,
    skipped: parsed.skipped,
    nameFixes: parsed.nameFixes,
    writes: [],
  }

  const inFile = new Set<string>()
  for (const row of parsed.rows) {
    const key = lookupKeyOf(row.category, row.name, row.unit)
    inFile.add(key)
    const prev = byKey.get(key) ?? null

    if (!prev) {
      plan.created.push({ ...ref(row), priceRub: row.priceRub })
      plan.writes.push({ row, existingId: null, priceChanged: false, oldPrice: null })
      continue
    }

    if (row.priceRub == null && prev.priceRub != null) {
      plan.keptPrices.push({ ...ref(row), dbPrice: prev.priceRub })
    }

    const fields = importedFields(row, prev)
    if (sameFields(fields, prev)) {
      plan.unchanged++
      continue
    }
    const priceChanged = fields.priceRub !== prev.priceRub
    if (priceChanged) plan.changed.push({ ...ref(row), oldPrice: prev.priceRub, newPrice: fields.priceRub })
    else plan.touched++
    plan.writes.push({ row, existingId: prev.id, priceChanged, oldPrice: prev.priceRub })
  }

  plan.missingInFile = existing.filter((p) => !inFile.has(lookupKeyOf(p.category, p.name, p.unit))).length
  return plan
}

/**
 * Применить план одной транзакцией: половина прайса со старыми ценами и
 * половина с новыми хуже любого из двух состояний.
 *
 * Версия прайса создаётся, только если что-то поменялось: пустой импорт не
 * должен плодить «новые» версии, на которые потом сошлются снапшоты.
 *
 * @returns номер новой версии прайса или `null`, если менять было нечего
 */
export async function applyImport(
  prisma: PrismaClient,
  plan: ImportPlan,
  existing: ExistingPrice[],
  opts: { userId: string | null; label?: string; note: string },
): Promise<number | null> {
  if (plan.writes.length === 0) return null
  const byId = new Map(existing.map((p) => [p.id, p]))

  return prisma.$transaction(
    async (tx) => {
      for (const w of plan.writes) {
        const prev = w.existingId ? byId.get(w.existingId) ?? null : null
        const data = importedFields(w.row, prev)
        if (!w.existingId) {
          await tx.priceItem.create({ data })
          continue
        }
        await tx.priceItem.update({ where: { id: w.existingId }, data })
        // История — только при фактической смене цены: иначе каждый импорт
        // плодил бы сотни пустых событий.
        if (w.priceChanged) {
          await tx.priceHistory.create({
            data: { priceItemId: w.existingId, oldPrice: w.oldPrice, newPrice: data.priceRub, changedById: opts.userId },
          })
        }
      }

      if (plan.created.length === 0 && plan.changed.length === 0) return null

      // Новая версия прайса: снапшоты расчётов ссылаются на неё (ТЗ §3).
      const last = await tx.priceListVersion.findFirst({ orderBy: { version: 'desc' } })
      const version = (last?.version ?? 0) + 1
      await tx.priceListVersion.create({
        data: { version, label: opts.label || `НН v${version}`, note: opts.note, createdById: opts.userId },
      })
      return version
    },
    // ~1000 строк последовательными запросами — дольше пяти секунд по
    // умолчанию у интерактивной транзакции Prisma.
    { timeout: 120_000, maxWait: 10_000 },
  )
}

/** Позиции базы в объёме, нужном плану. */
export function loadExisting(prisma: PrismaClient): Promise<ExistingPrice[]> {
  return prisma.priceItem.findMany({
    select: {
      id: true,
      category: true,
      name: true,
      unit: true,
      priceBaseRub: true,
      discountPct: true,
      currency: true,
      priceRub: true,
      supplier: true,
      comment: true,
    },
  })
}

/** Ответ импорта — для интерфейса и консоли, общий для предпросмотра и применения. */
export function importSummary(plan: ImportPlan, version: number | null, dryRun: boolean) {
  return {
    dryRun,
    version,
    created: plan.created.length,
    updated: plan.changed.length,
    touched: plan.touched,
    unchanged: plan.unchanged,
    keptPrice: plan.keptPrices.length,
    missingInFile: plan.missingInFile,
    skipped: plan.skipped.length + plan.duplicates.length,
    nameFixes: plan.nameFixes.length,
    changes: plan.changed,
    createdItems: plan.created,
    keptPrices: plan.keptPrices,
    // Дубли ключа в НН — реальность исходных данных (План §4.1-bis C):
    // побеждает первая запись, ровно как VLOOKUP.
    duplicates: plan.duplicates,
    skippedRows: plan.skipped,
    // Все исправления не нужны — хватит примеров, чтобы понять, что правилось.
    nameFixSamples: plan.nameFixes.slice(0, 30),
  }
}
