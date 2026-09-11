import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { audit } from '../utils/audit'
import { isStaleTreeWrite, SURVEY_CHANGED } from '../utils/survey-write'
import { logger } from '../utils/logger'
import {
  RATE_LABELS,
  rowsWithoutPrice,
  treeBuiltinRevision,
  treePriceListVersion,
  treeRateFallbacks,
  treeTemplateVersion,
} from '../utils/estimate-tree'
import { buildKpDocument, KpSpecificationIncomplete } from '../utils/kp-document'
import { renderKpDocx } from '../utils/kp-docx'
import { renderKpPdf } from '../utils/kp-pdf'
import { blocksDeletion, isPrintable, PRINTABLE_REASONS, REASON_LABEL } from '../utils/snapshot-reason'
import type { SnapshotReason } from '@prisma/client'

/** Причины слепков, при которых расчёт нельзя удалить (см. blocksDeletion). */
const DELETION_BLOCKING_REASONS = (['CREATE', 'MANUAL', 'KP'] as SnapshotReason[]).filter(blocksDeletion)
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

/**
 * Чтение шире записи: VIEWER — наблюдатель (ТЗ §2), видит расчёты и их
 * версии, но не меняет ничего. Роль нужна вкладке «Расчёт» в Битрикс24:
 * менеджер сделки открывает расчёт на просмотр.
 */
function canReadEstimate(role: string | undefined, authorId: string, userId: string | undefined): boolean {
  if (role === 'VIEWER') return true
  return canAccessEstimate(role, authorId, userId)
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
    // MANAGER проверяет чужие расчёты (§2), VIEWER — наблюдатель: оба видят
    // весь список. Раньше список был ограничен своими для всех, кроме ADMIN.
    const seesAll = ['ADMIN', 'MANAGER', 'VIEWER'].includes(auth.userRole ?? '')
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
    if (!canReadEstimate(auth.userRole, estimate.authorId, auth.userId)) {
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
/** Сколько раз повторить снятие снапшота при гонке за номер версии. */
const SNAPSHOT_RETRIES = 3

/**
 * Снять снапшот расчёта, присвоив ему следующий номер версии.
 *
 * Транзакция сама по себе гонку НЕ снимает: у PostgreSQL по умолчанию уровень
 * READ COMMITTED, поэтому два параллельных выпуска КП прочитают один и тот же
 * `MAX(version)`, оба возьмут `+1` и второй нарушит `@@unique([estimateId,
 * version])` — наружу это уходило как 500 «Внутренняя ошибка сервера».
 *
 * Лечится повтором: уникальный индекс — тот самый арбитр, который решает спор,
 * и проигравшему достаточно перечитать максимум. Повторов немного: конкуренция
 * здесь — две вкладки одного инженера, а не нагрузка.
 */
async function createSnapshot(estimateId: string, bundlesJson: unknown, totalRub: number, reason: SnapshotReason) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const last = await tx.estimateSnapshot.findFirst({
          where: { estimateId },
          orderBy: { version: 'desc' },
          select: { version: true },
        })
        // Версия — та, по которой посчитаны цены дерева, а не действующая:
        // расчёт мог остаться на прежнем прайсе (treePriceListVersion).
        const priceList = await tx.priceListVersion.findFirst({ orderBy: { version: 'desc' } })

        return tx.estimateSnapshot.create({
          data: {
            estimateId,
            version: (last?.version ?? 0) + 1,
            priceListVersion: treePriceListVersion(bundlesJson) ?? priceList?.version ?? 1,
            // Каким составом собрано дерево: встроенный шаблон (0) или
            // опубликованная технологом версия. null — дерево без отметки.
            templateVersion: treeTemplateVersion(bundlesJson),
            // Каким кодом: редакция встроенных узлов на момент сборки дерева.
            builtinRevision: treeBuiltinRevision(bundlesJson),
            totalRub,
            bundlesJson: bundlesJson as never,
            reason,
          },
        })
      })
    } catch (e) {
      // P2002 — нарушение уникального ограничения: номер версии успели занять.
      const isRace = (e as { code?: string }).code === 'P2002'
      if (!isRace || attempt >= SNAPSHOT_RETRIES) throw e
      logger.warn('Гонка за номер версии снапшота, повтор', { estimateId, attempt })
    }
  }
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
    // Снапшот — точка фиксации: он снимается при выпуске КП и хранит, из каких
    // цен родилась цифра в документе, ушедшем заказчику (Механика §10).
    // Статус после выпуска КП остаётся рабочим (CALC), поэтому проверки статуса
    // выше недостаточно, а EstimateSnapshot.estimateId — onDelete: Cascade:
    // удаление расчёта молча стирало историю выпущенных КП.
    // Слепок создания единицы удалению не мешает: он снят автоматически и
    // цену заказчику не подтверждает (utils/snapshot-reason.ts).
    const snapshotCount = await prisma.estimateSnapshot.count({
      where: { estimateId: id, reason: { in: DELETION_BLOCKING_REASONS } },
    })
    if (snapshotCount > 0) {
      res.status(422).json({
        message:
          `Расчёт удалить нельзя: по нему зафиксировано версий — ${snapshotCount} ` +
          '(выпуск КП или ручная фиксация). Снапшоты подтверждают цену, ушедшую заказчику.',
        code: 'ESTIMATE_HAS_SNAPSHOTS',
        snapshotCount,
      })
      return
    }

    await prisma.estimate.delete({ where: { id } })
    res.status(204).send()
  } catch (e) { next(e) }
})

