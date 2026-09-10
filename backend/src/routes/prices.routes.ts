import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { audit } from '../utils/audit'
import { logger } from '../utils/logger'
import { parseNnSheet } from '../utils/nn-sheet'
import { buildPriceWorkbook } from '../utils/nn-export'
import { findPriceIssues } from '../utils/price-issues'
import { applyImport, importSummary, loadExisting, planImport } from '../utils/price-import'
import ExcelJS from 'exceljs'
import multer from 'multer'
import type { Response, NextFunction } from 'express'

export const pricesRouter = Router()
pricesRouter.use('/', requireAuth)

/**
 * Файл держим в памяти: прайс НН — ~1000 строк, около 1 МБ; на диск писать
 * незачем. Лимит защищает от заливки произвольно большого файла.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
})

/**
 * GET /api/prices — позиции прайса.
 *
 * К каждой приложено `issue` — замечание к цене (utils/price-issues.ts: ноль,
 * расхождение с ценой без скидки, лист за штуку против цены за м²) или
 * `null`. Те же замечания, что на листе «Проверка» выгрузки; «нет цены»
 * сюда не входит — экран видит его по самой цене.
 */
pricesRouter.get('/', async (_req, res: Response, next: NextFunction) => {
  try {
    const items = await prisma.priceItem.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })
    const issues = new Map<number, string[]>()
    for (const i of findPriceIssues(items)) {
      if (i.kind === 'no-price') continue
      issues.set(i.index, [...(issues.get(i.index) ?? []), i.message])
    }
    res.json(items.map((p, index) => ({ ...p, issue: issues.get(index)?.join('; ') ?? null })))
  } catch (e) { next(e) }
})

/**
 * GET /api/prices/export — прайс книгой .xlsx в раскладке листа «НН».
 *
 * Выгрузку можно вставить в свою книгу закупок или поправить и загрузить
 * обратно импортом. Второй лист, «Проверка», — позиции без цены и с
 * подозрительными ценами (utils/nn-export.ts).
 */
pricesRouter.get('/export', requireRole('ADMIN', 'BUYER'), async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const [items, version] = await Promise.all([
      prisma.priceItem.findMany(),
      prisma.priceListVersion.findFirst({ orderBy: { version: 'desc' } }),
    ])
    const wb = buildPriceWorkbook(items, { versionLabel: version?.label ?? null })

    await audit(auth.userId, 'prices.export', 'PriceListVersion', version ? String(version.version) : undefined, {
      items: items.length,
    })

    const date = new Date().toISOString().slice(0, 10)
    const name = encodeURIComponent(`Прайс_НН_${date}.xlsx`)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${name}`)
    await wb.xlsx.write(res)
    res.end()
  } catch (e) { next(e) }
})

const patchSchema = z.object({
  priceRub: z.number().nonnegative().optional(),
  supplier: z.string().optional(),
})

// PATCH /api/prices/:id
pricesRouter.patch('/:id', requireRole('ADMIN', 'BUYER'), validate(patchSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const id      = String(req.params.id)
    const current = await prisma.priceItem.findUnique({ where: { id } })
    if (!current) { res.status(404).json({ message: 'Позиция не найдена' }); return }
    const auth = req as AuthRequest
    const updated = await prisma.priceItem.update({ where: { id }, data: req.body })

    // PriceHistory пишем только при фактическом изменении цены: правка одного
    // лишь поставщика не создаёт ценовое событие.
    if (req.body.priceRub != null && req.body.priceRub !== current.priceRub) {
      await prisma.priceHistory.create({
        data: {
          priceItemId: current.id,
          oldPrice: current.priceRub,
          newPrice: req.body.priceRub,
          changedById: auth.userId,
        },
      })
    }

    await audit(auth.userId, 'prices.update', 'PriceItem', current.id, {
      name: current.name,
      oldPrice: current.priceRub,
      newPrice: req.body.priceRub ?? current.priceRub,
    })

    res.json(updated)
  } catch (e) { next(e) }
})

/**
 * POST /api/prices/import — импорт прайса из .xlsx (ТЗ §7, приоритет высокий).
 *
 * Тело: multipart/form-data, поле `file`. Опционально `sheet` (имя листа,
 * по умолчанию «НН»), `label` (подпись версии прайса) и `dryRun` («1» —
 * только показать, что изменится, ничего не записывая).
 *
 * Правила импорта — в utils/price-import.ts: upsert по тройке (категория,
 * наименование, ЕИ) в каноническом виде, позиции без строки в файле не
 * удаляются, пустая цена в файле цену базы не стирает. Каждое изменение цены
 * пишется в PriceHistory; если цены поменялись, создаётся новая версия
 * прайса: «прайс версионируется целиком» (ТЗ §3).
 */
pricesRouter.post(
  '/import',
  requireRole('ADMIN', 'BUYER'),
  upload.single('file'),
  async (req, res: Response, next: NextFunction) => {
    try {
      const auth = req as AuthRequest
      const file = (req as AuthRequest & { file?: Express.Multer.File }).file
      if (!file) {
        res.status(400).json({ message: 'Файл не передан: ожидается multipart/form-data, поле «file»' })
        return
      }
      const dryRun = ['1', 'true'].includes(String(req.body?.dryRun ?? ''))

      const wb = new ExcelJS.Workbook()
      try {
        await wb.xlsx.load(file.buffer as unknown as ArrayBuffer)
      } catch {
        res.status(400).json({ message: 'Не удалось прочитать файл: ожидается книга .xlsx' })
        return
      }

      const sheetName = String(req.body?.sheet ?? 'НН')
      const ws = wb.getWorksheet(sheetName)
      if (!ws) {
        res.status(400).json({
          message: `Лист «${sheetName}» не найден`,
          sheets: wb.worksheets.map((w) => w.name),
        })
        return
      }

      const parsed = parseNnSheet(ws)
      if (parsed.rows.length === 0) {
        res.status(400).json({ message: `Лист «${sheetName}» не содержит позиций прайса` })
        return
      }

      // Текущее состояние — одним запросом: по позиции на строку было бы
      // ~1000 round-trip'ов.
      const existing = await loadExisting(prisma)
      const plan = planImport(parsed, existing)

      if (dryRun) {
        res.json(importSummary(plan, null, true))
        return
      }

      const version = await applyImport(prisma, plan, existing, {
        userId: auth.userId ?? null,
        label: req.body?.label ? String(req.body.label) : undefined,
        note: `Импорт из «${file.originalname}», лист «${sheetName}»`,
      })

      // Не «тихая» усечка: что именно отброшено — видно и в ответе, и в логе.
      if (plan.skipped.length + plan.duplicates.length > 0) {
        logger.warn('Импорт прайса: часть строк пропущена', {
          skipped: plan.skipped,
          duplicates: plan.duplicates,
        })
      }

      await audit(auth.userId, 'prices.import', 'PriceListVersion', version != null ? String(version) : undefined, {
        file: file.originalname,
        sheet: sheetName,
        created: plan.created.length,
        updated: plan.changed.length,
        touched: plan.touched,
        unchanged: plan.unchanged,
        keptPrice: plan.keptPrices.length,
        skipped: plan.skipped.length + plan.duplicates.length,
      })

      res.json(importSummary(plan, version, false))
    } catch (e) { next(e) }
  },
)
