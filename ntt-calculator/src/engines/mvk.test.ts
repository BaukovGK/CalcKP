import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { makeDefaultKnsSurvey } from '@/types/survey'
import { useKnsSurvey } from '@/composables/useKnsSurvey'
import { materializeKns } from './materialize'
import { SAMPLE_SURVEYS } from './template-samples'
import { mvkFlowMeterRequired } from './mvk'
import { flattenRows, type MaterializeContext } from './template-kns'
import { mvkIssues } from '../../../backend/src/utils/mvk'
import { buildProductDraft } from '../../../backend/src/utils/kp-kit'

const ctx: MaterializeContext = { priceOf: () => null, pipeWeightOf: () => 100, nozzleNormOf: () => null, priceListVersion: 1 }

function station(capacity = 201, pumpsWorking = 2) {
  const params = { ...SAMPLE_SURVEYS.KNS, mvk: true, dn: pumpsWorking === 1 ? 2500 : 2800, capacityM3day: capacity, pumpsWorking }
  const tree = materializeKns(ctx, params)
  const form = { ...makeDefaultKnsSurvey(), mvk: true, dn: String(params.dn), nRab: String(pumpsWorking), nRez: '1',
    rashod: String(capacity), rashodUnit: 'm3/day', shu: true, shuPusk: 'плавный', emergency: true,
    drobilka: 'корзина', datchikiDavl: true, datchikiUrov: true, rashodomer: capacity > 200 }
  return { form, kns: { ...form }, derived: { npodzMm: params.depthMm, gates: 1 }, tree }
}