// POST /api/estimates/:id/snapshot — ручное версионирование (ТЗ §7).
const snapshotSchema = z.object({
  bundlesJson: z.unknown().optional(),
  totalRub: z.number().optional(),
  /**
   * CREATE — слепок при создании единицы изделия (снимает ОЛ сразу после
   * первой сборки расчёта), MANUAL — ручная фиксация из окна «Версии».
   * KP сюда не принимается: слепок КП снимается только через POST /:id/kp,
   * после проверки строк без цены.
   */
  reason: z.enum(['CREATE', 'MANUAL']).optional().default('MANUAL'),
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

      const reason = req.body.reason as SnapshotReason
      // Слепок создания — один на единицу: повтор (двойной клик, повторная
      // отправка формы) не должен плодить «исходных состояний».
      if (reason === 'CREATE') {
        const existing = await prisma.estimateSnapshot.findFirst({ where: { estimateId: id, reason: 'CREATE' } })
        if (existing) { res.status(200).json(existing); return }
      }

      // Тело необязательно: по умолчанию снимаем текущее состояние расчёта.
      const snapshot = await createSnapshot(
        id,
        req.body.bundlesJson ?? estimate.surveyData,
        req.body.totalRub ?? estimate.totalRub ?? 0,
        reason,
      )

      await audit(auth.userId, 'estimate.snapshot', 'Estimate', id, { version: snapshot.version, reason })
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
 *     молча занижает итог; в документ заказчику это попасть не должно; и по
 *     ставкам экономики, взятым константами программы, — 422
 *     RATES_NOT_IN_PRICE (решение Р5);
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

      // Ставки экономики не из прайса — итог посчитан по константам
      // программы, а не по ценам завода (решение Р5, План_устранения 1.3).
      const fallbackRates = treeRateFallbacks(estimate.surveyData)
      if (fallbackRates.length > 0) {
        const names = fallbackRates.map((k) => `«${RATE_LABELS[k]}»`).join(', ')
        res.status(422).json({
          message:
            `Нельзя выпустить КП: ${fallbackRates.length > 1 ? 'ставок' : 'ставки'} ${names} нет в прайсе — ` +
            'расчёт посчитан по константам программы. Добавьте позиции в прайс и пересчитайте расчёт по нему.',
          code: 'RATES_NOT_IN_PRICE',
          rates: fallbackRates,
        })
        return
      }

      const snapshot = await createSnapshot(id, estimate.surveyData, estimate.totalRub ?? 0, 'KP')

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
 * Документ строится ИЗ СНАПШОТА, а не из текущего состояния расчёта: после
 * выпуска КП расчёт не замораживается и продолжает правиться (Механика §10),
 * поэтому печатная форма обязана воспроизводить согласованную редакцию.
 * По умолчанию берётся последний печатный снапшот — выпуск КП или ручная
 * фиксация (`utils/snapshot-reason.ts`); `?version=N` печатает конкретную
 * редакцию из истории.
 *
 * 422 KP_NOT_ISSUED, если печатных снапшотов нет: печатать нечего — сначала
 * `POST /api/estimates/:id/kp` (гейт по строкам без цены + снапшот).
 * 422 KP_NOT_PRINTABLE, если `?version=N` указывает на слепок создания
 * единицы: проверку строк без цены он не проходил.
 *
 * ⚠️ Вёрстка временная: образец заказчика («КПВ6393», получен 09.09.2026)
 * подтвердил НДС «в том числе», но узловая разбивка с ценами, условия и
 * реквизиты ещё не перенесены. Два неочевидных решения — цены не построчно и
 * НДС «в том числе», а не сверху — объяснены в `utils/kp-document.ts`.
 * Замена вёрстки затрагивает только `kp-docx.ts` и `kp-pdf.ts`.
 */
estimatesRouter.get('/:id/kp/export', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id = String(req.params.id)
    const format = String(req.query.format ?? 'docx')

    if (!['docx', 'pdf'].includes(format)) {
      res.status(400).json({ message: 'format должен быть docx или pdf' })
      return
    }
    const versionRaw = req.query.version
    let version: number | undefined
    if (versionRaw != null && String(versionRaw) !== '') {
      version = Number(versionRaw)
      if (!Number.isInteger(version) || version < 1) {
        res.status(400).json({ message: 'version должен быть целым числом ≥ 1' })
        return
      }
    }

    const estimate = await prisma.estimate.findUnique({
      where: { id },
      include: { project: { select: { title: true, customer: true, address: true } } },
    })
    if (!estimate) { res.status(404).json({ message: 'Расчёт не найден' }); return }
    // Чтение КП шире правки: наблюдатель тоже должен уметь открыть документ.
    if (!canReadEstimate(auth.userRole, estimate.authorId, auth.userId)) {
      res.status(403).json({ message: 'Нет доступа' }); return
    }

    // Без версии — последний ПЕЧАТНЫЙ слепок: слепок создания проверку строк
    // без цены не проходил, и КП по нему занизил бы итог.
    const snapshot = await prisma.estimateSnapshot.findFirst({
      where: { estimateId: id, ...(version != null ? { version } : { reason: { in: [...PRINTABLE_REASONS] } }) },
      orderBy: { version: 'desc' },
    })
    if (snapshot && !isPrintable(snapshot.reason)) {
      res.status(422).json({
        message:
          `Редакция ${snapshot.version} — ${REASON_LABEL[snapshot.reason]}: это исходное состояние расчёта, ` +
          'КП по нему не печатается. Выпустите КП — он проверит строки без цены и снимет свою редакцию.',
        code: 'KP_NOT_PRINTABLE',
      })
      return
    }
    if (!snapshot) {
      res.status(422).json({
        message:
          version != null
            ? `Редакция ${version} не найдена в истории расчёта`
            : 'КП по этому расчёту ещё не выпускалось — печатать нечего',
        code: 'KP_NOT_ISSUED',
        note: 'Сначала POST /api/estimates/:id/kp — он проверяет строки без цены и снимает снапшот.',
      })
      return
    }

    let doc
    try {
      doc = buildKpDocument({
        estimateId: estimate.id,
        estimateTitle: estimate.title,
        deviceType: estimate.deviceType,
        project: estimate.project,
        snapshot: {
          version: snapshot.version,
          priceListVersion: snapshot.priceListVersion,
          totalRub: snapshot.totalRub,
          createdAt: snapshot.createdAt,
          bundlesJson: snapshot.bundlesJson,
        },
      })
    } catch (e) {
      // Спецификацию не собрать точно — печатать нельзя (см. kp-document.ts).
      // Лечится пересохранением расчёта: фронт проставит вычисленные
      // количества, после чего нужен новый выпуск КП.
      if (e instanceof KpSpecificationIncomplete) {
        res.status(422).json({
          message:
            `Печать невозможна: ${e.rows.length} ${plural(e.rows.length)} задаёт количество выражением, ` +
            'а в этой редакции не сохранён его результат. Откройте расчёт, сохраните и выпустите КП заново.',
          code: 'KP_SPEC_INCOMPLETE',
          rows: e.rows.slice(0, 20),
          count: e.rows.length,
        })
        return
      }
      throw e
    }

    const body = format === 'pdf' ? await renderKpPdf(doc) : await renderKpDocx(doc)
    const filename = `${doc.number}.${format}`

    await audit(auth.userId, 'estimate.kp.export', 'Estimate', id, {
      format,
      snapshotVersion: snapshot.version,
      positions: doc.positionsCount,
    })

    res.setHeader(
      'Content-Type',
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    // filename* с UTF-8: номер КП содержит кириллицу («КП-…»).
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    res.setHeader('Content-Length', String(body.length))
    res.end(body)
  } catch (e) { next(e) }
})

// GET /api/estimates/:id/snapshots — история версий (ТЗ §7).
estimatesRouter.get('/:id/snapshots', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id = String(req.params.id)

    const estimate = await prisma.estimate.findUnique({ where: { id }, select: { authorId: true } })
    if (!estimate) { res.status(404).json({ message: 'Расчёт не найден' }); return }
    if (!canReadEstimate(auth.userRole, estimate.authorId, auth.userId)) {
      res.status(403).json({ message: 'Нет доступа' }); return
    }

    const snapshots = await prisma.estimateSnapshot.findMany({
      where: { estimateId: id },
      orderBy: { version: 'desc' },
      // bundlesJson не отдаём в списке: снимок дерева на 300–450 строк
      // раздул бы ответ. Полное содержимое — отдельным запросом при need.
      select: {
        id: true, version: true, priceListVersion: true, templateVersion: true, builtinRevision: true,
        totalRub: true, createdAt: true, reason: true,
      },
    })
    res.json(snapshots)
  } catch (e) { next(e) }
})

