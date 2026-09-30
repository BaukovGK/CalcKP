/**
 * Отчёты об ошибках от сотрудников: хранение на диске, в своём каталоге.
 *
 * Отчёт — папка `BUGREPORT_DIR/<id>/`: в ней `report.json` (текст, автор,
 * страница, браузер, статус) и скриншоты `shot-1.png`, `shot-2.jpg`… Базе они
 * не нужны: отчёты читает администратор, а каталог, как и дампы, живёт на
 * хосте (том в docker-compose.yml) — его можно открыть и без приложения,
 * забрать с машины целиком, и восстановление базы из дампа его не трогает.
 *
 * Отчёт пишется во временную папку и переименовывается в итоговую одним
 * шагом: оборванная посередине запись не оставит в списке отчёт без
 * скриншотов или без `report.json`. Временное имя не проходит
 * {@link isValidReportId}, поэтому в список не попадает.
 *
 * Скриншот принимается по сигнатуре файла, а не по типу, который прислал
 * браузер: PNG, JPEG, GIF и WebP. SVG не принимается вовсе — это документ со
 * скриптами, и открывать его придётся администратору.
 *
 * @module utils/bug-reports
 */

import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { logger } from './logger'

/** Каталог отчётов. В контейнере — том `./bugreports:/bugreports`. */
export const BUGREPORT_DIR = process.env.BUGREPORT_DIR ?? path.resolve(process.cwd(), 'bugreports')

/** Скриншотов в одном отчёте, не больше. */
export const MAX_SCREENSHOTS = 5
/**
 * Размер одного скриншота, байт. Пять по 4 МБ укладываются в предел тела
 * запроса nginx (25 МБ, `ntt-calculator/nginx.conf`); крупнее экран сам
 * пережимает перед отправкой.
 */
export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024
/** Длина текста отчёта, символов. */
export const MAX_TEXT_LENGTH = 10_000

/** Статусы отчёта: новый → в работе → закрыт. */
export const BUG_REPORT_STATUSES = ['new', 'in_progress', 'resolved'] as const
export type BugReportStatus = (typeof BUG_REPORT_STATUSES)[number]

export interface BugReportScreenshot {
  /** Имя файла в папке отчёта: `shot-1.png`. */
  name: string
  /** Как файл назывался у сотрудника; у вставленного из буфера — пусто. */
  originalName: string | null
  type: string
  sizeBytes: number
}

export interface BugReportAuthor {
  id: string
  name: string
  email: string
  role: string
}

export interface BugReport {
  id: string
  createdAt: string
  updatedAt: string
  status: BugReportStatus
  text: string
  /** Где был сотрудник, когда нажал «Сообщить об ошибке». */
  page: { url: string | null; title: string | null }
  /** Снимок учётной записи на момент отправки: ФИО могут потом поменять. */
  author: BugReportAuthor | null
  client: { userAgent: string | null; viewport: string | null; appBuild: string | null }
  screenshots: BugReportScreenshot[]
  /** Пометка администратора: что сделано, где исправлено. */
  adminNote: string | null
}

/** Строка списка: без полного текста и подробностей. */
export interface BugReportSummary {
  id: string
  createdAt: string
  updatedAt: string
  status: BugReportStatus
  /** Начало текста — по нему отчёты различают в списке. */
  excerpt: string
  pageUrl: string | null
  authorName: string | null
  screenshots: number
  hasNote: boolean
}

export class BugReportError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'BugReportError'
  }
}

/**
 * Имя папки отчёта — оно же идентификатор: время отправки по UTC и шесть
 * случайных знаков. Сортируется по времени как строка, а жёсткий шаблон не
 * пропустит в путь ни слэш, ни «..».
 */
const ID_RE = /^br-\d{8}-\d{6}-[0-9a-f]{6}$/
const SHOT_RE = /^shot-\d{1,2}\.(?:png|jpg|gif|webp)$/

export function isValidReportId(id: string): boolean {
  return ID_RE.test(id)
}

