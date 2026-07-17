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
 * GET /api/refs/engineering — инженерные матрицы листа «Для расчетов»
 * (ТЗ §7, приоритет высокий; Реверс §9.3).
 *
 * `shell`          вес и толщина корпуса      = f(Dу, L) — 140 ячеек
 * `ellipticBottom` формовка эллиптических днищ = f(Dн, L) — 140 ячеек
 * `nozzles`        нормы простых патрубков     = f(DN)    — 26 позиций
 *
 * Нормы патрубков — источник массы формовки гильз (Библиотека A5): без них
 * количество приходилось вводить вручную.
 */
refsRouter.get('/engineering', async (_req, res, next) => {
  try {
    const [matrix, nozzles] = await Promise.all([
      prisma.engineeringMatrix.findMany({
        orderBy: [{ kind: 'asc' }, { d: 'asc' }, { lengthMm: 'asc' }],
        select: { kind: true, d: true, lengthMm: true, massKg: true, thicknessMm: true },
      }),
      prisma.nozzleNorm.findMany({
        orderBy: { dn: 'asc' },
        select: {
          dn: true, odMm: true, minLengthMm: true, moldingMassKg: true,
          h1Mm: true, s1Mm: true, flangeMassKg: true, bolt: true, boltCount: true,
        },
      }),
    ])

    res.json({
      shell: matrix.filter((m) => m.kind === 'SHELL').map(({ kind: _kind, ...c }) => c),
      ellipticBottom: matrix.filter((m) => m.kind === 'ELLIPTIC_BOTTOM').map(({ kind: _kind, ...c }) => c),
      nozzles,
    })
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
