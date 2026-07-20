import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { audit } from '../utils/audit'
import { rowsWithoutPrice } from '../utils/estimate-tree'
import type { Response, NextFunction } from 'express'

export const estimatesRouter = Router()
estimatesRouter.use('/', requireAuth)

/**
 * Доступ к расчёту (ТЗ §2).
 *
 * ADMIN — все расчёты; MANAGER — расчёты команды (проверяет и утверждает);
 * остальные — только свои.
 *
 * Раньше здесь стояло `role !== 'ADMIN' && authorId !== userId`, то есть
 * MANAGER не имел доступа к чужим расчётам. Это делало НЕВОЗМОЖНЫМИ переходы
 * CALC→REVIEW и REVIEW→APPROVED, которые по §4.3 выполняет именно MANAGER:
 * расчёт инженера он открыть не мог. Сценарий приёмки №2 был неисполним.
 */
function canAccessEstimate(role: string | undefined, authorId: string, userId: string | undefined): boolean {
  if (role === 'ADMIN' || role === 'MANAGER') return true
  return authorId === userId
}

const createSchema = z.object({
  title:      z.string().min(1),
  deviceType: z.enum(['KNS', 'EMK', 'KOL']),
  surveyData: z.record(z.string(), z.unknown()).optional().default({}),
})

// GET /api/estimates
estimatesRouter.get('/', async (req, res: Response, next: NextFunction) => {
  try {
    const auth  = req as AuthRequest
    // MANAGER проверяет и утверждает чужие расчёты (§2, §4.3) — значит должен
    // их видеть. Раньше список был ограничен своими для всех, кроме ADMIN.
    const seesAll = auth.userRole === 'ADMIN' || auth.userRole === 'MANAGER'
    const where = seesAll ? {} : { authorId: auth.userId }
    const estimates = await prisma.estimate.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, title: true, deviceType: true, status: true,
        totalRub: true, updatedAt: true, surveyData: true,
        author: { select: { name: true } },
      },
    })
    res.json(estimates)
  } catch (e) { next(e) }
})

// POST /api/estimates
estimatesRouter.post('/', requireRole('ADMIN', 'MANAGER', 'ENGINEER'), validate(createSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const estimate = await prisma.estimate.create({
      data:    { ...req.body, authorId: auth.userId! },
      include: { author: { select: { name: true } } },
    })
    await audit(auth.userId, 'estimate.create', 'Estimate', estimate.id, {
      title: estimate.title,
      deviceType: estimate.deviceType,
    })
    res.status(201).json(estimate)
  } catch (e) { next(e) }
})

// GET /api/estimates/:id
estimatesRouter.get('/:id', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id   = String(req.params.id)
    const estimate = await prisma.estimate.findUnique({
      where: { id },
      include: { snapshots: { orderBy: { version: 'desc' }, take: 1 } },
    })
    if (!estimate) { res.status(404).json({ message: 'Расчёт не найден' }); return }
    if (!canAccessEstimate(auth.userRole, estimate.authorId, auth.userId)) {
      res.status(403).json({ message: 'Нет доступа' }); return
    }
    res.json(estimate)
  } catch (e) { next(e) }
})

// PATCH /api/estimates/:id/status
const statusSchema = z.object({
  status: z.enum(['DRAFT', 'CALC', 'REVIEW', 'APPROVED', 'REJECTED']),
})

