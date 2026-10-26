/**
 * Инструкции пользователя — экран «Инструкции» (views/HelpView.vue).
 *
 * Тексты — src/help/*.md, как их пишет автор инструкций: файл заменяется
 * новой редакцией целиком, без правок под программу. Рисунки — в
 * public/manual/img с теми же путями, что в тексте (`img/admin/01-….png`).
 */
import { renderMarkdown, type RenderedDoc } from './markdown'
import type { UserRole } from '@/stores/auth'

export interface HelpDocInfo {
  slug: string
  /** Имя файла — по нему инструкции ссылаются друг на друга. */
  file: string
  label: string
}

export const HELP_DOCS: readonly HelpDocInfo[] = [
  { slug: 'general', file: '00_Общая_инструкция.md', label: 'Общая инструкция' },
  { slug: 'admin', file: '01_Администратор.md', label: 'Администратор' },
  { slug: 'manager', file: '02_Менеджер.md', label: 'Менеджер' },
  { slug: 'technolog', file: '03_Технолог.md', label: 'Технолог' },
  { slug: 'buyer', file: '04_Закупщик.md', label: 'Закупщик (Снабженец)' },
]

const SOURCES = import.meta.glob('../help/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** Текст инструкции по имени файла; нет такого — пустая строка. */
export function helpSource(file: string): string {
  return SOURCES[`../help/${file}`] ?? ''
}

const BY_FILE = new Map(HELP_DOCS.map((d) => [d.file, d.slug]))

/** Ссылка из текста на другую инструкцию → её ключ. */
export function helpLinkTarget(href: string): string | null {
  const file = decodeURIComponent(href.split('#')[0]!.replace(/^\.\//, ''))
  return BY_FILE.get(file) ?? null
}

/** Путь рисунка из текста → адрес на сервере. */
export function helpImage(src: string): string {
  // Не /help: так называется сам экран, и nginx принял бы адрес экрана за
  // каталог с рисунками (403 вместо страницы).
  return `${import.meta.env.BASE_URL}manual/${src.replace(/^\.\//, '')}`
}

const cache = new Map<string, RenderedDoc>()

export function renderHelpDoc(slug: string): RenderedDoc | null {
  const info = HELP_DOCS.find((d) => d.slug === slug)
  if (!info) return null
  let doc = cache.get(slug)
  if (!doc) {
    doc = renderMarkdown(helpSource(info.file), {
      image: helpImage,
      doc: helpLinkTarget,
      // «О рисунках» отсылает к перечню скриншотов — он для автора, не для читателя.
      skipQuote: (t) => t.includes('Список_скриншотов'),
    })
    cache.set(slug, doc)
  }
  return doc
}

/** С какой инструкции начать: со своей роли, без своей — с общей. */
export function defaultHelpDoc(role: UserRole | null | undefined): string {
  switch (role) {
    case 'ADMIN': return 'admin'
    case 'MANAGER':
    case 'ENGINEER': return 'manager'
    case 'TECHNOLOG': return 'technolog'
    case 'BUYER': return 'buyer'
    default: return 'general'
  }
}
