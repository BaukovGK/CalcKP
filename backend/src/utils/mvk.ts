import { mvkMinDiameterMm } from './pump-station-dimensions'
import { resolveRowQty, type TreeRow } from './estimate-tree'

type Dict = Record<string, unknown>
const obj = (v: unknown): Dict => v && typeof v === 'object' && !Array.isArray(v) ? v as Dict : {}
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : []
export function mvkNumber(v: unknown): number | null {
  if (typeof v !== 'number' && typeof v !== 'string') return null
  const text = String(v).replace(/\s/g, '').replace(',', '.')
  if (!text) return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

export function capacityM3day(form: Dict): number | null {
  const flow = mvkNumber(form.rashod)
  if (flow == null) return null
  const factor = form.rashodUnit === 'm3/day' ? 1 : form.rashodUnit === 'm3/h' ? 24 : 86.4
  return Number((flow * factor).toPrecision(12))
}

/** Выпуск КП не должен заявлять комплектацию, исключённую из расчёта. */
export function mvkIssues(device: string, surveyData: unknown): string[] {
  if (device !== 'KNS') return []
  const data = obj(surveyData)
  const form = Object.keys(obj(data.form)).length ? obj(data.form) : obj(data.kns)
  const tree = obj(data.tree)
  const survey = obj(tree.survey)
  if (form.mvk !== true && obj(data.kns).mvk !== true && survey.mvk !== true) return []
  const issues: string[] = []
  const min = mvkMinDiameterMm(mvkNumber(form.nRab) ?? 1)
  if ((mvkNumber(form.dn) ?? 0) < min || (mvkNumber(survey.dn) ?? 0) < min) issues.push(`Корпус МВК должен быть не меньше ${min} мм; обновите опросный лист и пересоберите расчёт`)
  if (form.shu !== true || form.shuPusk !== 'плавный') issues.push('Обязателен ШУ с плавным пуском')
  if (form.datchikiDavl !== true) issues.push('Обязателен общепромышленный датчик давления с боковой врезкой')
  if (form.datchikiUrov !== true) issues.push('Обязателен датчик уровня в перфорированном футляре до 0.000')
  if (form.emergency !== true) issues.push('Обязателен аварийный трубопровод с Рот-гайкой')
  if (form.drobilka !== 'корзина' && form.drobilka !== 'обе') issues.push('Обязательна корзина из нержавеющей стали')
  const capacity = mvkNumber(obj(data.derived).capacityM3day) ?? capacityM3day(form)
  if (capacity == null || capacity <= 0) issues.push('Укажите производительность станции для проверки расходомера МВК')
  const meter = capacity != null && capacity > 200
  if ((mvkNumber(form.napKol) ?? 0) < 1 || (mvkNumber(form.podvKol) ?? 0) < 1) issues.push('МВК: укажите хотя бы один подводящий и один напорный патрубок')
  if (meter && form.rashodomer !== true) issues.push('При производительности больше 200 м³/сут обязателен электромагнитный расходомер')

  const components = arr(tree.sections).flatMap((s) => obj(s).enabled === false ? [] : arr(obj(s).components))
    .map(obj).filter((c) => c.enabled !== false)
  const has = (slot: string, row: (r: TreeRow) => boolean, qty = 1): boolean => components.some((c) => c.slot === slot &&
    arr(c.rows).some((raw) => { const r = obj(raw) as TreeRow; return r.enabled !== false && row(r) && (resolveRowQty(r).qty ?? 0) > 0 && (resolveRowQty(r).qty ?? 0) >= qty }))
  const need = (slot: string, pattern: RegExp, label: string, qty = 1) => {
    if (!has(slot, (r) => pattern.test(r.name ?? ''), qty)) issues.push(`В расчёте отсутствует или выключен обязательный узел: ${label}`)
  }
  need('kns.vent#vent', /Приточно-вытяжная.*механическим.*нержавеющей/, 'механическая вентиляция из нержавеющей стали')
  need('kns.mvkService#platform', /Площадка обслуживания/, 'площадка обслуживания')
  need('kns.mvkService#hatches', /люки.*нержавеющей/, 'откидывающиеся люки из нержавеющей стали')
  need('kns.mvkService#interceptor', /Перехватывающее/, 'перехватывающее устройство')
  need('kns.basket#0', /Лист нержавеющий перфорированный/, 'корзина из нержавеющей стали', 0)
  need('kns.automation#0', /пуск плавный/, 'ШУ с плавным пуском')
  need('kns.automation#1', /Датчик давления общепромышленного/, 'датчик давления', mvkNumber(form.napKol) ?? 1)
  need('kns.automation#2', /Погружной датчик уровня/, 'датчик уровня')
  need('kns.automation#2', /Труба ПЭ.*110/, 'футляр датчика уровня до 0.000', (mvkNumber(obj(data.derived).npodzMm) ?? 0) / 1000)
  need('kns.pressurePipe#emergency', /Гайка пожарная ГМ/, 'Рот-гайка аварийного трубопровода')
  need('kns.valves#0', /Задвижка шиберная.*удлиненным штоком/, 'шиберная задвижка со штоком до 0.000', Math.max(1, mvkNumber(form.podvKol) ?? 1))
  if (meter) need('kns.automation#3', /Расходомер электромагнитный/, 'электромагнитный расходомер', mvkNumber(form.napKol) ?? 1)
  return issues
}
