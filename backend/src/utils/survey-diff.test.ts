/**
 * Что журнал считает правкой опросного листа.
 *
 * Лист сохраняется часто и целиком: экран ОЛ пишет его сам, конфигуратор
 * шлёт тем же маршрутом дерево и цены. В журнал должны попадать только
 * изменённые ОТВЕТЫ, иначе он превращается в ленту «сохранено».
 */
import { describe, expect, it } from 'vitest'
import { changeText, surveyChanges } from './survey-diff'

const survey = (form: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  form,
  tree: { sections: [] },
  derived: { sn: 10000 },
  ...extra,
})

describe('изменения опросного листа', () => {
  it('называет поле по-русски и показывает «было → стало»', () => {
    const changes = surveyChanges(survey({ dn: '2000' }), survey({ dn: '3000' }))

    expect(changes).toEqual([{ field: 'DN корпуса', from: '2000', to: '3000' }])
    expect(changeText(changes[0]!)).toBe('DN корпуса: 2000 → 3000')
  })

  it('тумблеры — словами, пустое — прочерком', () => {
    expect(surveyChanges(survey({ mvk: false }), survey({ mvk: true }))).toEqual([
      { field: 'ТТ МВК', from: 'нет', to: 'да' },
    ])
    expect(surveyChanges(survey({ marka: 'VSL.100' }), survey({ marka: '' }))).toEqual([
      { field: 'марка насоса', from: 'VSL.100', to: '—' },
    ])
  })

  it('правка дерева и вычисленных значений событием ОЛ не является', () => {
    const before = survey({ dn: '2000' }, { tree: { sections: [{ id: 'a' }] } })
    const after = survey({ dn: '2000' }, { tree: { sections: [{ id: 'b' }] }, derived: { sn: 5000 } })

    expect(surveyChanges(before, after)).toEqual([])
  })

  it('первое сохранение листа не считается правкой — это создание единицы', () => {
    expect(surveyChanges({ tree: {} }, survey({ dn: '3000' }))).toEqual([])
    expect(surveyChanges(null, survey({ dn: '3000' }))).toEqual([])
  })

  it('несколько полей сразу — все в списке', () => {
    const changes = surveyChanges(
      survey({ dn: '2000', nRab: '2', shu: false }),
      survey({ dn: '3000', nRab: '3', shu: true }),
    )

    expect(changes.map(changeText)).toEqual([
      'DN корпуса: 2000 → 3000',
      'рабочих насосов: 2 → 3',
      'шкаф управления: нет → да',
    ])
  })

  it('поле без подписи показывается своим именем, мусор не роняет разбор', () => {
    expect(surveyChanges(survey({ своёПоле: 1 }), survey({ своёПоле: 2 }))).toEqual([
      { field: 'своёПоле', from: '1', to: '2' },
    ])
    expect(surveyChanges('мусор', 'мусор')).toEqual([])
    expect(surveyChanges(undefined, undefined)).toEqual([])
  })
})
