/**
 * Производные ОЛ КНС: смена единиц расхода пересчитывает само значение.
 *
 * Держит дефект: переключатель «л/с · м³/ч · м³/сут» менял только подпись,
 * и 25,13 л/с становились 25,13 м³/ч — в 3,6 раза меньше, а вслед уезжали
 * глубина и подбор насоса.
 */
import { nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { makeDefaultKnsSurvey } from '@/types/survey'
import type { FlowUnit } from '@/engines/survey-kns'
import { useKnsSurvey } from './useKnsSurvey'

describe('useKnsSurvey — единицы расхода', () => {
  it('смена единиц пересчитывает расход, а глубина не меняется', async () => {
    const form = ref({ ...makeDefaultKnsSurvey(), rashod: '25,13', rashodUnit: 'l/s' as FlowUnit })
    const s = useKnsSurvey(form)
    const depthBefore = s.depthMm.value

    form.value.rashodUnit = 'm3/h'
    await nextTick()

    expect(form.value.rashod).toBe('90,47')
    // Воды столько же — значит, и подобранная глубина та же.
    expect(s.depthMm.value).toBe(depthBefore)
  })

  it('туда и обратно возвращает исходное значение', async () => {
    const form = ref({ ...makeDefaultKnsSurvey(), rashod: '25,13', rashodUnit: 'l/s' as FlowUnit })
    useKnsSurvey(form)

    form.value.rashodUnit = 'm3/day'
    await nextTick()
    expect(form.value.rashod).toBe('2171,23')

    form.value.rashodUnit = 'l/s'
    await nextTick()
    expect(form.value.rashod).toBe('25,13')
  })

  it('цепочка переключений не копит ошибку округления', async () => {
    // л/с → м³/ч → м³/сут: считаем от введённых 25,13 л/с, а не от
    // показанных 90,47 м³/ч — иначе вышло бы 2171,28 вместо 2171,23.
    const form = ref({ ...makeDefaultKnsSurvey(), rashod: '25,13', rashodUnit: 'l/s' as FlowUnit })
    useKnsSurvey(form)

    form.value.rashodUnit = 'm3/h'
    await nextTick()
    form.value.rashodUnit = 'm3/day'
    await nextTick()
    expect(form.value.rashod).toBe('2171,23')
  })

  it('ручной ввод становится новой точкой отсчёта', async () => {
    const form = ref({ ...makeDefaultKnsSurvey(), rashod: '25,13', rashodUnit: 'l/s' as FlowUnit })
    useKnsSurvey(form)

    form.value.rashodUnit = 'm3/h'
    await nextTick()
    form.value.rashod = '100' // инженер ввёл 100 м³/ч
    await nextTick()
    form.value.rashodUnit = 'l/s'
    await nextTick()
    expect(form.value.rashod).toBe('27,78') // 100 / 3,6
  })

  it('пустой расход при смене единиц остаётся пустым', async () => {
    const form = ref({ ...makeDefaultKnsSurvey(), rashod: '', rashodUnit: 'l/s' as FlowUnit })
    useKnsSurvey(form)

    form.value.rashodUnit = 'm3/h'
    await nextTick()
    expect(form.value.rashod).toBe('')
  })
})

// По ТТ МВК изделие маркируется 8000 вместо 5000 и 12000 вместо 10000 — это
// та же труба. Пояснение стоит прямо под маркой, и без второй цифры «SN 10000»
// под «…-12000» читается как расхождение.
describe('useKnsSurvey — жёсткость и обозначение по ТТ МВК', () => {
  it('с ТТ МВК пояснение называет расчётную ступень и обозначение марки', () => {
    const form = ref({ ...makeDefaultKnsSurvey(), mvk: true })
    const s = useKnsSurvey(form)
    expect(s.snExplain.value).toMatch(/SN 10000 · в марке 12000/)
    expect(s.pipeMark.value).toContain('-12000')
  })

  it('без ТТ МВК — одна цифра: обозначение совпадает с расчётной', () => {
    const form = ref({ ...makeDefaultKnsSurvey(), mvk: false })
    const s = useKnsSurvey(form)
    expect(s.snExplain.value).toContain('SN 10000')
    expect(s.snExplain.value).not.toContain('в марке')
    expect(s.pipeMark.value).toContain('-10000')
  })
})
