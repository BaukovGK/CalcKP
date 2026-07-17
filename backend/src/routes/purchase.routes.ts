import { Router } from 'express'
import ExcelJS from 'exceljs'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { audit } from '../utils/audit'
import type { Response, NextFunction } from 'express'

/**
 * Заявка на закупку (ТЗ §9.6).
 *
 * «Отчёт-представление поверх расчёта, НЕ отдельная сущность данных» — поэтому
 * своей таблицы у неё нет: строки приходят из дерева расчёта.
 *
 * Строки считает фронтенд (там движок §9 с двухканальным override и парсером
 * арифметики, покрытый тестами) и присылает готовыми. Дублировать движок на
 * бэкенде ради выгрузки — держать две реализации одних формул и получить
 * расхождение; это внутренний закупочный документ, а не цена заказчику.
 * Точка фиксации цены — снапшот при выпуске КП (ТЗ §4.3).
 */
export const purchaseRouter = Router()
purchaseRouter.use('/', requireAuth)

const rowSchema = z.object({
  category: z.string(),
  name: z.string(),
  unit: z.string(),
  qty: z.number(),
  price: z.number().nullable(),
  sum: z.number(),
})

const exportSchema = z.object({
  rows: z.array(rowSchema).min(1),
})

/** Колонки — дословно по ТЗ §9.6. */
const COLUMNS: Array<{ header: string; key: string; width: number }> = [
  { header: '№', key: 'n', width: 5 },
  { header: 'Категория', key: 'category', width: 26 },
  { header: 'Наименование', key: 'name', width: 60 },
  { header: 'ЕИ', key: 'unit', width: 8 },
  { header: 'Кол-во', key: 'qty', width: 10 },
  { header: 'Бюджетная цена', key: 'price', width: 16 },
  { header: 'Бюджетная стоимость', key: 'sum', width: 20 },
  { header: 'Дата закупки', key: 'buyDate', width: 14 },
  { header: 'Отметка об исполнении', key: 'done', width: 22 },
]

purchaseRouter.post(
  '/:id/purchase-request/export',
  requireRole('ADMIN', 'MANAGER', 'ENGINEER', 'BUYER'),
  validate(exportSchema),
  async (req, res: Response, next: NextFunction) => {
    try {
      const auth = req as AuthRequest
      const id = String(req.params.id)

      const estimate = await prisma.estimate.findUnique({
        where: { id },
        include: { project: { select: { title: true, customer: true } } },
      })
      if (!estimate) { res.status(404).json({ message: 'Расчёт не найден' }); return }
      // BUYER ведёт закупку по чужим расчётам — доступ к Заявке ему нужен.
      const canRead =
        auth.userRole === 'ADMIN' || auth.userRole === 'MANAGER' || auth.userRole === 'BUYER' ||
        estimate.authorId === auth.userId
      if (!canRead) { res.status(403).json({ message: 'Нет доступа' }); return }

      const rows = req.body.rows as z.infer<typeof rowSchema>[]

      const wb = new ExcelJS.Workbook()
      wb.creator = 'НТТ Калькулятор'
      const ws = wb.addWorksheet('Заявка')

      // Шапка документа
      ws.mergeCells('A1:I1')
      ws.getCell('A1').value = `Заявка на закупку · ${estimate.title}`
      ws.getCell('A1').font = { bold: true, size: 13 }

      ws.mergeCells('A2:I2')
      const meta = [estimate.project?.customer, estimate.project?.title].filter(Boolean).join(' · ')
      ws.getCell('A2').value = meta || '—'
      ws.getCell('A2').font = { size: 10 }

      ws.addRow([])
      const head = ws.addRow(COLUMNS.map((c) => c.header))
      head.font = { bold: true }
      head.eachCell((c) => {
        c.border = { bottom: { style: 'thin' } }
        c.alignment = { wrapText: true, vertical: 'middle' }
      })
      COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width })

      rows.forEach((r, i) => {
        const row = ws.addRow([
          i + 1,
          r.category,
          r.name,
          r.unit,
          r.qty,
          r.price,
          r.sum,
          // Заполняет отдел закупок — колонки предусмотрены ТЗ §9.6.
          null,
          null,
        ])
        row.getCell(5).numFmt = '# ##0.###'
        row.getCell(6).numFmt = '# ##0.00'
        row.getCell(7).numFmt = '# ##0.00'
      })

      const total = ws.addRow([null, null, 'ИТОГО', null, null, null, rows.reduce((s, r) => s + r.sum, 0), null, null])
      total.font = { bold: true }
      total.getCell(7).numFmt = '# ##0.00'
      total.getCell(7).border = { top: { style: 'thin' } }

      await audit(auth.userId, 'purchase.export', 'Estimate', id, { rows: rows.length })

      const name = encodeURIComponent(`Заявка_${estimate.title}.xlsx`)
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${name}`)
      await wb.xlsx.write(res)
      res.end()
    } catch (e) { next(e) }
  },
)
