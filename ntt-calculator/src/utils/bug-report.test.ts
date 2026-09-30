// @vitest-environment jsdom
/**
 * Скриншоты к отчёту об ошибке: что берётся из буфера и перетаскивания, что
 * принимается и как называется.
 */
import { describe, expect, it } from 'vitest'
import {
  fileSizeLabel,
  fitScreenshot,
  imagesFromTransfer,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOTS,
  pastedName,
  pickScreenshots,
  screenLabel,
} from './bug-report'

const png = (name = 'shot.png', size = 10) => new File([new Uint8Array(size)], name, { type: 'image/png' })

/** Буфер обмена так, как его видит обработчик `paste`. */
function transfer(items: Array<{ kind: 'file' | 'string'; type: string; file?: File }>, files: File[] = []) {
  return {
    items: items.map((i) => ({ kind: i.kind, type: i.type, getAsFile: () => i.file ?? null })),
    files,
  } as unknown as DataTransfer
}

describe('imagesFromTransfer — картинки из буфера и перетаскивания', () => {
  it('снимок экрана в буфере — файлом, его и берём', () => {
    const shot = png('image.png')
    expect(imagesFromTransfer(transfer([{ kind: 'file', type: 'image/png', file: shot }]))).toEqual([shot])
  })

  // Текст в буфере — не скриншот: он вставляется в поле как обычно.
  it('текст и не картинки не берутся', () => {
    const pdf = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })
    const dt = transfer([
      { kind: 'string', type: 'text/plain' },
      { kind: 'file', type: 'application/pdf', file: pdf },
    ])
    expect(imagesFromTransfer(dt)).toEqual([])
  })

  it('перетаскивание без items — из files', () => {
    const shot = png()
    const doc = new File(['x'], 'a.txt', { type: 'text/plain' })
    expect(imagesFromTransfer(transfer([], [shot, doc]))).toEqual([shot])
  })

  it('буфера нет — картинок нет', () => {
    expect(imagesFromTransfer(null)).toEqual([])
  })
})

describe('pickScreenshots — что добавить к прикреплённым', () => {
  it('картинки нужных типов принимаются', () => {
    const files = ['a.png', 'b.jpg', 'c.gif', 'd.webp'].map((n, i) =>
      new File(['x'], n, { type: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'][i] }),
    )
    expect(pickScreenshots(0, files)).toEqual({ accepted: files, problems: [] })
  })

  // SVG — документ со скриптами: сервер его тоже не примет.
  it('SVG и не картинки — отказ с объяснением', () => {
    const svg = new File(['<svg/>'], 'схема.svg', { type: 'image/svg+xml' })
    const r = pickScreenshots(0, [svg])
    expect(r.accepted).toEqual([])
    expect(r.problems).toEqual(['«схема.svg» — не картинка PNG, JPEG, GIF или WebP'])
  })

  it('не больше пяти вместе с уже прикреплёнными', () => {
    const r = pickScreenshots(MAX_SCREENSHOTS - 1, [png('a.png'), png('b.png')])
    expect(r.accepted.map((f) => f.name)).toEqual(['a.png'])
    expect(r.problems).toEqual([`Скриншотов не больше ${MAX_SCREENSHOTS} — «b.png» не добавлен`])
  })
})

describe('fitScreenshot — предел размера', () => {
  it('в пределе — тот же файл, без пережатия', async () => {
    const f = png('a.png', 1000)
    expect(await fitScreenshot(f)).toBe(f)
  })

  // В jsdom нет createImageBitmap — как в старом браузере: пережать нечем.
  it('крупнее предела и пережать нечем — null', async () => {
    const big = png('big.png', MAX_SCREENSHOT_BYTES + 1)
    expect(await fitScreenshot(big)).toBeNull()
  })
})

describe('подписи', () => {
  it('вставленные из буфера различаются номером', () => {
    expect(pastedName(1, 'image/png')).toBe('Скриншот 1.png')
    expect(pastedName(2, 'image/jpeg')).toBe('Скриншот 2.jpg')
  })

  it('размер файла по-русски', () => {
    expect(fileSizeLabel(666)).toBe('666 Б')
    expect(fileSizeLabel(850 * 1024)).toBe('850 КБ')
    expect(fileSizeLabel(2.4 * 1024 * 1024)).toBe('2,4 МБ')
  })

  it('экран по маршруту; незнакомый — заголовком вкладки', () => {
    expect(screenLabel('calculator', 'НТТ')).toBe('Расчёт')
    expect(screenLabel('kp-issue', 'НТТ')).toBe('Выпуск КП')
    expect(screenLabel('нет-такого', 'НТТ Калькулятор')).toBe('НТТ Калькулятор')
    expect(screenLabel(undefined, 'НТТ Калькулятор')).toBe('НТТ Калькулятор')
  })
})
