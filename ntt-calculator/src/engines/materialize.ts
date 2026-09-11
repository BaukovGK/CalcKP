/**
 * «Создать расчёт» из ОЛ: материализация изделия по его шаблону
 * (§9.1 ТЗ, Механика §7.1, Библиотека §3, §6.2).
 *
 * Шаблон — действующий, опубликованный технологом в редакторе шаблонов
 * (`ctx.templateOf`), а без него встроенный (engines/code-nodes.ts). Сборку
 * ведёт один интерпретатор — engines/template-def.ts, — поэтому встроенный
 * шаблон и шаблон технолога материализуются одним и тем же кодом.
 *
 * Материализуется всё, что ВЫВОДИТСЯ из опросного листа. То, чего в ОЛ нет
 * (схема ниток напорного трубопровода, кол-во люков, состав площадки),
 * инженер добавляет из каталога: «число строк внутри разделов — прежде всего
 * "Напорный трубопровод" и "Оборудование" — меняется от расчёта к расчёту»
 * (Реверс §10). Раздел 5 в реальных файлах занимает 55–109 строк, и вывести
 * их из ОЛ нечем.
 */

import type { DeviceType } from '@/types/device'
import { builtinTemplate, materializeTemplate, type DeviceEnv, type ProductTemplate } from './template-def'
import type { CalcTree, KnsSurveyParams, MaterializeContext } from './template-kns'
import type { EmkSurveyParams, KolSurveyParams } from './template-emk-kol'

/** Шаблон, по которому собирается изделие: действующий либо встроенный. */
export function activeTemplate(ctx: MaterializeContext, device: DeviceType): ProductTemplate {
  const t = ctx.templateOf?.(device)
  return t && t.deviceType === device ? t : builtinTemplate(device)
}

function materialize(ctx: MaterializeContext, env: DeviceEnv): CalcTree {
  return materializeTemplate(ctx, env, activeTemplate(ctx, env.device))
}

/** КНС/ЛНС/ДНС — один шаблон: тип НС влияет на подписи и входы (Реверс §1). */
export function materializeKns(ctx: MaterializeContext, survey: KnsSurveyParams): CalcTree {
  return materialize(ctx, { device: 'KNS', survey })
}

/** Ёмкость: восемь разделов, корзина — отдельным вторым. */
export function materializeEmk(ctx: MaterializeContext, survey: EmkSurveyParams): CalcTree {
  return materialize(ctx, { device: 'EMK', survey })
}

/** Колодец: семь разделов, без напорного трубопровода. */
export function materializeKol(ctx: MaterializeContext, survey: KolSurveyParams): CalcTree {
  return materialize(ctx, { device: 'KOL', survey })
}
