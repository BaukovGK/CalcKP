import { Router } from 'express'
import type { Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import multer from 'multer'
import { prisma } from '../utils/prisma'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { audit } from '../utils/audit'
import { deliveryRatePatchSchema, deliveryRateSchema, parseDeliverySheet } from '../utils/delivery-rates'

/**
 * Тарифы доставки (книга отдела закупок, utils/delivery-rates.ts).
 *
 * Читают все вошедшие: менеджер выбирает город доставки в опросном листе.
 * Правят закупка и администратор — построчно с экрана или импортом книги.
 */
export const deliveryRatesRouter = Router()
deliveryRatesRouter.use('/', requireAuth)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
})

const order = [{ sortOrder: 'asc' as const }, { city: 'asc' as const }]

/** GET /api/delivery-rates — все маршруты в порядке книги. */
deliveryRatesRouter.get('/', async (_req, res: Response, next: NextFunction) => {
  try {
    res.json(await prisma.deliveryRate.findMany({ orderBy: order }))
  } catch (e) { next(e) }
})

/** POST /api/delivery-rates — новый маршрут (в конец списка, если порядок не задан). */
deliveryRatesRouter.post('/', requireRole('ADMIN', 'BUYER'), validate(deliveryRateSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const last = await prisma.deliveryRate.aggregate({ _max: { sortOrder: true } })
    const item = await prisma.deliveryRate.create({
      data: { ...req.body, sortOrder: req.body.sortOrder ?? (last._max.sortOrder ?? 0) + 1 },
    })
    await audit(auth.userId, 'delivery.create', 'DeliveryRate', item.id, { city: item.city })
    res.status(201).json(item)
  } catch (e) { next(e) }
})

/** PATCH /api/delivery-rates/:id — правка маршрута, ставок, примечания. */
deliveryRatesRouter.patch('/:id', requireRole('ADMIN', 'BUYER'), validate(deliveryRatePatchSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id = String(req.params.id)
    const before = await prisma.deliveryRate.findUnique({ where: { id } })
    if (!before) { res.status(404).json({ message: 'Маршрут не найден' }); return }
    const item = await prisma.deliveryRate.update({ where: { id }, data: req.body })
    const changed = Object.keys(req.body).filter(
      (k) => (before as Record<string, unknown>)[k] !== (item as Record<string, unknown>)[k],
    )
    if (changed.length) {
      await audit(auth.userId, 'delivery.update', 'DeliveryRate', id, {
        city: item.city,
        changes: changed.map((k) => ({
          field: k,
          from: (before as Record<string, unknown>)[k] ?? null,
          to: (item as Record<string, unknown>)[k] ?? null,
        })),
      })
    }
    res.json(item)
  } catch (e) { next(e) }
})

/** DELETE /api/delivery-rates/:id */
deliveryRatesRouter.delete('/:id', requireRole('ADMIN', 'BUYER'), async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id = String(req.params.id)
    const before = await prisma.deliveryRate.findUnique({ where: { id } })
    if (!before) { res.status(404).json({ message: 'Маршрут не найден' }); return }
    await prisma.deliveryRate.delete({ where: { id } })
    await audit(auth.userId, 'delivery.delete', 'DeliveryRate', id, { city: before.city })
    res.status(204).end()
  } catch (e) { next(e) }
})

/**
 * POST /api/delivery-rates/import — книга тарифов целиком (multipart, поле
 * `file`; `dryRun=1` — только показать, что придёт).
 *
 * Книга квартальная и заменяет прежнюю: таблица перезаписывается целиком.
 * Опросные листы помнят город по названию, поэтому выбранный город после
 * импорта находится снова.
 */
deliveryRatesRouter.post('/import', requireRole('ADMIN', 'BUYER'), upload.single('file'), async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file
    if (!file) { res.status(400).json({ message: 'Файл не передан: ожидается multipart/form-data, поле «file»' }); return }
    const dryRun = ['1', 'true'].includes(String(req.body?.dryRun ?? ''))

    const wb = new ExcelJS.Workbook()
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer)
    } catch {
      res.status(400).json({ message: 'Не удалось прочитать файл: ожидается книга .xlsx' })
      return
    }
    const ws = wb.worksheets[0]
    if (!ws) { res.status(400).json({ message: 'В книге нет листов' }); return }

    const parsed = parseDeliverySheet(ws)
    if (parsed.rows.length === 0) {
      res.status(400).json({ message: `Лист «${ws.name}» не содержит маршрутов`, skipped: parsed.skipped })
      return
    }

    const before = await prisma.deliveryRate.count()
    const summary = {
      dryRun,
      sheet: ws.name,
      rows: parsed.rows.length,
      replaced: before,
      skipped: parsed.skipped,
      sample: parsed.rows.slice(0, 5),
    }
    if (dryRun) { res.json(summary); return }

    await prisma.$transaction([
      prisma.deliveryRate.deleteMany({}),
      prisma.deliveryRate.createMany({ data: parsed.rows }),
    ])
    await audit(auth.userId, 'delivery.import', 'DeliveryRate', undefined, {
      file: file.originalname,
      sheet: ws.name,
      rows: parsed.rows.length,
      replaced: before,
      skipped: parsed.skipped.length,
    })
    res.json(summary)
  } catch (e) { next(e) }
})