/**
 * Тело PATCH /:id/survey.
 *
 * Маршрут — единственный пишущий вход в расчёт, и его тело мержится в
 * `surveyData` целиком, а `totals.salePriceRub` уходит в колонку `totalRub`,
 * по которой считают карточки проекта и снапшоты. Без схемы сюда проходило
 * что угодно: строка вместо суммы, NaN, подменённая структура дерева.
 *
 * Схема намеренно НЕ строгая по составу: тело шлют четыре разных источника —
 * стор калькулятора (`stores/calcTree.ts`, save) и три экрана опросного листа
 * (`views/Survey*View.vue`, surveyPayload), у каждого свой набор полей ОЛ.
 * Поэтому неизвестные ключи проходят (passthrough), а типизированы те, от
 * которых зависят деньги и материализация.
 */
const surveyPatchSchema = z
  .object({
    /** Дерево расчёта целиком (CalcTree). Структуру валидирует движок. */
    tree: z.object({}).passthrough().optional(),
    /** Ревизия ОЛ, из которой построено дерево, — гейт рематериализации. */
    treeSurveyRev: z.number().int().min(0).optional(),
    /** Ревизия ОЛ. Растёт при каждом сохранении опросного листа. */
    surveyRev: z.number().int().min(0).optional(),
    totals: z
      .object({
        costRub: z.number().finite().min(0).optional(),
        // Именно это значение попадает в Estimate.totalRub.
        salePriceRub: z.number().finite().min(0).optional(),
        markup: z.number().finite().min(0).max(100).optional(),
        tirage: z.number().int().min(1).max(1000).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

// PATCH /api/estimates/:id/survey
estimatesRouter.patch('/:id/survey', requireRole('ADMIN', 'MANAGER', 'ENGINEER'), validate(surveyPatchSchema), async (req, res: Response, next: NextFunction) => {
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

    // Дерево из старой ревизии ОЛ (расчёт открыт в другой вкладке, ОЛ за это
    // время поправили) не записываем: оно откатило бы и дерево, и цены ОЛ.
    if (isStaleTreeWrite(estimate.surveyData, req.body as Record<string, unknown>)) {
      res.status(409).json({
        message: 'Опросный лист изменился после того, как был открыт расчёт. Сохранение отменено — расчёт нужно перечитать',
        code: SURVEY_CHANGED,
      })
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
