import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { audit } from '../utils/audit'
import { logger } from '../utils/logger'
import { lookupKeyOf, parseNnSheet } from '../utils/nn-sheet'
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

// GET /api/prices
pricesRouter.get('/', async (_req, res: Response, next: NextFunction) => {
  try {
    const items = await prisma.priceItem.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })
    res.json(items)
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
 * по умолчанию «НН») и `label` (подпись версии прайса).
 *
 * Upsert по тройке (категория, наименование, ЕИ) — реальному ключу прайса.
 * Каждое изменение цены пишется в PriceHistory. Импорт создаёт новую версию
 * прайса: «Прайс версионируется целиком» (ТЗ §3).
 *
 * Ответ: `{ updated, created, skipped, version, duplicates }`.
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

      let created = 0
      let updated = 0
      let unchanged = 0

      // Читаем текущее состояние одним запросом: по позиции на строку было бы
      // ~1000 round-trip'ов.
      const existing = await prisma.priceItem.findMany({
        select: { id: true, category: true, name: true, unit: true, priceRub: true },
      })
      const byKey = new Map(existing.map((p) => [lookupKeyOf(p.category, p.name, p.unit), p]))

      for (const row of parsed.rows) {
        const key = lookupKeyOf(row.category, row.name, row.unit)
        const prev = byKey.get(key)

        const data = {
          lookupKey: key,
          category: row.category,
          name: row.name,
          unit: row.unit,
          priceBaseRub: row.priceBaseRub,
          discountPct: row.discountPct,
          currency: row.currency,
          priceRub: row.priceRub,
          comment: row.comment,
        }

        if (!prev) {
          await prisma.priceItem.create({ data })
          created++
          continue
        }

        if (prev.priceRub === row.priceRub) {
          // Цена не изменилась — обновляем сопутствующие поля без записи в
          // историю: иначе каждый импорт плодил бы ~1000 пустых событий.
          await prisma.priceItem.update({ where: { id: prev.id }, data })
          unchanged++
          continue
        }

        await prisma.priceItem.update({ where: { id: prev.id }, data })
        await prisma.priceHistory.create({
          data: {
            priceItemId: prev.id,
            oldPrice: prev.priceRub,
            newPrice: row.priceRub,
            changedById: auth.userId,
          },
        })
        updated++
      }

      // Новая версия прайса: снапшоты расчётов ссылаются на неё (ТЗ §3).
      const last = await prisma.priceListVersion.findFirst({ orderBy: { version: 'desc' } })
      const version = (last?.version ?? 0) + 1
      await prisma.priceListVersion.create({
        data: {
          version,
          label: String(req.body?.label ?? `НН v${version}`),
          note: `Импорт из «${file.originalname}», лист «${sheetName}»`,
          createdById: auth.userId,
        },
      })

      const skipped = parsed.skipped.length + parsed.duplicates.length

      // Не «тихая» усечка: что именно отброшено — видно и в ответе, и в логе.
      if (skipped > 0) {
        logger.warn('Импорт прайса: часть строк пропущена', {
          skipped: parsed.skipped,
          duplicates: parsed.duplicates,
        })
      }

      await audit(auth.userId, 'prices.import', 'PriceListVersion', String(version), {
        file: file.originalname,
        sheet: sheetName,
        created,
        updated,
        unchanged,
        skipped,
      })

      res.json({
        created,
        updated,
        unchanged,
        skipped,
        version,
        // Дубли ключа в НН — реальность исходных данных (План §4.1-bis C):
        // побеждает первая запись, ровно как VLOOKUP.
        duplicates: parsed.duplicates,
        skippedRows: parsed.skipped,
      })
    } catch (e) { next(e) }
  },
)
