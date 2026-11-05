import { describe, expect, it } from 'vitest'
import { estimateUrl, kpCommentText } from './b24-kp'

describe('КП в ленту сделки', () => {
  it('текст комментария: номер, версия, сумма, кто выпустил, ссылка', () => {
    const t = kpCommentText({
      number: 'КП-0142', version: 3, estimateTitle: 'КНС DN3000', projectTitle: 'КНС Протвино',
      totalRub: 1250000.4, authorName: 'Иванов Пётр', url: 'https://calc.ntt.su/calculator/e1',
    })
    const lines = t.split('\n')
    expect(lines[0]).toBe('[b]КП № КП-0142[/b] (версия 3) — КНС DN3000')
    expect(lines[1]).toBe('Проект: КНС Протвино')
    // Группы разрядов — неразрывным пробелом (ru-RU).
    expect(lines[2]!.replace(/\s/g, ' ')).toBe('Сумма: 1 250 000 ₽')
    expect(lines[3]).toBe('Выпустил: Иванов Пётр')
    expect(lines[4]).toBe('[url=https://calc.ntt.su/calculator/e1]Открыть расчёт в калькуляторе[/url]')
  })

  it('без номера, проекта и ссылки — строки опускаются', () => {
    const t = kpCommentText({ number: null, version: 1, estimateTitle: 'Ёмкость', projectTitle: null, totalRub: 10, authorName: null, url: null })
    expect(t.split('\n')).toHaveLength(2)
    expect(t).toContain('КП № б/н')
  })

  it('ссылка на расчёт из PUBLIC_URL', () => {
    expect(estimateUrl('https://calc.ntt.su/', 'e1')).toBe('https://calc.ntt.su/calculator/e1')
    expect(estimateUrl('', 'e1')).toBeNull()
    expect(estimateUrl(undefined, 'e1')).toBeNull()
    expect(estimateUrl('calc.ntt.su', 'e1')).toBeNull()
  })
})