export function isValidScreenshotName(name: string): boolean {
  return SHOT_RE.test(name)
}

export function newReportId(now: Date = new Date(), random: string = randomBytes(3).toString('hex')): string {
  const iso = now.toISOString() // 2026-09-30T08:15:02.123Z
  const date = iso.slice(0, 10).replace(/-/g, '')
  const time = iso.slice(11, 19).replace(/:/g, '')
  return `br-${date}-${time}-${random}`
}

/** Тип картинки по первым байтам файла; `null` — не картинка из списка. */
export function detectImageType(buf: Uint8Array): { ext: string; mime: string } | null {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => buf[at + i] === b)
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', mime: 'image/png' }
  if (starts([0xff, 0xd8, 0xff])) return { ext: 'jpg', mime: 'image/jpeg' }
  if (starts([0x47, 0x49, 0x46, 0x38]) && (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61) {
    return { ext: 'gif', mime: 'image/gif' }
  }
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return { ext: 'webp', mime: 'image/webp' }
  return null
}

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** MIME скриншота по его имени в папке отчёта. */
export function screenshotMime(name: string): string {
  return MIME_BY_EXT[name.split('.').pop() ?? ''] ?? 'application/octet-stream'
}

function reportDir(dir: string, id: string): string {
  if (!isValidReportId(id)) throw new BugReportError(`Недопустимый номер отчёта: ${id}`, 'BAD_ID')
  return path.join(dir, id)
}

/** Полный путь к скриншоту. Бросает, если номер или имя не наши. */
export function screenshotPath(dir: string, id: string, name: string): string {
  if (!isValidScreenshotName(name)) throw new BugReportError(`Недопустимое имя файла: ${name}`, 'BAD_NAME')
  return path.join(reportDir(dir, id), name)
}

export function screenshotStream(dir: string, id: string, name: string) {
  return createReadStream(screenshotPath(dir, id, name))
}

/** Строка без управляющих символов, обрезанная до предела; пустая — `null`. */
function clean(value: string | null | undefined, max: number): string | null {
  if (value == null) return null
  const s = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  return s ? s.slice(0, max) : null
}

export interface NewBugReport {
  text: string
  pageUrl?: string | null
  pageTitle?: string | null
  viewport?: string | null
  appBuild?: string | null
  userAgent?: string | null
  author: BugReportAuthor | null
  files: Array<{ buffer: Buffer; originalName?: string | null }>
}

/**
 * Проверить и записать отчёт. Бросает {@link BugReportError}, если текст
 * пуст или длиннее предела, скриншотов больше пяти, файл крупнее 4 МБ или
 * не картинка.
 */
