import { Router } from 'express'
import { z, type ZodType } from 'zod'
import { Prisma } from '@prisma/client'
import type { Response, NextFunction } from 'express'
import { prisma } from '../utils/prisma'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { audit } from '../utils/audit'
import {
  isReservedCode,
  nextVersion,
  nodeBodySchema,
  nodeDraftSchema,
  nodeProblems,
  parseDevice,
  templateBodySchema,
  templateCatalogCodes,
  templateDraftSchema,
  templateProblems,
  type DeviceType,
} from '../utils/catalog'

/**
 * Редактор шаблонов, этап 2 (роль TECHNOLOG, Библиотека §6.2): каталог узлов
 * и шаблоны изделий.
 *
 *  - узлы каталога — `/catalog`: черновик, публикация новой версии, откат
 *    к прежней, архив;
 *  - шаблоны изделий — `/products/:device`: черновик, публикация, откат к
 *    прежней версии или к встроенному шаблону.
 *
 * Опубликованная версия неизменна, действующая — та, на которую указывает
 * `activeVersion`. Калькулятор читает действующие через `/api/refs/templates`
 * (любая роль); здесь — только редактор. Каждая публикация, откат и архив
 * пишутся в AuditLog; сохранение черновика — нет: это незаконченная работа.
 */
export const catalogRouter = Router()
catalogRouter.use('/', requireAuth, requireRole('ADMIN', 'TECHNOLOG'))

/** Тело запроса по схеме — с понятным первым замечанием, а не деревом ошибок. */
function parse<T>(schema: ZodType<T>, value: unknown): { ok: true; data: T } | { ok: false; message: string } {
  const r = schema.safeParse(value)
  if (r.success) return { ok: true, data: r.data }
  const i = r.error.issues[0]
  return { ok: false, message: i ? `${i.path.join('.') || 'тело'}: ${i.message}` : 'Ошибка валидации' }
}

/** Гонка за номер версии: уникальный индекс отдал его соседнему запросу. */
const isRace = (e: unknown) => (e as { code?: string }).code === 'P2002'

const versionSelect = {
  version: true,
  note: true,
  publishedAt: true,
  body: true,
  publishedBy: { select: { name: true } },
} as const

type VersionRow = { version: number; note: string | null; publishedAt: Date; body: Prisma.JsonValue; publishedBy: { name: string } | null }

const versionDto = (v: VersionRow) => ({
  version: v.version,
  note: v.note,
  publishedAt: v.publishedAt,
  publishedBy: v.publishedBy?.name ?? null,
  body: v.body,
})

const noteSchema = z.object({ note: z.string().trim().max(500).optional() })

// ── Узлы каталога ──────────────────────────────────────────────────────────

catalogRouter.get('/catalog', async (_req, res: Response, next: NextFunction) => {
  try {
    const nodes = await prisma.nodeDef.findMany({
      orderBy: { code: 'asc' },
      include: { versions: { orderBy: { version: 'desc' }, select: versionSelect } },
    })
    res.json(
      nodes.map((n) => ({
        code: n.code,
        draft: n.draft,
        activeVersion: n.activeVersion,
        archived: n.archived,
        updatedAt: n.updatedAt,
        versions: n.versions.map(versionDto),
      })),
    )
  } catch (e) { next(e) }
})

// Новый узел — сразу черновиком; публикуется отдельно.
catalogRouter.post('/catalog', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const p = parse(nodeDraftSchema, req.body?.body)
    if (!p.ok) { res.status(400).json({ message: p.message }); return }
    if (isReservedCode(p.data.code)) { res.status(400).json({ message: `Код ${p.data.code} занят встроенным узлом` }); return }
    if (await prisma.nodeDef.findUnique({ where: { code: p.data.code } })) {
      res.status(409).json({ message: `Узел ${p.data.code} уже есть в каталоге` }); return
    }
    const node = await prisma.nodeDef.create({ data: { code: p.data.code, draft: p.data as Prisma.InputJsonValue } })
    await audit(auth.userId, 'template.node.create', 'NodeDef', node.code)
    res.status(201).json({ code: node.code, draft: node.draft, activeVersion: null, archived: false, updatedAt: node.updatedAt, versions: [] })
  } catch (e) { next(e) }
})

