/**
 * Окно «Сообщить о проблеме»: откуда берутся скриншоты, какие принимаются и
 * что прикладывается к тексту само.
 *
 * Пределы — те же, что проверяет сервер (`backend/src/utils/bug-reports.ts`):
 * пять картинок PNG, JPEG, GIF или WebP, до 4 МБ каждая. Экран проверяет их
 * заранее, чтобы сотрудник узнал об отказе, пока отчёт ещё перед глазами, а не
 * после отправки.
 *
 * @module utils/bug-report
 */

export const MAX_SCREENSHOTS = 5
export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024
export const MAX_TEXT_LENGTH = 10_000

export const SCREENSHOT_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
/** Для `<input type="file" accept>`. */
export const SCREENSHOT_ACCEPT = SCREENSHOT_TYPES.join(',')

/**
 * Картинки из буфера обмена или перетаскивания. Снимок экрана (Win+Shift+S,
 * PrtSc, Cmd+Ctrl+Shift+4) лежит в буфере файлом — его и берём; текст в
 * буфере сюда не относится.
 */
export function imagesFromTransfer(dt: Pick<DataTransfer, 'items' | 'files'> | null): File[] {
  if (!dt) return []
  const fromItems = Array.from(dt.items ?? [])
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter((f): f is File => f !== null)
  if (fromItems.length) return fromItems
  return Array.from(dt.files ?? []).filter((f) => f.type.startsWith('image/'))
}

/**
 * Имя вставленной картинки. У всего, что пришло из буфера, имя одно —
 * «image.png», и в отчёте такие не различить.
 */
export function pastedName(index: number, type: string): string {
  const ext = type === 'image/jpeg' ? 'jpg' : (type.split('/')[1] ?? 'png')
  return `Скриншот ${index}.${ext}`
}

/** Размер файла для подписи: «850 КБ», «2,4 МБ». */
export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ`
}

export interface ScreenshotPick {
  accepted: File[]
  /** Что не взято и почему — показывается под полем. */
  problems: string[]
}

/**
 * Какие из новых файлов добавить к уже прикреплённым: картинки нужных типов,
 * всего не больше пяти. Крупные здесь не отсекаются — их пережимает
 * {@link fitScreenshot}.
 */
export function pickScreenshots(attached: number, incoming: readonly File[]): ScreenshotPick {
  const accepted: File[] = []
  const problems: string[] = []
  for (const f of incoming) {
    if (!SCREENSHOT_TYPES.includes(f.type)) {
      problems.push(`«${f.name}» — не картинка PNG, JPEG, GIF или WebP`)
    } else if (attached + accepted.length >= MAX_SCREENSHOTS) {
      problems.push(`Скриншотов не больше ${MAX_SCREENSHOTS} — «${f.name}» не добавлен`)
    } else {
      accepted.push(f)
    }
  }
  return { accepted, problems }
}

/**
 * Уложить картинку в предел: крупный скриншот (экран 4K в PNG — 5–8 МБ)
 * пережимается в JPEG, а если и так не влезает — ещё и уменьшается.
 *
 * @returns файл в пределе; `null` — браузер пережимать не умеет или даже
 *   уменьшенная картинка не влезла.
 */
export async function fitScreenshot(file: File, maxBytes = MAX_SCREENSHOT_BYTES): Promise<File | null> {
  if (file.size <= maxBytes) return file
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }
  try {
    for (const scale of [1, 0.75, 0.5, 0.35]) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      // У JPEG нет прозрачности: без подложки прозрачное стало бы чёрным.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
      if (blob && blob.size <= maxBytes) {
        return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' })
      }
    }
    return null
  } finally {
    bitmap.close()
  }
}

/** Экраны по имени маршрута — подпись страницы в отчёте. */
const SCREEN_LABELS: Readonly<Record<string, string>> = {
  login: 'Вход',
  password: 'Смена пароля',
  dashboard: 'Проекты',
  project: 'Проект',
  survey: 'Опросный лист',
  calculator: 'Расчёт',
  'kp-issue': 'Выпуск КП',
  'purchase-request': 'Заявка на закупку',
  prices: 'Прайс',
  templates: 'Шаблоны',
  settings: 'Настройки',
  admin: 'Администрирование',
}

/** Подпись экрана; незнакомый маршрут — заголовком вкладки. */
export function screenLabel(routeName: unknown, fallback: string): string {
  return (typeof routeName === 'string' && SCREEN_LABELS[routeName]) || fallback
}
