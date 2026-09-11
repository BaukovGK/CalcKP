import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../utils/prisma'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { audit } from '../utils/audit'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import { stat, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { logger } from '../utils/logger'
import { MIN_PASSWORD_LENGTH, temporaryPassword } from '../utils/password'
import {
  acceptUpload, BACKUP_DIR, createDump, deleteDump, dumpPath, dumpStream, DumpError,
  isValidDumpName, listDumps, MAX_DUMP_BYTES, restoreDump,
} from '../utils/db-dump'
import type { Response, NextFunction } from 'express'

/**
 * Роли (ТЗ §2) — один список на оба маршрута.
 *
 * Раньше перечень дублировался в двух zod-схемах, и при добавлении TECHNOLOG
 * в enum БД они разошлись: назначить новую роль было невозможно.
 */
const ROLES = ['ADMIN', 'MANAGER', 'ENGINEER', 'TECHNOLOG', 'BUYER', 'VIEWER'] as const

export const adminRouter = Router()
adminRouter.use('/', requireAuth)
adminRouter.use('/', requireRole('ADMIN'))

// GET /api/admin/users
adminRouter.get('/users', async (_req, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, isActive: true, mustChangePassword: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json(users)
  } catch (e) { next(e) }
})

const createUserSchema = z.object({
  email:    z.string().email(),
  name:     z.string().min(1),
  role:     z.enum(ROLES),
  password: z.string().min(MIN_PASSWORD_LENGTH),
})

// POST /api/admin/users
adminRouter.post('/users', validate(createUserSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const { email, name, role, password } = req.body
    // Повтор email — 409 с понятным текстом, а не 500 от уникального индекса
    // (План_устранения 2.5). Гонку двух одновременных созданий ловит errorHandler.
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      res.status(409).json({ message: `Пользователь с email ${email} уже есть`, code: 'EMAIL_TAKEN' })
      return
    }
    const passwordHash = await bcrypt.hash(password, 10)
    // Пароль задал администратор — пользователь сменит его при первом входе
    // (План_устранения 2.1).
    const user = await prisma.user.create({
      data: { email, name, role, passwordHash, mustChangePassword: true },
      select: { id: true, email: true, name: true, role: true, isActive: true, mustChangePassword: true, createdAt: true },
    })
    await audit((req as AuthRequest).userId, 'user.create', 'User', user.id, {
      email: user.email,
      role: user.role,
    })
    res.status(201).json(user)
  } catch (e) { next(e) }
})

const patchUserSchema = z.object({
  name:     z.string().min(1).optional(),
  role:     z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
})

/**
 * PATCH /api/admin/users/:id (ADMIN).
 *
 * Две защиты от необратимого состояния: без администратора управлять
 * пользователями — назначать роли, сбрасывать пароли — некому.
 *  1. нельзя снять роль или деактивировать ПОСЛЕДНЕГО активного ADMIN;
 *  2. нельзя понизить или деактивировать самого себя — даже если админов
 *     несколько: это делается чужими руками и осознанно.
 */
adminRouter.patch('/users/:id', validate(patchUserSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id   = String(req.params.id)
    // Тип из самой схемы: role здесь — union литералов ролей, а не string,
    // иначе Prisma не примет его как enum Role.
    const patch = req.body as z.infer<typeof patchUserSchema>

    // Без явной проверки обновление несуществующего id давало P2025 и 500.
    const current = await prisma.user.findUnique({ where: { id }, select: { role: true, isActive: true } })
    if (!current) { res.status(404).json({ message: 'Пользователь не найден' }); return }

    const losesAdmin =
      current.role === 'ADMIN' &&
      ((patch.role != null && patch.role !== 'ADMIN') || patch.isActive === false)

    if (losesAdmin && id === auth.userId) {
      res.status(422).json({
        message: 'Нельзя снять права администратора с самого себя — попросите другого администратора',
        code: 'SELF_DEMOTION',
      })
      return
    }

    if (losesAdmin && current.isActive) {
      const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } })
      if (activeAdmins <= 1) {
        res.status(422).json({
          message:
            'Это последний активный администратор: без него назначать роли и сбрасывать пароли будет некому. ' +
            'Сначала назначьте другого администратора.',
          code: 'LAST_ADMIN',
        })
        return
      }
    }

    // Блокировка отзывает токены: иначе после разблокировки старые сессии
    // ожили бы снова (План_устранения 2.3).
    const revoke = patch.isActive === false && current.isActive
    const user = await prisma.user.update({
      where: { id },
      data:  revoke ? { ...patch, tokenVersion: { increment: 1 } } : patch,
      select: { id: true, email: true, name: true, role: true, isActive: true, mustChangePassword: true, createdAt: true },
    })
    await audit(auth.userId, 'user.update', 'User', id, patch)
    res.json(user)
  } catch (e) { next(e) }
})