catalogRouter.put('/catalog/:code/draft', async (req, res: Response, next: NextFunction) => {
  try {
    const code = String(req.params.code)
    const p = parse(nodeDraftSchema, req.body?.body)
    if (!p.ok) { res.status(400).json({ message: p.message }); return }
    if (p.data.code !== code) { res.status(400).json({ message: 'Код узла не меняется — заведите новый узел' }); return }
    const found = await prisma.nodeDef.findUnique({ where: { code } })
    if (!found) { res.status(404).json({ message: `Узла ${code} нет` }); return }
    const node = await prisma.nodeDef.update({ where: { code }, data: { draft: p.data as Prisma.InputJsonValue } })
    res.json({ code, draft: node.draft, updatedAt: node.updatedAt })
  } catch (e) { next(e) }
})

// Отменить черновик. Узел, который ни разу не публиковался, удаляется целиком:
// кроме черновика в нём ничего нет.
catalogRouter.delete('/catalog/:code/draft', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const code = String(req.params.code)
    const found = await prisma.nodeDef.findUnique({ where: { code } })
    if (!found) { res.status(404).json({ message: `Узла ${code} нет` }); return }
    if (found.activeVersion == null) {
      await prisma.nodeDef.delete({ where: { code } })
      await audit(auth.userId, 'template.node.discard', 'NodeDef', code, { deleted: true })
      res.status(204).send()
      return
    }
    await prisma.nodeDef.update({ where: { code }, data: { draft: Prisma.DbNull } })
    await audit(auth.userId, 'template.node.discard', 'NodeDef', code)
    res.status(204).send()
  } catch (e) { next(e) }
})

catalogRouter.post('/catalog/:code/publish', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const code = String(req.params.code)
    const n = parse(noteSchema, req.body ?? {})
    if (!n.ok) { res.status(400).json({ message: n.message }); return }
    const found = await prisma.nodeDef.findUnique({ where: { code }, include: { versions: { select: { version: true } } } })
    if (!found) { res.status(404).json({ message: `Узла ${code} нет` }); return }
    if (found.draft == null) { res.status(400).json({ message: 'Публиковать нечего: черновика нет' }); return }
    const p = parse(nodeBodySchema, found.draft)
    if (!p.ok) { res.status(400).json({ message: `Черновик не готов к публикации — ${p.message}` }); return }
    const problems = nodeProblems(p.data)
    if (problems.length) { res.status(400).json({ message: problems[0], problems }); return }

    const version = nextVersion(found.versions)
    try {
      await prisma.$transaction([
        prisma.nodeDefVersion.create({
          data: { nodeId: found.id, version, body: p.data as Prisma.InputJsonValue, note: n.data.note || null, publishedById: auth.userId ?? null },
        }),
        prisma.nodeDef.update({ where: { code }, data: { activeVersion: version, draft: Prisma.DbNull } }),
      ])
    } catch (e) {
      if (isRace(e)) { res.status(409).json({ message: 'Эту версию только что опубликовали — обновите страницу' }); return }
      throw e
    }
    await audit(auth.userId, 'template.node.publish', 'NodeDef', code, { version, note: n.data.note ?? null })
    res.json({ code, version })
  } catch (e) { next(e) }
})

/** Изделие словами — для сообщений технологу. */
const DEVICE_LABEL: Record<DeviceType, string> = { KNS: 'КНС', EMK: 'ЕМК', KOL: 'колодец' }

/** Шаблоны изделий, чья действующая версия ссылается на узел. */
async function templatesUsing(code: string): Promise<string[]> {
  const templates = await prisma.productTemplate.findMany({
    where: { activeVersion: { not: null } },
    include: { versions: true },
  })
  const out: string[] = []
  for (const t of templates) {
    const v = t.versions.find((x) => x.version === t.activeVersion)
    const body = v?.body as { sections?: Array<{ nodes: Array<{ kind: string; code?: string }> }> } | undefined
    if (body?.sections && templateCatalogCodes({ sections: body.sections }).includes(code)) {
      out.push(`${DEVICE_LABEL[t.deviceType as DeviceType]} v${t.activeVersion}`)
    }
  }
  return out
}

