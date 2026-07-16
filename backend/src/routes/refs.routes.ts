import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../utils/prisma'

export const refsRouter = Router()
refsRouter.use('/', requireAuth)

/**
 * GET /api/refs/nomenclature — прайс, сгруппированный по категориям (ТЗ §7).
 *
 * Заменяет статику `ntt-calculator/src/data/nomenclature.ts`: та содержала
 * ~17 позиций с пустой ценой и была вторым, конкурирующим источником цен.
 */
refsRouter.get('/nomenclature', async (_req, res, next) => {
  try {
    const items = await prisma.priceItem.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: { id: true, category: true, name: true, unit: true, priceRub: true, comment: true },
    })

    const byCategory: Record<string, typeof items> = {}
    for (const item of items) {
      ;(byCategory[item.category] ??= []).push(item)
    }

    res.json(byCategory)
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/refs/pipe-weights — веса труб (ТЗ §7, приоритет высокий).
 *
 * GRP: ключ (DN; PN; SN) → толщина стенки, кг/пм — 162 позиции, DN 300…3000.
 * ПЭ: ПЭ-100 SDR17 — 26 позиций.
 *
 * ⚠️ PN здесь — это PN_ТРУБЫ (автоподбор, ячейка F7 эталона), а НЕ PN
 * опросного листа (ТЗ §9.4). Домены: PN {0,6; 1; 1,6}, SN {2500; 5000; 10000};
 * PN = 0,1 и SN = 1250 из ОЛ в справочнике отсутствуют — искать по ним нельзя.
 */
refsRouter.get('/pipe-weights', async (_req, res, next) => {
  try {
    const [grp, pe] = await Promise.all([
      prisma.pipeWeight.findMany({
        orderBy: [{ dn: 'asc' }, { sn: 'asc' }, { pn: 'asc' }],
        select: { dn: true, pn: true, sn: true, wallMm: true, kgPerM: true },
      }),
      prisma.pePipe.findMany({
        orderBy: { odMm: 'asc' },
        select: { dn: true, name: true, odMm: true, wallMm: true, kgPerM: true },
      }),
    ])

    res.json({ grp, pe })
  } catch (e) {
    next(e)
  }
})