/**
 * POST /api/admin/users/:id/password-reset (ADMIN) — сброс пароля
 * пользователю (План_устранения 2.1).
 *
 * Сервер выдаёт случайный временный пароль и возвращает его ОДИН раз —
 * администратор передаёт его пользователю; при входе тот обязан сменить
 * пароль. В аудит пароль не пишется. Свой пароль так не сбрасывают — для
 * этого «Сменить пароль»: иначе это обход проверки текущего пароля.
 */
adminRouter.post('/users/:id/password-reset', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id = String(req.params.id)
    if (id === auth.userId) {
      res.status(422).json({ message: 'Свой пароль меняют кнопкой «Сменить пароль»', code: 'SELF_RESET' })
      return
    }
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } })
    if (!user) { res.status(404).json({ message: 'Пользователь не найден' }); return }

    const password = temporaryPassword()
    await prisma.user.update({
      where: { id },
      // Сессии пользователя отзываются: старым паролем уже не войти, а
      // выданные токены не должны его пережить (План_устранения 2.3).
      data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true, tokenVersion: { increment: 1 } },
    })
    await audit(auth.userId, 'user.password_reset', 'User', id, { email: user.email })

    // Пароль — в ответе один раз; ни прокси, ни браузер его не кешируют.
    res.setHeader('Cache-Control', 'no-store')
    res.json({ temporaryPassword: password })
  } catch (e) { next(e) }
})

// ── Дампы базы ─────────────────────────────────────────────────────────────
//
// Те же файлы и тот же каталог, что у скриптов `backend/scripts/` и у дампа,
// который снимается перед миграциями: админка не заводит свой параллельный
// механизм, а даёт доступ к общему.
//
// Восстановление загруженного файла — самая опасная операция во всём
// приложении: pg_restore выполняет SQL из архива, а пользователь БД в образе
// postgres суперпользователь. Поэтому загрузка и восстановление разнесены,
// а архив перед применением проверяется (см. utils/db-dump.ts).

const dumpUpload = multer({
  // На диск, а не в память: дамп боевой базы может быть в сотни мегабайт.
  //
  // Пишем сразу в каталог дампов, а не в /tmp: это разные устройства (каталог —
  // bind-mount), и перенос между ними падал бы с EXDEV, а копирование сотен
  // мегабайт ради переноса — лишняя работа. Временное имя не проходит фильтр
  // `isValidDumpName`, поэтому в списке дампов такой файл не появится, а при
  // отказе он удаляется.
  storage: multer.diskStorage({
    destination: BACKUP_DIR,
    filename: (_req, _file, cb) => cb(null, `.upload-${randomUUID()}.tmp`),
  }),
  limits: { fileSize: MAX_DUMP_BYTES, files: 1 },
})

// GET /api/admin/backups — список дампов
adminRouter.get('/backups', async (_req, res: Response, next: NextFunction) => {
  try {
    res.json(await listDumps())
  } catch (e) { next(e) }
})

// POST /api/admin/backups — снять дамп сейчас
adminRouter.post('/backups', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const info = await createDump('manual')
    await audit(auth.userId, 'db.backup', 'Database', info.name, { sizeBytes: info.sizeBytes })
    res.status(201).json(info)
  } catch (e) { next(e) }
})

