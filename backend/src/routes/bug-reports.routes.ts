import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { requireAuth, requireAuthForPasswordChange, type AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { audit } from '../utils/audit'
import { logger } from '../utils/logger'
import { prisma } from '../utils/prisma'
import { createLimiter, retryText } from '../utils/rate-limit'
import {
  BUG_REPORT_STATUSES,
  BUGREPORT_DIR,
  BugReportError,
  deleteBugReport,
  isValidReportId,
  isValidScreenshotName,
  listBugReports,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOTS,
  readBugReport,
  saveBugReport,
  screenshotMime,
  screenshotPath,
  screenshotStream,
  updateBugReport,
} from '../utils/bug-reports'

/**
 * Отчёты об ошибках (`/api/bug-reports`).
 *
 * Отправить может любой вошедший сотрудник — и тот, кого сервер держит на
 * смене пароля: застрять можно и там. Читают, меняют статус и удаляют только
 * администраторы. Хранилище — каталог на диске (`utils/bug-reports.ts`).
 */
export const bugReportsRouter = Router()

/**
 * Скриншоты — в память, а не на диск: их сначала проверяют по сигнатуре, и
 * лишь принятые пишутся в папку отчёта. Пять файлов по 4 МБ — предел в
 * памяти на запрос.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SCREENSHOT_BYTES, files: MAX_SCREENSHOTS, fields: 10, fieldSize: 64 * 1024 },
})

/** Отказ multer — внятным ответом, а не 500 от общего обработчика. */
function acceptScreenshots(req: Request, res: Response, next: NextFunction) {
  upload.array('screenshots', MAX_SCREENSHOTS)(req, res, (err: unknown) => {
    if (!err) { next(); return }
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? 'Скриншот больше 4 МБ — уменьшите его или обрежьте'
          : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `Скриншотов не больше ${MAX_SCREENSHOTS}`
            : err.code === 'LIMIT_FIELD_VALUE' ? 'Текст отчёта слишком длинный'
              : `Отчёт не принят: ${err.message}`
      res.status(422).json({ message, code: err.code })
      return
    }
    next(err)
  })
}

/**
 * Не больше двадцати отчётов в час от сотрудника: каталог на диске, и поток
 * отправок — случайный или нет — не должен его заполнить. Считаются принятые
 * отчёты; исчерпан лимит — запрос отклоняется до приёма файлов.
 */
const reportsByUser = createLimiter({ windowMs: 60 * 60 * 1000, max: 20 })

function limitReports(req: Request, res: Response, next: NextFunction) {
  const state = reportsByUser.blocked((req as AuthRequest).userId!)
  if (state.allowed) { next(); return }
  res.setHeader('Retry-After', String(state.retryAfterS))
  res.status(429).json({
    message: `Слишком много отчётов подряд — следующий можно отправить ${retryText(state.retryAfterS)}`,
    code: 'TOO_MANY_REQUESTS',
  })
}

const newReportSchema = z.object({
  text: z.string(),
  pageUrl: z.string().optional(),
  pageTitle: z.string().optional(),
  viewport: z.string().optional(),
  appBuild: z.string().optional(),
})

/**
 * POST /api/bug-reports — отправить отчёт.
 *
 * multipart: `text` (обязательно), `pageUrl`, `pageTitle`, `viewport`,
 * `appBuild` и до пяти файлов `screenshots`. Ответ — номер отчёта.
 */
bugReportsRouter.post('/', requireAuthForPasswordChange, limitReports, acceptScreenshots, async (req, res, next) => {
  try {
    const userId = (req as AuthRequest).userId!
    const parsed = newReportSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ message: 'Ошибка валидации', errors: parsed.error.flatten() })
      return
    }
    const body = parsed.data
    const files = ((req as { files?: Express.Multer.File[] }).files ?? []).map((f) => ({
      buffer: f.buffer,
      // multer отдаёт имя в latin1: кириллица в имени файла иначе превращается в «Ð¡Ð½Ð¸Ð¼Ð¾Ðº».
      originalName: Buffer.from(f.originalname, 'latin1').toString('utf8'),
    }))

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true },
    })
    const report = await saveBugReport(BUGREPORT_DIR, {
      text: body.text,
      pageUrl: body.pageUrl,
      pageTitle: body.pageTitle,
      viewport: body.viewport,
      appBuild: body.appBuild,
      userAgent: req.get('user-agent') ?? null,
      author: user,
      files,
    })
    reportsByUser.hit(userId)
    await audit(userId, 'bugreport.create', 'BugReport', report.id, {
      page: report.page.url,
      screenshots: report.screenshots.length,
    })
    logger.info('Принят отчёт об ошибке', { id: report.id, userId, screenshots: report.screenshots.length })
    res.status(201).json({ id: report.id, createdAt: report.createdAt })
  } catch (e) {
    if (e instanceof BugReportError) { res.status(422).json({ message: e.message, code: e.code }); return }
    next(e)
  }
})