describe('СТО МВК: ОЛ, состав расчёта, КП и серверный контроль', () => {
  it.each([1, 2])('схема %i+1: согласованный состав проходит серверный контроль', (pumps) => {
    expect(mvkIssues('KNS', station(201, pumps))).toEqual([])
  })

  it.each([199, 200, 200.001, 201])('граница расходомера: %s м³/сут', (capacity) => {
    const saved = station(capacity)
    const meter = saved.tree.sections.flatMap((s) => s.components).find((c) => c.slot === 'kns.automation#3')!
    expect(meter.enabled).toBe(capacity > 200)
    expect(mvkIssues('KNS', saved)).toEqual([])
  })

  it.each(['l/s', 'm3/h', 'm3/day'] as const)('порог в единицах %s', (unit) => {
    const factor = unit === 'l/s' ? 86.4 : unit === 'm3/h' ? 24 : 1
    expect(mvkFlowMeterRequired(200 / factor, unit)).toBe(false)
    expect(mvkFlowMeterRequired(200.001 / factor, unit)).toBe(true)
  })

  it.each([true, false])('снижение расхода выключает прибор в форме и расчёте (МВК %s)', async (mvk) => {
    const form = ref({ ...makeDefaultKnsSurvey(), mvk, rashod: '201', rashodUnit: 'm3/day' as const, rashodomer: true })
    const s = useKnsSurvey(form)
    form.value.rashod = '199'
    await nextTick()
    expect(form.value.rashodomer).toBe(false)
    expect(s.flowMeterNotNeeded.value).toBe(true)
    const saved = station(199)
    saved.form.mvk = mvk
    saved.form.rashodomer = true // старый сохранённый выбор не возвращает прибор
    saved.tree = materializeKns(ctx, { ...SAMPLE_SURVEYS.KNS, mvk, capacityM3day: 199, hasFlowMeter: true })
    const components = saved.tree.sections.flatMap((section) => section.components)
    expect(components.find((c) => c.slot === 'kns.automation#3')!.enabled).toBe(false)
    const flange = components.filter((c) => c.slot?.startsWith('kns.pressurePipe#')).flatMap((c) => c.rows)
      .find((r) => r.name.startsWith('Фланец свободный'))!
    // Три установленных насоса × 3 + два напорных патрубка, без четырёх фланцев расходомеров.
    expect(flange.qtyCalc).toBe(11)
    expect(buildProductDraft('KNS', saved, {}).kit.some((item) => item.name.includes('Расходомер'))).toBe(false)
  })

  it.each([true, false])('ровно 200 сохраняет ручной выбор расходомера (МВК %s)', (mvk) => {
    const form = ref({ ...makeDefaultKnsSurvey(), mvk, rashod: '200', rashodUnit: 'm3/day' as const, rashodomer: true })
    const s = useKnsSurvey(form)
    expect(form.value.rashodomer).toBe(true)
    expect(s.flowMeterNotNeeded.value).toBe(false)
    expect(s.mvkFlowMeter.value).toBe(false)
  })

  it('включение МВК исправляет несовместимый лист и сохраняет выбранную дробилку', async () => {
    const form = ref({ ...makeDefaultKnsSurvey(), mvk: false, dn: '2000', nRab: '1', emergency: false,
      shu: false, shuPusk: 'ЧП' as const, datchikiDavl: false, datchikiUrov: false, rashodomer: false,
      drobilka: 'дробилка' as const, zadvManual: '0' })
    const s = useKnsSurvey(form)
    form.value.mvk = true
    await nextTick()
    expect(form.value).toMatchObject({ dn: '2500', shu: true, shuPusk: 'плавный', emergency: true,
      datchikiDavl: true, datchikiUrov: true, drobilka: 'обе', rashodomer: true, zadvManual: '' })
    form.value.nRab = '2'
    await nextTick()
    expect(form.value.dn).toBe('2800')
    expect(s.mvkMinDn.value).toBe(2800)
    // При выключении МВК инженер снова может выбирать оборудование.
    form.value.mvk = false
    form.value.shu = false
    await nextTick()
    expect(form.value.shu).toBe(false)
  })

  it('нажатие МВК применяет связанные переключатели сразу, до чтения и сохранения формы', () => {
    const form = ref({ ...makeDefaultKnsSurvey(), mvk: false, dn: '2000', nRab: '2', emergency: false,
      shu: false, shuPusk: 'ЧП' as const, datchikiDavl: false, datchikiUrov: false, rashodomer: false,
      drobilka: 'дробилка' as const })
    const s = useKnsSurvey(form)
    s.setMvk(true)
    expect(form.value).toMatchObject({ mvk: true, dn: '2800', shu: true, shuPusk: 'плавный',
      emergency: true, datchikiDavl: true, datchikiUrov: true, rashodomer: true, drobilka: 'обе' })
  })

  it.each([200, 200.001])('смена единиц сохраняет проверку точного порога %s', async (capacity) => {
    const form = ref({ ...makeDefaultKnsSurvey(), mvk: true, rashod: String(capacity), rashodUnit: 'm3/day' as const, rashodomer: false })
    const s = useKnsSurvey(form)
    for (const unit of ['m3/h', 'l/s', 'm3/day'] as const) {
      Object.assign(form.value, { rashodUnit: unit })
      await nextTick()
      expect(s.mvkFlowMeter.value).toBe(capacity > 200)
      expect(form.value.rashodomer).toBe(capacity > 200)
      // Повторное открытие округлённого ОЛ сохраняет обязательность.
      const reopened = useKnsSurvey(ref({ ...form.value }))
      expect(reopened.mvkFlowMeter.value).toBe(capacity > 200)
    }
  })

  it.each(['kns.vent#vent', 'kns.mvkService#hatches', 'kns.mvkService#interceptor', 'kns.basket#0',
    'kns.automation#0', 'kns.automation#1', 'kns.automation#2', 'kns.automation#3', 'kns.pressurePipe#emergency', 'kns.valves#0'])
  ('удаление или выключение %s блокирует выпуск', (slot) => {
    const saved = station()
    const component = saved.tree.sections.flatMap((s) => s.components).find((c) => c.slot === slot)!
    component.enabled = false
    expect(mvkIssues('KNS', saved).length).toBeGreaterThan(0)
  })

  it('нулевое ручное количество обязательной строки блокирует выпуск', () => {
    const saved = station()
    const ventilation = flattenRows(saved.tree).find((r) => r.name.startsWith('Приточно-вытяжная'))!
    ventilation.qtyManual = '0'
    expect(mvkIssues('KNS', saved).join(' ')).toContain('механическая вентиляция')
  })

  it('обязательные узлы достраиваются в шаблоне технолога', () => {
    const custom = { deviceType: 'KNS' as const, version: 5, body: { sections: [{ title: 'Корпус', nodes: [{ kind: 'builtin' as const, ref: 'kns.shell' }] }] } }
    const saved = station()
    saved.tree = materializeKns({ ...ctx, templateOf: () => custom }, { ...SAMPLE_SURVEYS.KNS, mvk: true, dn: 2800, capacityM3day: 201 })
    expect(mvkIssues('KNS', saved)).toEqual([])
    expect(custom.body.sections).toHaveLength(1)
    expect(saved.tree.templateVersion).toBe(5)
  })

  it('КП содержит требования МВК и не содержит вентиляцию ПВХ', () => {
    const saved = station()
    const all = buildProductDraft('KNS', saved, {}).kit.map((i) => i.name).join('\n')
    for (const part of ['механическим побуждением', 'люки площадки', 'Перехватывающее', 'Рот-гайкой', 'общепромышленного',
      'боковую часть трубы', 'перфорацией до отметки 0.000', 'удлинённым штоком до отметки 0.000', 'электромагнитный', 'с плавным пуском']) expect(all).toContain(part)
    expect(all).not.toContain('дефлектором ПВХ')
  })

  it('обычная КНС и другие изделия не получают ограничения МВК', () => {
    expect(mvkIssues('KNS', { form: { mvk: false } })).toEqual([])
    expect(mvkIssues('EMK', station())).toEqual([])
    const tree = materializeKns(ctx, { ...SAMPLE_SURVEYS.KNS, mvk: false, dn: 2000 })
    expect(tree.survey.dn).toBe(2000)
    expect(flattenRows(tree).some((r) => r.name === 'Дефлектор ПВХ Ду110')).toBe(true)
  })

  it('высота вне ряда кабелей сохраняет требование общепромышленного датчика', () => {
    const saved = station()
    saved.derived.npodzMm = 25000
    saved.tree = materializeKns(ctx, { ...SAMPLE_SURVEYS.KNS, mvk: true, dn: 2800, depthMm: 25000, capacityM3day: 201 })
    expect(mvkIssues('KNS', saved)).toEqual([])
    const pressure = flattenRows(saved.tree).find((r) => r.name.startsWith('Датчик давления'))!
    expect(pressure.priceCatalog).toBeNull()
    expect(pressure.name).toContain('общепромышленного применения')
  })
})