estimatesRouter.patch('/:id/status', requireRole('ADMIN', 'MANAGER', 'ENGINEER'), validate(statusSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const auth  = req as AuthRequest
    const id    = String(req.params.id)
    const to    = req.body.status as string

    const estimate = await prisma.estimate.findUnique({ where: { id } })
    if (!estimate) { res.status(404).json({ message: 'Расчёт не найден' }); return }
    if (!canAccessEstimate(auth.userRole, estimate.authorId, auth.userId)) {
      res.status(403).json({ message: 'Нет доступа' }); return
    }

    const from = estimate.status
    const role = auth.userRole!
    const engineerUp = ['ENGINEER', 'MANAGER', 'ADMIN'].includes(role)

    // Согласование в системе отменено (решение 2026-07-20): точка фиксации —
    // выпуск КП (POST /:id/kp, гейт + снапшот), а не статусы. REVIEW/APPROVED
    // остаются в enum только ради старых расчётов — новые переходы в них
    // запрещены.
    if (to === 'REVIEW' || to === 'APPROVED') {
      res.status(422).json({
        message: 'Согласование через статусы отменено: фиксация выполняется выпуском КП',
        code: 'STATUS_FLOW_REMOVED',
      })
      return
    }

    const allowed =
      (from === 'DRAFT' && to === 'CALC' && engineerUp) ||
      (to === 'REJECTED' && role === 'ADMIN')

    if (!allowed) {
      res.status(422).json({ message: `Переход ${from}→${to} недопустим для роли ${role}` }); return
    }

    const updated = await prisma.estimate.update({
      where: { id },
      data: { status: to as 'DRAFT' | 'CALC' | 'REJECTED' },
    })

    await audit(auth.userId, 'estimate.status_change', 'Estimate', id, { from, to })

    res.json(updated)
  } catch (e) { next(e) }
})

function plural(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (dd >= 11 && dd <= 14) return 'строк'
  if (d === 1) return 'строка'
  if (d >= 2 && d <= 4) return 'строки'
  return 'строк'
}

/**
 * Создаёт снапшот расчёта. Версия = MAX(version) + 1 для данного расчёта
 * (ТЗ §7).
 *
 * Версию берём внутри транзакции: параллельные запросы иначе получили бы
 * одинаковый MAX и упали на @@unique([estimateId, version]).
 */
async function createSnapshot(estimateId: string, bundlesJson: unknown, totalRub: number) {
  return prisma.$transaction(async (tx) => {
    const last = await tx.estimateSnapshot.findFirst({
      where: { estimateId },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    const priceList = await tx.priceListVersion.findFirst({ orderBy: { version: 'desc' } })

    return tx.estimateSnapshot.create({
      data: {
        estimateId,
        version: (last?.version ?? 0) + 1,
        priceListVersion: priceList?.version ?? 1,
        totalRub,
        bundlesJson: bundlesJson as never,
      },
    })
  })
}

// DELETE /api/estimates/:id
estimatesRouter.delete('/:id', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id   = String(req.params.id)

    const estimate = await prisma.estimate.findUnique({ where: { id } })
    if (!estimate) { res.status(404).json({ message: 'Расчёт не найден' }); return }
    // Удаление строже чтения: по ТЗ §4.2 — только автор или ADMIN.
    // MANAGER видит и проверяет чужие расчёты, но удалять их не может.
    if (auth.userRole !== 'ADMIN' && estimate.authorId !== auth.userId) {
      res.status(403).json({ message: 'Нет доступа' }); return
    }
    // После отмены согласования (2026-07-20) рабочие статусы — DRAFT и CALC;
    // прежний запрет «только DRAFT/REJECTED» делал расчёт неудаляемым навсегда
    // после первого же сохранения. Защита от потери зафиксированного:
    // APPROVED-расчёты (legacy) по-прежнему неудаляемы.
    if (!['DRAFT', 'CALC', 'REJECTED'].includes(estimate.status)) {
      res.status(422).json({ message: 'Утверждённый расчёт удалить нельзя' }); return
    }

    await prisma.estimate.delete({ where: { id } })
    res.status(204).send()
  } catch (e) { next(e) }
})

// POST /api/estimates/:id/snapshot — ручное версионирование (ТЗ §7).
const snapshotSchema = z.object({
  bundlesJson: z.unknown().optional(),
  totalRub: z.number().optional(),
})

estimatesRouter.post(
  '/:id/snapshot',
  requireRole('ADMIN', 'MANAGER', 'ENGINEER'),
  validate(snapshotSchema),
  async (req, res: Response, next: NextFunction) => {
    try {
      const auth = req as AuthRequest
      const id = String(req.params.id)

      const estimate = await prisma.estimate.findUnique({ where: { id } })
      if (!estimate) { res.status(404).json({ message: 'Расчёт не найден' }); return }
      if (!canAccessEstimate(auth.userRole, estimate.authorId, auth.userId)) {
        res.status(403).json({ message: 'Нет доступа' }); return
      }

      // Тело необязательно: по умолчанию снимаем текущее состояние расчёта.
      const snapshot = await createSnapshot(
        id,
        req.body.bundlesJson ?? estimate.surveyData,
        req.body.totalRub ?? estimate.totalRub ?? 0,
      )

      await audit(auth.userId, 'estimate.snapshot', 'Estimate', id, { version: snapshot.version })
      res.status(201).json(snapshot)
    } catch (e) { next(e) }
  },
)