// ── Дальше — только администраторы ─────────────────────────────────────────

const admin = [requireAuth, requireRole('ADMIN')]

/** GET /api/bug-reports — список, свежие первыми, и сколько новых. */
bugReportsRouter.get('/', ...admin, async (_req, res, next) => {
  try {
    const items = await listBugReports(BUGREPORT_DIR)
    res.json({ items, newCount: items.filter((r) => r.status === 'new').length })
  } catch (e) { next(e) }
})

/** GET /api/bug-reports/:id — отчёт целиком. */
bugReportsRouter.get('/:id', ...admin, async (req, res, next) => {
  try {
    const report = await readBugReport(BUGREPORT_DIR, String(req.params.id))
    if (!report) { res.status(404).json({ message: 'Отчёт не найден' }); return }
    res.json(report)
  } catch (e) { next(e) }
})

/**
 * GET /api/bug-reports/:id/files/:name — скриншот.
 *
 * Отдаётся картинкой своего типа и не угадывается браузером (`nosniff`), а
 * `sandbox` не даст файлу, открытому отдельной вкладкой, выполнить что-либо.
 */
bugReportsRouter.get('/:id/files/:name', ...admin, async (req, res, next) => {
  try {
    const id = String(req.params.id)
    const name = String(req.params.name)
    if (!isValidReportId(id) || !isValidScreenshotName(name)) {
      res.status(400).json({ message: 'Недопустимое имя файла' })
      return
    }
    if (!(await stat(screenshotPath(BUGREPORT_DIR, id, name)).catch(() => null))) {
      res.status(404).json({ message: 'Файл не найден' })
      return
    }
    res.setHeader('Content-Type', screenshotMime(name))
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.setHeader('Content-Disposition', `inline; filename="${id}-${name}"`)
    // pipeline, а не pipe: ошибка чтения не должна остаться без обработчика.
    await pipeline(screenshotStream(BUGREPORT_DIR, id, name), res).catch((e: unknown) => {
      logger.warn('Выдача скриншота прервана', { id, name, error: e instanceof Error ? e.message : String(e) })
      res.destroy()
    })
  } catch (e) { next(e) }
})

const patchSchema = z
  .object({
    status: z.enum(BUG_REPORT_STATUSES).optional(),
    adminNote: z.string().max(2000).nullable().optional(),
  })
  .refine((p) => p.status !== undefined || p.adminNote !== undefined, { message: 'Нечего менять' })

/** PATCH /api/bug-reports/:id — статус и пометка администратора. */
bugReportsRouter.patch('/:id', ...admin, validate(patchSchema), async (req, res, next) => {
  try {
    const auth = req as AuthRequest
    const id = String(req.params.id)
    const patch = req.body as z.infer<typeof patchSchema>
    const before = await readBugReport(BUGREPORT_DIR, id)
    if (!before) { res.status(404).json({ message: 'Отчёт не найден' }); return }

    const report = await updateBugReport(BUGREPORT_DIR, id, patch)
    if (!report) { res.status(404).json({ message: 'Отчёт не найден' }); return }
    await audit(auth.userId, 'bugreport.update', 'BugReport', id, {
      ...(patch.status && patch.status !== before.status ? { from: before.status, to: patch.status } : {}),
      ...(patch.adminNote !== undefined ? { note: report.adminNote } : {}),
    })
    res.json(report)
  } catch (e) { next(e) }
})

/** DELETE /api/bug-reports/:id — удалить вместе со скриншотами. */
bugReportsRouter.delete('/:id', ...admin, async (req, res, next) => {
  try {
    const auth = req as AuthRequest
    const id = String(req.params.id)
    if (!(await deleteBugReport(BUGREPORT_DIR, id))) { res.status(404).json({ message: 'Отчёт не найден' }); return }
    await audit(auth.userId, 'bugreport.delete', 'BugReport', id, {})
    res.status(204).send()
  } catch (e) { next(e) }
})
