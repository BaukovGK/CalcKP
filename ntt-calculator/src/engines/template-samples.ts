/**
 * Примеры опросных листов — вход предпросмотра в редакторе шаблонов.
 *
 * Технолог не видит чужих расчётов (роль TECHNOLOG, Библиотека §6.2), поэтому
 * шаблон и узлы проверяются на типовых ОЛ, которые он может поправить прямо
 * в форме предпросмотра. Числа — типовые изделия из сценариев приёмки
 * (КНС DN3000 глубиной 11,6 м — ОЛ3487), цен в них нет.
 */

import type { DeviceType } from '@/types/device'
import type { DeviceSurvey } from './code-nodes'

export const SAMPLE_SURVEYS: { readonly [D in DeviceType]: DeviceSurvey[D] } = {
  KNS: {
    dn: 3000,
    depthMm: 11600,
    elevationMm: 200,
    pnSurvey: 0.1,
    sn: 10000,
    mvk: false,
    inletDn: 250,
    inletCount: 1,
    inletTrayDepthMm: 9910,
    outletDn: 150,
    outletCount: 2,
    pumpsWorking: 2,
    pumpsReserve: 1,
    pumpsSpare: 0,
    pumpModel: null,
    valveOnInlet: true,
    emergencyPipeline: false,
    hasFlowMeter: false,
    hasControlCabinet: true,
    controlCabinetType: 'уличный',
    controlCabinetStart: 'плавный',
    hasPressureSensors: true,
    hasLevelSensor: true,
    insulationEnabled: true,
    insulationDepthMm: 2000,
    hasBasket: true,
    hasGrinder: false,
    pipeExecution: 'целая',
  },
  EMK: {
    dn: 2000,
    volumeM3: 50,
    placement: 'вертикальное',
    installation: 'подземная',
    tankType: 'Накопительная',
    bottomType: 'эллиптические',
    pnSurvey: 0.1,
    sn: null,
    pipeLengthMm: null,
    hasLadder: true,
    ventilation: true,
    hasShaft: true,
    inletDn: 150,
    inletCount: 1,
    inletTrayDepthMm: 1500,
    outletDn: 150,
    outletCount: 1,
    hasPumps: false,
    pumpsWorking: 0,
    pumpsReserve: 0,
    hasBasket: true,
    insulationEnabled: true,
    insulationDepthMm: 2000,
  },
  KOL: {
    dn: 1500,
    workingDepthMm: 2500,
    elevationMm: 200,
    pnSurvey: 0.1,
    sn: null,
    hasLadder: true,
    hasNeck: true,
    neckHeightMm: 800,
    neckDiameterMm: 1000,
    inletDn: 150,
    inletCount: 1,
    inletTrayDepthMm: 1800,
    outletDn: 150,
    outletCount: 1,
    hasBasket: false,
    hasGrinder: false,
    underRoadway: false,
    insulationEnabled: false,
    insulationDepthMm: 0,
  },
}

/** Копия примера — форма предпросмотра правит её, а не общий образец. */
export function sampleSurvey<D extends DeviceType>(device: D): DeviceSurvey[D] {
  return structuredClone(SAMPLE_SURVEYS[device]) as DeviceSurvey[D]
}