/**
 * POST /api/estimates/:id/kp — выпуск коммерческого предложения.
 *
 * Точка фиксации реального процесса (ТЗ §4.3 v1.5, Механика §10):
 *
 * ```
 * Предварительный расчёт → КП → согласование в коммерческом отделе (вне системы)
 *    → дальнейшая проработка инженером → сметы/спецификации/ERP
 * ```
 *
 * Здесь, а НЕ при смене статуса:
 *  1. гейт по красным строкам — их сумма равна нулю, то есть такая строка
 *     молча занижает итог; в документ заказчику это попасть не должно;
 *  2. снапшот — фиксирует, из каких цен и какой версии прайса родилась цифра
 *     в согласуемом документе.
 *
 * Расчёт НЕ замораживается: инженер продолжает править его после выпуска КП —
 * это следующий шаг процесса.
 */
estimatesRouter.post(
  '/:id/kp',
  requireRole('ADMIN', 'MANAGER', 'ENGINEER'),
  async (req, res: Response, next: NextFunction) => {
    try {
      const auth = req as AuthRequest
      const id = String(req.params.id)

      const estimate = await prisma.estimate.findUnique({
        where: { id },
        include: { project: { select: { title: true, customer: true, address: true } } },
      })
      if (!estimate) { res.status(404).json({ message: 'Расчёт не найден' }); return }
      if (!canAccessEstimate(auth.userRole, estimate.authorId, auth.userId)) {
        res.status(403).json({ message: 'Нет доступа' }); return
      }

      const unpriced = rowsWithoutPrice(estimate.surveyData)
      if (unpriced.length > 0) {
        res.status(422).json({
          message: `Нельзя выпустить КП: ${unpriced.length} ${plural(unpriced.length)} без цены — итог занижен`,
          code: 'ROWS_WITHOUT_PRICE',
          rows: unpriced.slice(0, 20).map((r) => ({ id: r.id, name: r.name, unit: r.unit })),
          count: unpriced.length,
        })
        return
      }

      const snapshot = await createSnapshot(id, estimate.surveyData, estimate.totalRub ?? 0)

      await audit(auth.userId, 'estimate.kp', 'Estimate', id, { snapshotVersion: snapshot.version })

      res.status(201).json({
        estimate: {
          id: estimate.id,
          title: estimate.title,
          deviceType: estimate.deviceType,
          totalRub: estimate.totalRub,
        },
        project: estimate.project,
        snapshot: {
          version: snapshot.version,
          priceListVersion: snapshot.priceListVersion,
          createdAt: snapshot.createdAt,
        },
      })
    } catch (e) { next(e) }
  },
)

/**
 * GET /api/estimates/:id/kp/export?format=docx|pdf — печатная форма КП.
 *
 * ⚠️ ЗАГЛУШКА. Состав формы не специфицирован: образец КП заказчик предоставит
 * позже (решение 2026-07-16). Ни ТЗ, ни хендофф его не описывают — ТЗ §7
 * говорит про «экспорт в PDF/Excel» и описывает СМЕТУ, а не коммерческое
 * предложение; README хендоффа относит КП к непроработанным экранам.
 *
 * Гадать нельзя: документ уходит заказчику, и по нему идёт согласование
 * (ТЗ §4.3 v1.5).
 *
 * Реализовано и работает уже сейчас — то, что специфицировано однозначно:
 * `POST /api/estimates/:id/kp` (гейт по красным строкам + снапшот).
 *
 * Осталось при получении образца:
 *  - вёрстка документа по образцу;
 *  - генерация docx (напр. пакет `docx`) и PDF — форматы согласованы;
 *  - шрифты с кириллицей для PDF.
 */
