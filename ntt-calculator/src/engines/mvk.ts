import type { KnsSurveyForm } from '@/types/survey'
import type { KnsSurveyParams } from './template-kns'
import { tryEvalExpr } from './expr'
import { toLps, type FlowUnit } from './survey-kns'

/** СТО МВК: 1+1 — 2500 мм, 2+1 — 2800 мм. */
export function mvkMinDiameterMm(workingPumps: number): number {
  return workingPumps >= 2 ? 2800 : 2500
}

/** Порог относится к станции целиком, независимо от числа рабочих насосов. */
export function mvkFlowMeterRequired(flow: number, unit: FlowUnit): boolean {
  return Number((toLps(flow, unit) * 86.4).toPrecision(12)) > 200
}

/** Поправки формы; исходные данные не мутируются, обычный ОЛ не меняется. */
export function mvkFormPatch(f: KnsSurveyForm, capacityM3day?: number): Partial<KnsSurveyForm> {
  const flow = tryEvalExpr(f.rashod)
  const capacity = capacityM3day ?? (flow == null ? null : Number((toLps(flow, f.rashodUnit) * 86.4).toPrecision(12)))
  const meterPatch: Partial<KnsSurveyForm> = capacity != null && capacity >= 0 && capacity < 200
    ? { rashodomer: false } : f.mvk && capacity != null && capacity > 200 ? { rashodomer: true } : {}
  if (!f.mvk) return meterPatch
  const min = mvkMinDiameterMm(tryEvalExpr(f.nRab) ?? 1)
  const dn = tryEvalExpr(f.dn)
  return {
    ...(dn != null && dn < min ? { dn: String(min) } : {}),
    emergency: true,
    drobilka: f.drobilka === 'дробилка' || f.drobilka === 'обе' ? 'обе' : 'корзина',
    shu: true,
    shuPusk: 'плавный',
    datchikiDavl: true,
    datchikiUrov: true,
    ...meterPatch,
    // Ручной override не может убрать задвижку с подводящей линии.
    ...(tryEvalExpr(f.zadvManual) != null && (tryEvalExpr(f.zadvManual) ?? 0) < (tryEvalExpr(f.podvKol) ?? 0)
      ? { zadvManual: '' } : {}),
  }
}

/** Защита сборки, включая старые ОЛ и предпросмотр шаблонов. */
export function applyMvkParams(s: KnsSurveyParams): KnsSurveyParams {
  if (s.capacityM3day != null && s.capacityM3day >= 0 && s.capacityM3day < 200) s = { ...s, hasFlowMeter: false }
  if (!s.mvk) return s
  return {
    ...s,
    dn: Math.max(s.dn, mvkMinDiameterMm(s.pumpsWorking)),
    emergencyPipeline: true,
    hasBasket: true,
    hasControlCabinet: true,
    controlCabinetStart: 'плавный',
    hasPressureSensors: true,
    hasLevelSensor: true,
    hasFlowMeter: Boolean(s.hasFlowMeter) || (s.capacityM3day ?? 0) > 200,
    gatesInletManual: s.gatesInletManual != null && s.gatesInletManual < s.inletCount ? null : s.gatesInletManual,
  }
}
