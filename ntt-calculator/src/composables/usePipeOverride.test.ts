/**
 * Ручной SN трубы корпуса — только ступени завода (решение Р9,
 * План_устранения 3.8).
 */
import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { legacySnManual, SN_MANUAL_OPTIONS, usePipeOverride } from './usePipeOverride'

describe('ручной SN', () => {
  it('предлагаются только 5000 и 10000 — для 1250 нет даже веса трубы', () => {
    expect(SN_MANUAL_OPTIONS).toEqual(['5000', '10000'])
  })

  it('выбранное до правила завода узнаётся, выбранное из списка и расчётное — нет', () => {
    expect(legacySnManual('2500')).toBe('2500')
    expect(legacySnManual('1250')).toBe('1250')
    expect(legacySnManual('5000')).toBeNull()
    expect(legacySnManual('10000')).toBeNull()
    expect(legacySnManual('')).toBeNull()
  })

  it('прежний выбор лист считает как раньше — итог сохранённого расчёта сам не меняется', () => {
    const form = ref({ pipeManual: true, pnManual: '', snManual: '2500' })
    const { sn } = usePipeOverride(form, computed(() => 5000))
    expect(sn.value).toBe(2500)
    form.value.snManual = '10000'
    expect(sn.value).toBe(10000)
    form.value.pipeManual = false
    expect(sn.value).toBe(5000)
  })
})
