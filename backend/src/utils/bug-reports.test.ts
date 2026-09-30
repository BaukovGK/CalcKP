import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  BugReportError,
  deleteBugReport,
  detectImageType,
  isValidReportId,
  isValidScreenshotName,
  listBugReports,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOTS,
  MAX_TEXT_LENGTH,
  newReportId,
  readBugReport,
  saveBugReport,
  screenshotMime,
  screenshotPath,
  updateBugReport,
  type NewBugReport,
} from './bug-reports'

/** Минимальные файлы с настоящими сигнатурами. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16])
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1')
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

const AUTHOR = { id: 'u1', name: 'Иванов Сергей Владимирович', email: 'ivanov@ntt.local', role: 'ENGINEER' }

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bugreports-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function input(over: Partial<NewBugReport> = {}): NewBugReport {
  return {
    text: 'Не сохраняется опросный лист: после «Создать расчёт» пустой экран',
    pageUrl: '/survey/abc?type=KNS',
    pageTitle: 'НТТ Калькулятор',
    viewport: '1920×1080',
    appBuild: '84a104b',
    userAgent: 'Mozilla/5.0',
    author: AUTHOR,
    files: [],
    ...over,
  }
}

describe('номер отчёта', () => {
  it('время отправки по UTC и шесть случайных знаков — строкой сортируется по времени', () => {
    const id = newReportId(new Date('2026-09-30T08:15:02.123Z'), 'a1b2c3')
    expect(id).toBe('br-20260930-081502-a1b2c3')
    expect(isValidReportId(id)).toBe(true)
    expect(newReportId(new Date('2026-10-01T00:00:00Z'), '000000') > id).toBe(true)
  })

  // Номер — имя папки: всё, что не номер, в путь пропускать нельзя.
  it('ни слэша, ни «..», ни временной папки', () => {
    for (const bad of ['../etc', 'br-20260930-081502-a1b2c3/..', '.tmp-br-20260930-081502-a1b2c3', 'br-2026-a', '']) {
      expect(isValidReportId(bad), bad).toBe(false)
    }
  })

  it('скриншоты — только shot-N с расширением картинки', () => {
    expect(isValidScreenshotName('shot-1.png')).toBe(true)
    expect(isValidScreenshotName('shot-12.webp')).toBe(true)
    for (const bad of ['report.json', '../shot-1.png', 'shot-1.svg', 'shot-1.png/..', 'shot-.png']) {
      expect(isValidScreenshotName(bad), bad).toBe(false)
    }
    expect(() => screenshotPath(dir, 'br-20260930-081502-a1b2c3', 'report.json')).toThrow(BugReportError)
    expect(() => screenshotPath(dir, '../x', 'shot-1.png')).toThrow(BugReportError)
  })
})

describe('картинка по сигнатуре, а не по типу от браузера', () => {
  it('узнаёт PNG, JPEG, GIF и WebP', () => {
    expect(detectImageType(PNG)).toEqual({ ext: 'png', mime: 'image/png' })
    expect(detectImageType(JPEG)).toEqual({ ext: 'jpg', mime: 'image/jpeg' })
    expect(detectImageType(GIF)).toEqual({ ext: 'gif', mime: 'image/gif' })
    expect(detectImageType(WEBP)).toEqual({ ext: 'webp', mime: 'image/webp' })
  })

  // SVG — документ со скриптами: открывать его придётся администратору.
  it('SVG, текст и пустой файл — не картинки', () => {
    expect(detectImageType(SVG)).toBeNull()
    expect(detectImageType(Buffer.from('просто текст'))).toBeNull()
    expect(detectImageType(Buffer.alloc(0))).toBeNull()
  })

  it('тип скриншота при выдаче — по расширению', () => {
    expect(screenshotMime('shot-1.png')).toBe('image/png')
    expect(screenshotMime('shot-2.jpg')).toBe('image/jpeg')
  })
})

describe('saveBugReport — отчёт в своей папке', () => {
  it('пишет report.json и скриншоты, статус — новый', async () => {
    const r = await saveBugReport(
      dir,
      input({ files: [{ buffer: PNG, originalName: 'Снимок экрана.png' }, { buffer: JPEG, originalName: null }] }),
      new Date('2026-09-30T08:15:02Z'),
    )

    expect(r.status).toBe('new')
    expect(r.createdAt).toBe('2026-09-30T08:15:02.000Z')
    expect(r.author).toEqual(AUTHOR)
    expect(r.page).toEqual({ url: '/survey/abc?type=KNS', title: 'НТТ Калькулятор' })
    expect(r.screenshots).toEqual([
      { name: 'shot-1.png', originalName: 'Снимок экрана.png', type: 'image/png', sizeBytes: PNG.length },
      { name: 'shot-2.jpg', originalName: null, type: 'image/jpeg', sizeBytes: JPEG.length },
    ])

    const files = (await readdir(path.join(dir, r.id))).sort()
    expect(files).toEqual(['report.json', 'shot-1.png', 'shot-2.jpg'])
    expect(await readFile(path.join(dir, r.id, 'shot-1.png'))).toEqual(PNG)
    expect(JSON.parse(await readFile(path.join(dir, r.id, 'report.json'), 'utf8'))).toEqual(r)
    // Временная папка не остаётся.
    expect(await readdir(dir)).toEqual([r.id])
  })

  it('без скриншотов — тоже отчёт', async () => {
    const r = await saveBugReport(dir, input())
    expect(r.screenshots).toEqual([])
    expect(await readBugReport(dir, r.id)).toEqual(r)
  })

  it('каталога ещё нет — создаётся', async () => {
    const nested = path.join(dir, 'bugreports')
    const r = await saveBugReport(nested, input())
    expect(await readdir(nested)).toEqual([r.id])
  })

  it('управляющие символы вычищаются, длинные поля обрезаются', async () => {
    const r = await saveBugReport(dir, input({ text: '  Ошибка\u0000 в\u0007 расчёте  ', pageUrl: `/x?${'a'.repeat(3000)}` }))
    expect(r.text).toBe('Ошибка в расчёте')
    expect(r.page.url).toHaveLength(2000)
  })

  const rejects = async (over: Partial<NewBugReport>, code: string) => {
    await expect(saveBugReport(dir, input(over))).rejects.toMatchObject({ code })
    // Отказ ничего не оставляет на диске.
    expect(await readdir(dir)).toEqual([])
  }

  it('пустой текст — отказ', () => rejects({ text: '   \n ' }, 'EMPTY_TEXT'))
  it('текст длиннее предела — отказ', () => rejects({ text: 'я'.repeat(MAX_TEXT_LENGTH + 1) }, 'TEXT_TOO_LONG'))
  it('скриншотов больше пяти — отказ', () =>
    rejects({ files: Array.from({ length: MAX_SCREENSHOTS + 1 }, () => ({ buffer: PNG })) }, 'TOO_MANY_FILES'))
  it('SVG под видом картинки — отказ', () =>
    rejects({ files: [{ buffer: PNG }, { buffer: SVG, originalName: 'shot.png' }] }, 'NOT_AN_IMAGE'))
  it('файл больше 4 МБ — отказ', () =>
    rejects({ files: [{ buffer: Buffer.concat([PNG, Buffer.alloc(MAX_SCREENSHOT_BYTES)]) }] }, 'FILE_TOO_LARGE'))
})

describe('listBugReports', () => {
  it('свежие первыми, с коротким текстом и числом скриншотов', async () => {
    const old = await saveBugReport(dir, input({ text: 'Старый' }), new Date('2026-09-01T10:00:00Z'))
    const fresh = await saveBugReport(
      dir,
      input({ text: `Новый ${'длинный '.repeat(60)}`, files: [{ buffer: PNG }] }),
      new Date('2026-09-30T10:00:00Z'),
    )

    const list = await listBugReports(dir)
    expect(list.map((r) => r.id)).toEqual([fresh.id, old.id])
    expect(list[0]).toMatchObject({ status: 'new', authorName: AUTHOR.name, pageUrl: '/survey/abc?type=KNS', screenshots: 1, hasNote: false })
    expect(list[0]!.excerpt.length).toBeLessThanOrEqual(200)
    expect(list[0]!.excerpt.endsWith('…')).toBe(true)
  })

  it('каталога нет — отчётов нет, а не ошибка', async () => {
    expect(await listBugReports(path.join(dir, 'нет-такого'))).toEqual([])
  })

  it('чужие папки, временные и битые отчёты пропускаются', async () => {
    const ok = await saveBugReport(dir, input())
    await mkdir(path.join(dir, 'не-отчёт'))
    await mkdir(path.join(dir, '.tmp-br-20260930-081502-a1b2c3'))
    await mkdir(path.join(dir, 'br-20260930-081502-ffffff'))
    await writeFile(path.join(dir, 'br-20260930-081502-ffffff', 'report.json'), '{ битый')

    expect((await listBugReports(dir)).map((r) => r.id)).toEqual([ok.id])
  })
})

describe('updateBugReport', () => {
  it('меняет статус и пометку, время правки — новое', async () => {
    const r = await saveBugReport(dir, input(), new Date('2026-09-30T08:00:00Z'))
    const u = await updateBugReport(dir, r.id, { status: 'in_progress', adminNote: 'Воспроизведено' }, new Date('2026-09-30T09:00:00Z'))

    expect(u).toMatchObject({ status: 'in_progress', adminNote: 'Воспроизведено', updatedAt: '2026-09-30T09:00:00.000Z' })
    expect(u!.createdAt).toBe(r.createdAt)
    expect(await readBugReport(dir, r.id)).toEqual(u)
    expect(await readdir(path.join(dir, r.id))).not.toContain('report.json.tmp')
  })

  it('пустая пометка стирается, статус при этом не трогается', async () => {
    const r = await saveBugReport(dir, input())
    await updateBugReport(dir, r.id, { status: 'resolved', adminNote: 'Исправлено' })
    const u = await updateBugReport(dir, r.id, { adminNote: '  ' })
    expect(u).toMatchObject({ status: 'resolved', adminNote: null })
  })

  it('нет отчёта — null', async () => {
    expect(await updateBugReport(dir, 'br-20260930-081502-a1b2c3', { status: 'resolved' })).toBeNull()
    expect(await updateBugReport(dir, '../x', { status: 'resolved' })).toBeNull()
  })
})

describe('deleteBugReport', () => {
  it('удаляет папку целиком, со скриншотами', async () => {
    const r = await saveBugReport(dir, input({ files: [{ buffer: PNG }] }))
    expect(await deleteBugReport(dir, r.id)).toBe(true)
    expect(await readdir(dir)).toEqual([])
    expect(await readBugReport(dir, r.id)).toBeNull()
  })

  it('нет отчёта — false; чужой путь — тоже', async () => {
    expect(await deleteBugReport(dir, 'br-20260930-081502-a1b2c3')).toBe(false)
    expect(await deleteBugReport(dir, '..')).toBe(false)
  })
})