export async function saveBugReport(dir: string, input: NewBugReport, now: Date = new Date()): Promise<BugReport> {
  const text = clean(input.text, Number.POSITIVE_INFINITY)
  if (!text) throw new BugReportError('Опишите, что случилось: текст отчёта пуст', 'EMPTY_TEXT')
  if (text.length > MAX_TEXT_LENGTH) {
    throw new BugReportError(`Текст длиннее ${MAX_TEXT_LENGTH.toLocaleString('ru-RU')} знаков`, 'TEXT_TOO_LONG')
  }
  if (input.files.length > MAX_SCREENSHOTS) {
    throw new BugReportError(`Скриншотов больше ${MAX_SCREENSHOTS}`, 'TOO_MANY_FILES')
  }

  const shots = input.files.map((f, i) => {
    const original = clean(f.originalName, 200)
    if (f.buffer.length > MAX_SCREENSHOT_BYTES) {
      throw new BugReportError(`Файл «${original ?? `скриншот ${i + 1}`}» больше 4 МБ`, 'FILE_TOO_LARGE')
    }
    const type = detectImageType(f.buffer)
    if (!type) {
      throw new BugReportError(
        `Файл «${original ?? `скриншот ${i + 1}`}» — не картинка PNG, JPEG, GIF или WebP`,
        'NOT_AN_IMAGE',
      )
    }
    return { buffer: f.buffer, meta: { name: `shot-${i + 1}.${type.ext}`, originalName: original, type: type.mime, sizeBytes: f.buffer.length } }
  })

  const id = newReportId(now)
  const stamp = now.toISOString()
  const report: BugReport = {
    id,
    createdAt: stamp,
    updatedAt: stamp,
    status: 'new',
    text,
    page: { url: clean(input.pageUrl, 2000), title: clean(input.pageTitle, 300) },
    author: input.author,
    client: {
      userAgent: clean(input.userAgent, 500),
      viewport: clean(input.viewport, 50),
      appBuild: clean(input.appBuild, 100),
    },
    screenshots: shots.map((s) => s.meta),
    adminNote: null,
  }

  await mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.tmp-${id}`)
  try {
    await mkdir(tmp)
    for (const s of shots) await writeFile(path.join(tmp, s.meta.name), s.buffer)
    await writeFile(path.join(tmp, 'report.json'), JSON.stringify(report, null, 2))
    await rename(tmp, reportDir(dir, id))
  } catch (e) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
    throw e
  }
  return report
}

/** Отчёт по номеру; `null` — нет такого или `report.json` не читается. */
export async function readBugReport(dir: string, id: string): Promise<BugReport | null> {
  if (!isValidReportId(id)) return null
  try {
    const raw = await readFile(path.join(reportDir(dir, id), 'report.json'), 'utf8')
    // Номер — имя папки: по нему отчёт открывают и удаляют, что бы ни
    // оказалось в файле.
    return { ...(JSON.parse(raw) as BugReport), id }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Отчёт об ошибке не читается', { id, error: e instanceof Error ? e.message : String(e) })
    }
    return null
  }
}

/**
 * Строка списка. `report.json` лежит на диске, и его могут поправить руками —
 * поэтому поля читаются с оглядкой: недостающее не должно ронять весь список.
 */
function summarize(r: BugReport): BugReportSummary {
  const oneLine = String(r.text ?? '').replace(/\s+/g, ' ')
  return {
    id: r.id,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt ?? r.createdAt,
    status: BUG_REPORT_STATUSES.includes(r.status) ? r.status : 'new',
    excerpt: oneLine.length > 200 ? `${oneLine.slice(0, 199)}…` : oneLine,
    pageUrl: r.page?.url ?? null,
    authorName: r.author?.name ?? null,
    screenshots: r.screenshots?.length ?? 0,
    hasNote: !!r.adminNote,
  }
}

/** Все отчёты, свежие первыми. Каталога ещё нет — отчётов нет. */
export async function listBugReports(dir: string): Promise<BugReportSummary[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
  const reports = await Promise.all(names.filter(isValidReportId).map((id) => readBugReport(dir, id)))
  return reports
    .filter((r): r is BugReport => r !== null)
    .map(summarize)
    // Номер начинается со времени отправки: порядок строк — порядок отчётов.
    .sort((a, b) => b.id.localeCompare(a.id))
}

export interface BugReportPatch {
  status?: BugReportStatus
  /** Пустая строка стирает пометку. */
  adminNote?: string | null
}

/** Сменить статус или пометку администратора; `null` — отчёта нет. */
export async function updateBugReport(
  dir: string,
  id: string,
  patch: BugReportPatch,
  now: Date = new Date(),
): Promise<BugReport | null> {
  const current = await readBugReport(dir, id)
  if (!current) return null
  const next: BugReport = {
    ...current,
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.adminNote !== undefined ? { adminNote: clean(patch.adminNote, 2000) } : {}),
    updatedAt: now.toISOString(),
  }
  // Через временный файл: оборванная запись не должна оставить пустой report.json.
  const file = path.join(reportDir(dir, id), 'report.json')
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(next, null, 2))
  await rename(tmp, file)
  return next
}

/** Удалить отчёт вместе со скриншотами; `false` — его и не было. */
export async function deleteBugReport(dir: string, id: string): Promise<boolean> {
  if (!(await readBugReport(dir, id))) return false
  await rm(reportDir(dir, id), { recursive: true, force: true })
  return true
}
