/**
 * Инструкции на экране «Инструкции»: каждая открывается, у каждого рисунка
 * есть файл, ссылки между инструкциями ведут внутрь программы. Новая редакция
 * текста от автора проверяется этим же тестом — пропавший рисунок или
 * переименованный файл не дойдут до пользователя молча.
 */
import { describe, expect, it } from 'vitest'
import { defaultHelpDoc, HELP_DOCS, helpLinkTarget, helpSource, renderHelpDoc } from './help-docs'

/** Рисунки, что лежат в public/manual: пути вида `img/admin/01-….png`, как в тексте. */
const IMAGES = new Set(
  Object.keys(import.meta.glob('../../public/manual/img/**/*.png')).map((k) => k.replace('../../public/manual/', '')),
)

describe('инструкции', () => {
  it.each(HELP_DOCS.map((d) => [d.label, d]))('«%s» открывается: заголовок, оглавление, текст', (_, d) => {
    const doc = renderHelpDoc(d.slug)!
    expect(doc.title).toMatch(/НТТ Калькулятор/)
    expect(doc.toc.length).toBeGreaterThan(3)
    expect(doc.html.length).toBeGreaterThan(5000)
  })

  it('у каждого рисунка есть файл', () => {
    const missing: string[] = []
    for (const d of HELP_DOCS) {
      for (const m of helpSource(d.file).matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
        if (!IMAGES.has(m[1]!)) missing.push(`${d.file}: ${m[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('рисунки стоят в тексте с подписями', () => {
    const html = renderHelpDoc('manager')!.html
    expect(html).toContain('<img src="/manual/img/manager/01-projects.png"')
    expect(html).toContain('<figcaption>Рис. 1. Список проектов</figcaption>')
  })

  it('ссылки на другие инструкции ведут внутрь программы', () => {
    for (const d of HELP_DOCS) {
      for (const m of helpSource(d.file).matchAll(/\]\(([^)\s]+\.md)\)/g)) {
        if (m[1]!.startsWith('Список_скриншотов')) continue
        expect(helpLinkTarget(m[1]!), `${d.file} → ${m[1]}`).not.toBeNull()
      }
    }
  })

  it('пометка «О рисунках» с отсылкой к перечню скриншотов не показывается', () => {
    for (const d of HELP_DOCS) expect(renderHelpDoc(d.slug)!.html).not.toContain('Список_скриншотов')
  })

  it('по умолчанию — инструкция своей роли', () => {
    expect(defaultHelpDoc('ADMIN')).toBe('admin')
    expect(defaultHelpDoc('ENGINEER')).toBe('manager')
    expect(defaultHelpDoc('BUYER')).toBe('buyer')
    expect(defaultHelpDoc('VIEWER')).toBe('general')
    expect(defaultHelpDoc(null)).toBe('general')
  })

  it('незнакомая инструкция — null, а не падение', () => {
    expect(renderHelpDoc('нет-такой')).toBeNull()
  })
})