catalogRouter.post('/catalog/:code/archive', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const code = String(req.params.code)
    const p = parse(z.object({ archived: z.boolean() }), req.body)
    if (!p.ok) { res.status(400).json({ message: p.message }); return }
    const found = await prisma.nodeDef.findUnique({ where: { code } })
    if (!found) { res.status(404).json({ message: `Узла ${code} нет` }); return }
    if (p.data.archived) {
      const using = await templatesUsing(code)
      if (using.length) {
        res.status(409).json({ message: `Узел стоит в действующих шаблонах: ${using.join(', ')} — сначала уберите его оттуда`, templates: using })
        return
      }
    }
    await prisma.nodeDef.update({ where: { code }, data: { archived: p.data.archived } })
    await audit(auth.userId, 'template.node.archive', 'NodeDef', code, { archived: p.data.archived })
    res.json({ code, archived: p.data.archived })
  } catch (e) { next(e) }
})

// Откат: действующей становится одна из опубликованных версий.
catalogRouter.post('/catalog/:code/activate', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const code = String(req.params.code)
    const p = parse(z.object({ version: z.number().int().positive() }), req.body)
    if (!p.ok) { res.status(400).json({ message: p.message }); return }
    const found = await prisma.nodeDef.findUnique({ where: { code }, include: { versions: { select: { version: true } } } })
    if (!found) { res.status(404).json({ message: `Узла ${code} нет` }); return }
    if (!found.versions.some((v) => v.version === p.data.version)) {
      res.status(404).json({ message: `У узла ${code} нет версии ${p.data.version}` }); return
    }
    await prisma.nodeDef.update({ where: { code }, data: { activeVersion: p.data.version } })
    await audit(auth.userId, 'template.node.activate', 'NodeDef', code, { from: found.activeVersion, to: p.data.version })
    res.json({ code, activeVersion: p.data.version })
  } catch (e) { next(e) }
})

// ── Шаблоны изделий ────────────────────────────────────────────────────────

const DEVICES: DeviceType[] = ['KNS', 'EMK', 'KOL']

catalogRouter.get('/products', async (_req, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.productTemplate.findMany({
      include: { versions: { orderBy: { version: 'desc' }, select: versionSelect } },
    })
    // Строки шаблона заводятся первой записью черновика; до неё у изделия
    // действует встроенный шаблон и истории нет.
    res.json(
      DEVICES.map((d) => {
        const t = rows.find((r) => r.deviceType === d)
        return {
          deviceType: d,
          draft: t?.draft ?? null,
          activeVersion: t?.activeVersion ?? null,
          updatedAt: t?.updatedAt ?? null,
          versions: (t?.versions ?? []).map(versionDto),
        }
      }),
    )
  } catch (e) { next(e) }
})

catalogRouter.put('/products/:device/draft', async (req, res: Response, next: NextFunction) => {
  try {
    const device = parseDevice(req.params.device)
    if (!device) { res.status(404).json({ message: 'Нет такого изделия' }); return }
    const p = parse(templateDraftSchema, req.body?.body)
    if (!p.ok) { res.status(400).json({ message: p.message }); return }
    const draft = p.data as Prisma.InputJsonValue
    const t = await prisma.productTemplate.upsert({
      where: { deviceType: device },
      update: { draft },
      create: { deviceType: device, draft },
    })
    res.json({ deviceType: device, draft: t.draft, updatedAt: t.updatedAt })
  } catch (e) { next(e) }
})

catalogRouter.delete('/products/:device/draft', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const device = parseDevice(req.params.device)
    if (!device) { res.status(404).json({ message: 'Нет такого изделия' }); return }
    const t = await prisma.productTemplate.findUnique({ where: { deviceType: device } })
    if (t?.draft != null) {
      await prisma.productTemplate.update({ where: { deviceType: device }, data: { draft: Prisma.DbNull } })
      await audit(auth.userId, 'template.product.discard', 'ProductTemplate', device)
    }
    res.status(204).send()
  } catch (e) { next(e) }
})

