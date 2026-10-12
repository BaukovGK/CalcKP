import { makeRow, nextId, type CalcComponent, type KnsSurveyParams, type MaterializeContext } from './template-kns'

/** Комплекты по проекту: цены включают изготовление и монтаж.
 * В эталоне габариты вписаны вручную; норм для автоматического BOM нет.
 * Комплект требует договорной цены, без выдуманных масс и часов.
 */
function kit(ctx: MaterializeContext, slot: string, name: string, note: string, nodeCode: string): CalcComponent {
  return {
    id: nextId('c'), nodeCode, slot, title: name, enabled: true,
    rows: [makeRow(ctx, {
      kind: 'МАТЕРИАЛ', category: 'Прочее оборудование', name, unit: 'компл.', qtyCalc: 1,
      note: `СТО МВК · ${note} · договорная цена полного комплекта с изготовлением и монтажом`,
    })],
  }
}

export function buildMvkVent(ctx: MaterializeContext, s: KnsSurveyParams): CalcComponent[] {
  if (!s.mvk) return []
  return [kit(ctx, 'vent', 'Приточно-вытяжная вентиляция с механическим побуждением из нержавеющей стали',
    'приточная и вытяжная линии, вентиляторы и крепления; сечения и производительность по проекту', 'C1')]
}

export function buildMvkService(ctx: MaterializeContext, s: KnsSurveyParams): CalcComponent[] {
  if (!s.mvk) return []
  return [
    kit(ctx, 'platform', 'Площадка обслуживания из нержавеющей стали', 'габариты по компоновке КНС', 'B4'),
    kit(ctx, 'hatches', 'Откидывающиеся люки площадки обслуживания из нержавеющей стали',
      'полный комплект люков, петель и креплений; количество и размеры по компоновке', 'B7'),
    kit(ctx, 'interceptor', 'Перехватывающее устройство', 'исполнение и габариты по компоновке КНС', 'B7'),
  ]
}
