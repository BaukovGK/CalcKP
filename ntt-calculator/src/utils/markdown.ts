/**
 * Markdown инструкций (src/help/*.md) → HTML для экрана «Инструкции».
 *
 * Не общий разборщик, а ровно то, что есть в инструкциях: заголовки, абзацы,
 * списки (в том числе вложенные), таблицы с выравниванием, цитаты, блок
 * кода, разделитель, рисунок отдельной строкой, ссылки, полужирный и код в
 * строке. Тексты лежат в репозитории, но HTML всё равно экранируется: в них
 * встречаются «<» и «>», и разметкой они быть не должны.
 */

export interface TocItem {
  id: string
  text: string
  level: number
}

export interface RenderedDoc {
  /** Заголовок первого уровня — в топбар; в тело он не попадает. */
  title: string
  html: string
  /** Заголовки второго и третьего уровня — оглавление в боковой панели. */
  toc: TocItem[]
}

export interface RenderOptions {
  /** Адрес рисунка из пути в тексте (`img/admin/01.png`). */
  image?: (src: string) => string
  /** Ссылка на другую инструкцию (`02_Менеджер.md`) — её ключ, иначе null. */
  doc?: (href: string) => string | null
  /** Цитата, которую в программе показывать не нужно (служебная пометка). */
  skipQuote?: (text: string) => boolean
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Строка без разметки — для оглавления и подписей. */
function plain(s: string): string {
  return s.replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
}

function inline(src: string, o: RenderOptions): string {
  // Код в строке — как есть: внутри него разметки нет.
  return src.split(/(`[^`]*`)/).map((part) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) return `<code>${esc(part.slice(1, -1))}</code>`
    let s = esc(part)
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt: string, href: string) =>
      `<img src="${esc((o.image ?? ((x) => x))(href))}" alt="${alt}" loading="lazy">`)
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text: string, href: string) => {
      const doc = o.doc?.(href) ?? null
      if (doc) return `<a href="#" data-doc="${esc(doc)}">${text}</a>`
      if (/^https?:/.test(href)) return `<a href="${href}" target="_blank" rel="noopener">${text}</a>`
      return text
    })
    return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  }).join('')
}

const isBlank = (l: string) => l.trim() === ''
const indentOf = (l: string) => l.length - l.trimStart().length
const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/
const FIGURE = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/
// «:-:» — с одним дефисом: так выровнены столбцы «✓» в таблице ролей.
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

/** Начало другого блока — абзац на нём заканчивается. */
function startsBlock(lines: string[], i: number): boolean {
  const l = lines[i]!
  return HEADING.test(l) || RULE.test(l) || l.trimStart().startsWith('>') || l.trimStart().startsWith('```') ||
    LIST.test(l) || FIGURE.test(l) || (l.trimStart().startsWith('|') && TABLE_SEP.test(lines[i + 1] ?? ''))
}

export function renderMarkdown(src: string, o: RenderOptions = {}): RenderedDoc {
  const toc: TocItem[] = []
  let title = ''
  let seq = 0
  const html = blocks(src.replace(/\r\n?/g, '\n').split('\n'), true)
  return { title, html, toc }

  function blocks(lines: string[], top: boolean): string {
    const out: string[] = []
    let i = 0
    while (i < lines.length) {
      const l = lines[i]!
      if (isBlank(l)) { i++; continue }

      if (l.trimStart().startsWith('```')) {
        const body: string[] = []
        i++
        while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) body.push(lines[i++]!)
        i++
        out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`)
        continue
      }

      const h = HEADING.exec(l)
      if (h) {
        const level = h[1]!.length
        const text = h[2]!
        i++
        if (level === 1 && top && !title) { title = plain(text); continue }
        const id = `s${++seq}`
        if (top && (level === 2 || level === 3)) toc.push({ id, text: plain(text), level })
        out.push(`<h${level} id="${id}">${inline(text, o)}</h${level}>`)
        continue
      }

      if (RULE.test(l)) { out.push('<hr>'); i++; continue }

      if (l.trimStart().startsWith('>')) {
        const body: string[] = []
        while (i < lines.length && lines[i]!.trimStart().startsWith('>')) body.push(lines[i++]!.trimStart().replace(/^>\s?/, ''))
        const text = body.join('\n')
        if (!o.skipQuote?.(text)) out.push(`<blockquote>${blocks(body, false)}</blockquote>`)
        continue
      }

      if (l.trimStart().startsWith('|') && TABLE_SEP.test(lines[i + 1] ?? '')) {
        const head = cells(l)
        const align = cells(lines[i + 1]!).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''))
        i += 2
        const rows: string[][] = []
        while (i < lines.length && lines[i]!.trimStart().startsWith('|')) rows.push(cells(lines[i++]!))
        const td = (tag: string, c: string, k: number) => `<${tag}${align[k] ? ` class="al-${align[k]}"` : ''}>${inline(c, o)}</${tag}>`
        out.push(
          '<div class="tbl-wrap"><table>' +
          `<thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead>` +
          `<tbody>${rows.map((r) => `<tr>${head.map((_, k) => td('td', r[k] ?? '', k)).join('')}</tr>`).join('')}</tbody>` +
          '</table></div>',
        )
        continue
      }

      const fig = FIGURE.exec(l)
      if (fig) {
        const [, alt, href] = fig
        const url = esc((o.image ?? ((x) => x))(href!))
        out.push(`<figure><a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${esc(alt!)}" loading="lazy"></a><figcaption>${inline(alt!, o)}</figcaption></figure>`)
        i++
        continue
      }

      if (LIST.test(l)) {
        const [html, next] = list(lines, i)
        out.push(html)
        i = next
        continue
      }

      const para: string[] = [l.trim()]
      i++
      while (i < lines.length && !isBlank(lines[i]!) && !startsBlock(lines, i)) para.push(lines[i++]!.trim())
      out.push(`<p>${inline(para.join(' '), o)}</p>`)
    }
    return out.join('\n')
  }

  /** Список с отступом первой строки; пункты — до строки с меньшим отступом. */
  function list(lines: string[], start: number): [string, number] {
    const first = LIST.exec(lines[start]!)!
    const base = first[1]!.length
    const ordered = /\d/.test(first[2]!)
    const items: string[] = []
    let i = start
    while (i < lines.length) {
      const m = LIST.exec(lines[i]!)
      if (!m || m[1]!.length !== base || /\d/.test(m[2]!) !== ordered) break
      const text: string[] = [m[3]!]
      const nested: string[] = []
      i++
      while (i < lines.length) {
        const l = lines[i]!
        if (isBlank(l)) {
          // Пустая строка внутри пункта — только если дальше идёт его продолжение.
          let j = i + 1
          while (j < lines.length && isBlank(lines[j]!)) j++
          if (j < lines.length && indentOf(lines[j]!) > base) { i = j; continue }
          // Следующий пункт того же списка через пустую строку — список не рвётся.
          const nx = j < lines.length ? LIST.exec(lines[j]!) : null
          if (nx && nx[1]!.length === base && /\d/.test(nx[2]!) === ordered) i = j
          break
        }
        if (indentOf(l) <= base) break
        if (LIST.test(l)) {
          const [sub, next] = list(lines, i)
          nested.push(sub)
          i = next
          continue
        }
        text.push(l.trim())
        i++
      }
      items.push(`<li>${inline(text.join(' '), o)}${nested.join('')}</li>`)
    }
    const startNo = ordered ? Number.parseInt(first[2]!, 10) : 1
    const tag = ordered ? `ol${startNo !== 1 ? ` start="${startNo}"` : ''}` : 'ul'
    return [`<${tag}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`, i]
  }
}