catalogRouter.post('/products/:device/publish', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const device = parseDevice(req.params.device)
    if (!device) { res.status(404).json({ message: 'Нет такого изделия' }); return }
    const n = parse(noteSchema, req.body ?? {})
    if (!n.ok) { res.status(400).json({ message: n.message }); return }
    const t = await prisma.productTemplate.findUnique({ where: { deviceType: device }, include: { versions: { select: { version: true } } } })
    if (!t || t.draft == null) { res.status(400).json({ message: 'Публиковать нечего: черновика нет' }); return }
    const p = parse(templateBodySchema, t.draft)
    if (!p.ok) { res.status(400).json({ message: `Черновик не готов к публикации — ${p.message}` }); return }

    const codes = templateCatalogCodes(p.data)
    const nodes = await prisma.nodeDef.findMany({ where: { code: { in: codes } }, select: { code: true, activeVersion: true, archived: true } })
    const problems = templateProblems(device, p.data, new Map(nodes.map((x) => [x.code, x])))
    if (problems.length) { res.status(400).json({ message: problems[0], problems }); return }

    const version = nextVersion(t.versions)
    try {
      await prisma.$transaction([
        prisma.productTemplateVersion.create({
          data: { templateId: t.id, version, body: p.data as Prisma.InputJsonValue, note: n.data.note || null, publishedById: auth.userId ?? null },
        }),
        prisma.productTemplate.update({ where: { deviceType: device }, data: { activeVersion: version, draft: Prisma.DbNull } }),
      ])
    } catch (e) {
      if (isRace(e)) { res.status(409).json({ message: 'Эту версию только что опубликовали — обновите страницу' }); return }
      throw e
    }
    await audit(auth.userId, 'template.product.publish', 'ProductTemplate', device, { version, note: n.data.note ?? null })
    res.json({ deviceType: device, version })
  } catch (e) { next(e) }
})

// Откат: действующей становится опубликованная версия либо встроенный
// шаблон (version: null).
catalogRouter.post('/products/:device/activate', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const device = parseDevice(req.params.device)
    if (!device) { res.status(404).json({ message: 'Нет такого изделия' }); return }
    const p = parse(z.object({ version: z.number().int().positive().nullable() }), req.body)
    if (!p.ok) { res.status(400).json({ message: p.message }); return }
    const t = await prisma.productTemplate.findUnique({ where: { deviceType: device }, include: { versions: true } })
    if (p.data.version != null) {
      const v = t?.versions.find((x) => x.version === p.data.version)
      if (!t || !v) { res.status(404).json({ message: `У шаблона ${DEVICE_LABEL[device]} нет версии ${p.data.version}` }); return }
      // Узлы каталога, на которые ссылается версия, могли с тех пор уйти в
      // архив: такая версия собрала бы изделие без них.
      const body = v.body as { sections?: Array<{ nodes: Array<{ kind: string; code?: string }> }> }
      const codes = body.sections ? templateCatalogCodes({ sections: body.sections }) : []
      const nodes = await prisma.nodeDef.findMany({ where: { code: { in: codes } }, select: { code: true, activeVersion: true, archived: true } })
      const missing = codes.filter((c) => !nodes.some((x) => x.code === c && x.activeVersion != null && !x.archived))
      if (missing.length) {
        res.status(409).json({ message: `В версии ${p.data.version} есть узлы вне каталога: ${missing.join(', ')} — верните их из архива`, missing })
        return
      }
    }
    if (!t && p.data.version == null) { res.json({ deviceType: device, activeVersion: null }); return }
    await prisma.productTemplate.update({ where: { deviceType: device }, data: { activeVersion: p.data.version } })
    await audit(auth.userId, 'template.product.activate', 'ProductTemplate', device, { from: t?.activeVersion ?? null, to: p.data.version })
    res.json({ deviceType: device, activeVersion: p.data.version })
  } catch (e) { next(e) }
})
