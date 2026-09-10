/**
 * DN патрубка — только из ряда мастер-книги. Держит дефект: «2850» в поле DN
 * принималось как есть и уходило в наименования строк расчёта.
 */
import { describe, expect, it } from 'vitest'
import { acceptDn, NOZZLE_DN_SERIES, snapToSeries } from './dn-series'

describe('acceptDn — ввод поля DN', () => {
  it('2850 заменяется краем ряда, и видно, что было введено', () => {
    expect(acceptDn('2850')).toEqual({ text: '1600', from: 2850 })
  })

  it('значение из ряда принимается без замены', () => {
    expect(acceptDn('250')).toEqual({ text: '250', from: null })
  })

  it('выражение считается, как в любом числовом поле', () => {
    expect(acceptDn('2*100')).toEqual({ text: '200', from: null })
  })

  it('пустое и неразобранное не трогает', () => {
    expect(acceptDn('')).toBeNull()
    expect(acceptDn('2**3')).toBeNull()
  })
})

describe('snapToSeries', () => {
  it('значение из ряда остаётся как есть', () => {
    for (const dn of NOZZLE_DN_SERIES) expect(snapToSeries(dn, NOZZLE_DN_SERIES)).toBe(dn)
  })

  it('вне ряда сверху — край ряда: 2850 → 1600', () => {
    expect(snapToSeries(2850, NOZZLE_DN_SERIES)).toBe(1600)
  })

  it('вне ряда снизу — начало ряда', () => {
    expect(snapToSeries(20, NOZZLE_DN_SERIES)).toBe(50)
  })

  it('наружный диаметр ПЭ-трубы превращается в её DN, а не в следующий размер', () => {
    expect(snapToSeries(315, NOZZLE_DN_SERIES)).toBe(300)
    expect(snapToSeries(160, NOZZLE_DN_SERIES)).toBe(150)
    expect(snapToSeries(110, NOZZLE_DN_SERIES)).toBe(100)
  })

  it('при равном удалении берётся больший: меньший мог бы не пропустить трубу', () => {
    expect(snapToSeries(125, NOZZLE_DN_SERIES)).toBe(150) // 100 и 150 — поровну
    expect(snapToSeries(1050, NOZZLE_DN_SERIES)).toBe(1100)
  })

  it('ряд сходится с мастер-книгой: без DN125, как и прайс арматуры', () => {
    expect(NOZZLE_DN_SERIES).not.toContain(125)
    expect(NOZZLE_DN_SERIES[0]).toBe(50)
    expect(NOZZLE_DN_SERIES[NOZZLE_DN_SERIES.length - 1]).toBe(1600)
  })
})