estimatesRouter.get('/:id/kp/export', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id = String(req.params.id)
    const format = String(req.query.format ?? 'docx')

    const estimate = await prisma.estimate.findUnique({ where: { id }, select: { authorId: true } })
    if (!estimate) { res.status(404).json({ message: 'Расчёт не найден' }); return }
    if (!canAccessEstimate(auth.userRole, estimate.authorId, auth.userId)) {
      res.status(403).json({ message: 'Нет доступа' }); return
    }
    if (!['docx', 'pdf'].includes(format)) {
      res.status(400).json({ message: 'format должен быть docx или pdf' })
      return
    }

    res.status(501).json({
      message: 'Печатная форма КП не реализована: ожидается образец от заказчика',
      code: 'KP_TEMPLATE_PENDING',
      format,
      note: 'Механика выпуска КП работает: POST /api/estimates/:id/kp — гейт по строкам без цены и снапшот. Не хватает только вёрстки документа.',
      formats: ['docx', 'pdf'],
    })
  } catch (e) { next(e) }
})

// GET /api/estimates/:id/snapshots — история версий (ТЗ §7).
estimatesRouter.get('/:id/snapshots', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id = String(req.params.id)

    const estimate = await prisma.estimate.findUnique({ where: { id }, select: { authorId: true } })
    if (!estimate) { res.status(404).json({ message: 'Расчёт не найден' }); return }
    if (!canAccessEstimate(auth.userRole, estimate.authorId, auth.userId)) {
      res.status(403).json({ message: 'Нет доступа' }); return
    }

    const snapshots = await prisma.estimateSnapshot.findMany({
      where: { estimateId: id },
      orderBy: { version: 'desc' },
      // bundlesJson не отдаём в списке: снимок дерева на 300–450 строк
      // раздул бы ответ. Полное содержимое — отдельным запросом при need.
      select: { id: true, version: true, priceListVersion: true, totalRub: true, createdAt: true },
    })
    res.json(snapshots)
  } catch (e) { next(e) }
})

// PATCH /api/estimates/:id/survey
estimatesRouter.patch('/:id/survey', requireRole('ADMIN', 'MANAGER', 'ENGINEER'), async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id   = String(req.params.id)
    const estimate = await prisma.estimate.findUnique({ where: { id } })
    if (!estimate) { res.status(404).json({ message: 'Расчёт не найден' }); return }
    if (!canAccessEstimate(auth.userRole, estimate.authorId, auth.userId)) {
      res.status(403).json({ message: 'Нет доступа' }); return
    }
    // APPROVED замораживает расчёт: редактирование блокируется, «Новая версия»
    // возвращает в CALC отдельным переходом (Механика §10, README хендоффа).
    // Раньше здесь безусловно писался status:'CALC' — это давало обход таблицы
    // переходов §4.3 и правку утверждённого расчёта в обход снапшота.
    if (estimate.status === 'APPROVED') {
      res.status(422).json({
        message: 'Расчёт утверждён и заморожен. Верните его в расчёт («Новая версия»), чтобы редактировать',
        code: 'ESTIMATE_FROZEN',
      })
      return
    }
    if (estimate.status === 'REJECTED') {
      res.status(422).json({ message: 'Отклонённый расчёт редактировать нельзя', code: 'ESTIMATE_REJECTED' })
      return
    }

    const merged = { ...(estimate.surveyData as object ?? {}), ...req.body }

    // Итог расчёта дублируется в колонку totalRub: карточки проекта и
    // снапшоты читают её, а не разбирают JSON дерева. Раньше колонка не
    // обновлялась никогда — суммы в списках всегда были пустыми.
    const salePrice = (req.body?.totals as { salePriceRub?: unknown } | undefined)?.salePriceRub
    const totalRub = typeof salePrice === 'number' && Number.isFinite(salePrice) ? salePrice : undefined

    const updated = await prisma.estimate.update({
      where: { id },
      data: {
        surveyData: merged,
        ...(totalRub != null ? { totalRub } : {}),
        // DRAFT → CALC при первом сохранении — легальный переход (§4.3);
        // из REVIEW статус не трогаем, иначе правка молча откатывала бы
        // расчёт с проверки.
        ...(estimate.status === 'DRAFT' ? { status: 'CALC' as const } : {}),
      },
    })
    res.json(updated)
  } catch (e) { next(e) }
})
