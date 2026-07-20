import { computed, type Ref } from 'vue'
import { tryEvalExpr } from '@/engines/expr'
import {
  computeEmkGeometry,
  computeKolGeometry,
  tankMaterial,
  type Installation,
  type Placement,
} from '@/engines/survey-emk-kol'
import { snByDepth } from '@/engines/survey-kns'
import { usePipeOverride } from './usePipeOverride'
import type { EmkSurveyForm, KolSurveyForm } from '@/types/survey-emk-kol'

/**
 * Производные величины опросных листов ЕМК и КОЛ.
 *
 * Вся арифметика — в `engines/survey-emk-kol.ts` (чистые функции, покрыты
 * тестами); здесь только реактивная обвязка, как и для КНС.
 */

const num = (s: string): number | null => tryEvalExpr(s)

// ─── ЕМК ─────────────────────────────────────────────────────────────────────

export function useEmkSurvey(form: Ref<EmkSurveyForm>) {
  const geo = computed(() =>
    computeEmkGeometry({
      volumeM3: num(form.value.volumeM3) ?? 0,
      dn: num(form.value.dn) ?? 0,
      placement: form.value.placement as Placement,
      installation: form.value.installation as Installation,
      hasShaft: form.value.hasShaft,
    }),
  )

  /** Длина трубы: ручной ввод перекрывает расчётную из объёма. */
  const lengthMm = computed<number | null>(() => num(form.value.lengthManual) ?? geo.value.pipeLengthMm)
  const lengthOverridden = computed(() => num(form.value.lengthManual) != null)

  /** Габаритная длина с эллиптическими днищами (горизонтальная +1,5 м). */
  const overallMm = computed<number | null>(() =>
    lengthMm.value == null ? null : lengthMm.value + (form.value.placement === 'горизонтальное' ? 1500 : 0),
  )

  const snCalc = computed(() => (overallMm.value == null ? null : snByDepth(overallMm.value)))
  const { sn, pn } = usePipeOverride(form, snCalc)

  /** Материал зависит от среды: химстойкая → СК/ВЭС (эталон D8). */
  const material = computed(() => tankMaterial(form.value.tankType))

  const pipeMark = computed(() => {
    const dn = num(form.value.dn)
    if (dn == null || sn.value == null) return null
    return `${material.value}-К ${dn}-${pn.value.toLocaleString('ru-RU')}-${sn.value}`
  })

  const explain = computed(() => {
    if (lengthMm.value == null) return null
    const src = lengthOverridden.value ? 'ручной ввод' : `ƒ CEILING(4V/(π·D²)) из ${form.value.volumeM3} м³`
    return `длина трубы ${lengthMm.value.toLocaleString('ru-RU')} мм · ${src}${sn.value ? ` → SN ${sn.value}` : ''}`
  })

  const title = computed(() => {
    const dn = num(form.value.dn)
    if (dn == null || overallMm.value == null) return 'Ёмкость'
    const f = (n: number) => n.toLocaleString('ru-RU')
    return `Ёмкость ${f(dn)}×${f(overallMm.value)} мм · ${form.value.volumeM3} м³`
  })

  const missingRequired = computed<string[]>(() => {
    const m: string[] = []
    if (num(form.value.volumeM3) == null || (num(form.value.volumeM3) ?? 0) <= 0) m.push('объём ёмкости')
    if (num(form.value.dn) == null) m.push('DN корпуса')
    if (!form.value.zakazchik.trim()) m.push('заказчик')
    if (lengthMm.value == null) m.push('длина трубы')
    if (form.value.hasPumps && (num(form.value.nRab) ?? 0) < 1) m.push('кол-во рабочих насосов')
    return m
  })

  const canCreate = computed(() => missingRequired.value.length === 0)

  return { geo, lengthMm, lengthOverridden, overallMm, sn, snCalc, pn, material, pipeMark, explain, title, missingRequired, canCreate }
}

// ─── КОЛ ─────────────────────────────────────────────────────────────────────

export function useKolSurvey(form: Ref<KolSurveyForm>) {
  const geo = computed(() =>
    computeKolGeometry({
      workingDepthMm: num(form.value.depthMm) ?? 0,
      elevationMm: num(form.value.elevationMm) ?? 0,
      hasNeck: form.value.hasNeck,
      neckHeightMm: num(form.value.neckH) ?? 0,
      neckDiameterMm: num(form.value.neckD) ?? 0,
      underRoadway: form.value.underRoadway,
    }),
  )

  const snCalc = computed(() => geo.value.sn)
  const { sn, pn } = usePipeOverride(form, snCalc)

  const pipeMark = computed(() => {
    const dn = num(form.value.dn)
    if (dn == null || sn.value == null) return null
    return `СК/НПС-К ${dn}-${pn.value.toLocaleString('ru-RU')}-${sn.value}`
  })

  const explain = computed(() => {
    const d = geo.value.totalDepthMm
    const neck = form.value.hasNeck ? ` (с горловиной ${geo.value.neckHeightMm} мм)` : ''
    const road = form.value.underRoadway ? ' · проезжая часть → на ступень выше' : ''
    return `расчётные: глубина ${d.toLocaleString('ru-RU')} мм${neck} → SN ${sn.value}${road}`
  })

  const title = computed(() => {
    const dn = num(form.value.dn)
    if (dn == null) return 'Колодец'
    const f = (n: number) => n.toLocaleString('ru-RU')
    return `${form.value.wellType} колодец ${f(dn)}×${f(geo.value.totalDepthMm)} мм`
  })

  const missingRequired = computed<string[]>(() => {
    const m: string[] = []
    if (num(form.value.dn) == null) m.push('DN рабочей части')
    if (num(form.value.depthMm) == null || (num(form.value.depthMm) ?? 0) <= 0) m.push('глубина H')
    if (!form.value.zakazchik.trim()) m.push('заказчик')
    if (form.value.hasNeck && (num(form.value.neckD) == null || num(form.value.neckH) == null)) {
      m.push('размеры горловины')
    }
    return m
  })

  const canCreate = computed(() => missingRequired.value.length === 0)

  return { geo, sn, snCalc, pn, pipeMark, explain, title, missingRequired, canCreate }
}