// GET /api/admin/backups/:name — скачать дамп
adminRouter.get('/backups/:name', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const name = String(req.params.name)
    if (!isValidDumpName(name)) { res.status(400).json({ message: 'Недопустимое имя файла' }); return }

    const file = dumpPath(name)
    if (!(await stat(file).catch(() => null))) { res.status(404).json({ message: 'Дамп не найден' }); return }

    // Выгрузка дампа — вынос всей базы наружу, включая хеши паролей и цены.
    // Она разрешена только ADMIN, но след обязателен.
    await audit(auth.userId, 'db.backup.download', 'Database', name, {})

    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
    // pipeline, а не pipe: у pipe ошибка чтения (файл удалили между проверкой
    // и чтением, сбой диска) остаётся без обработчика и роняет весь процесс.
    // Заголовки уже ушли — ответить JSON нельзя, соединение закрывается.
    await pipeline(dumpStream(name), res).catch((e: unknown) => {
      logger.warn('Выгрузка дампа прервана', { name, error: e instanceof Error ? e.message : String(e) })
      res.destroy()
    })
  } catch (e) { next(e) }
})

// DELETE /api/admin/backups/:name
adminRouter.delete('/backups/:name', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const name = String(req.params.name)
    if (!isValidDumpName(name)) { res.status(400).json({ message: 'Недопустимое имя файла' }); return }
    if (!(await stat(dumpPath(name)).catch(() => null))) { res.status(404).json({ message: 'Дамп не найден' }); return }

    await deleteDump(name)
    await audit(auth.userId, 'db.backup.delete', 'Database', name, {})
    res.status(204).send()
  } catch (e) { next(e) }
})

// POST /api/admin/backups/upload — загрузить дамп в каталог (без применения)
adminRouter.post('/backups/upload', dumpUpload.single('file'), async (req, res: Response, next: NextFunction) => {
  const file = (req as { file?: { path: string } }).file
  try {
    const auth = req as AuthRequest
    if (!file) { res.status(400).json({ message: 'Файл не передан (поле file)' }); return }

    const info = await acceptUpload(file.path)
    await audit(auth.userId, 'db.backup.upload', 'Database', info.name, { sizeBytes: info.sizeBytes })
    res.status(201).json(info)
  } catch (e) {
    if (file) await unlink(file.path).catch(() => {})
    if (e instanceof DumpError) { res.status(422).json({ message: e.message, code: e.code }); return }
    next(e)
  }
})

/**
 * POST /api/admin/backups/:name/restore — заменить базу содержимым дампа.
 *
 * Требует `{ confirm: "<имя файла>" }`: администратор должен явно повторить
 * имя того, что применяет. Случайный клик по кнопке базу не заменит.
 */
const restoreSchema = z.object({ confirm: z.string().min(1) })

adminRouter.post('/backups/:name/restore', validate(restoreSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const name = String(req.params.name)
    if (!isValidDumpName(name)) { res.status(400).json({ message: 'Недопустимое имя файла' }); return }
    if ((req.body as z.infer<typeof restoreSchema>).confirm !== name) {
      res.status(422).json({ message: 'Подтверждение не совпадает с именем дампа', code: 'CONFIRM_MISMATCH' })
      return
    }
    if (!(await stat(dumpPath(name)).catch(() => null))) { res.status(404).json({ message: 'Дамп не найден' }); return }

    const { safetyDump } = await restoreDump(name)
    await audit(auth.userId, 'db.restore', 'Database', name, { safetyDump })
    res.json({ restored: name, safetyDump })
  } catch (e) {
    if (e instanceof DumpError) { res.status(422).json({ message: e.message, code: e.code }); return }
    next(e)
  }
})

// GET /api/admin/audit
adminRouter.get('/audit', async (_req, res: Response, next: NextFunction) => {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { name: true, email: true } } },
    })
    res.json(logs)
  } catch (e) { next(e) }
})
