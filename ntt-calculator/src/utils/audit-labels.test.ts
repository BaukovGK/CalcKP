/**
 * Журнал действий по-русски: коды событий превращаются в названия, `meta` — в
 * подписи. Незнакомое событие не ломает экран, а показывается своим кодом.
 */
import { describe, expect, it } from 'vitest'
import {
  AUDIT_GROUPS,
  AUDIT_LABELS,
  auditDetails,
  auditGroupKey,
  auditGroupLabel,
  auditLabel,
  entityLabel,
  isAlarming,
} from './audit-labels'

describe('названия событий', () => {
  it('переводит коды, которые пишет сервер', () => {
    expect(auditLabel('estimate.kp')).toBe('Выпущено КП')
    expect(auditLabel('auth.login_failed')).toBe('Неудачный вход')
    expect(auditLabel('db.restore')).toBe('База восстановлена из дампа')
  })

  it('незнакомое событие показывает кодом, а не пустотой', () => {
    expect(auditLabel('estimate.новое_событие')).toBe('estimate.новое_событие')
  })

  it('раздел берётся приставкой кода', () => {
    expect(auditGroupKey('estimate.kp.export')).toBe('estimate')
    expect(auditGroupLabel('estimate.kp.export')).toBe('Расчёты и КП')
    expect(auditGroupLabel('template.node.publish')).toBe('Шаблоны и справочники')
    expect(auditGroupLabel('чужое.событие')).toBe('чужое')
  })

  it('у каждого раздела есть хотя бы одно известное событие', () => {
    for (const group of AUDIT_GROUPS) {
      const known = Object.keys(AUDIT_LABELS).filter((a) => auditGroupKey(a) === group.key)
      expect(known.length, `раздел ${group.key}`).toBeGreaterThan(0)
    }
  })

  it('правка опросного листа читается как событие, а не как «сохранено»', () => {
    expect(auditLabel('estimate.survey')).toBe('Правка опросного листа')
    // Подробности несут сами изменения: «DN корпуса: 2000 → 3000».
    expect(auditDetails({ changed: ['DN корпуса: 2000 → 3000'], edits: 7 })).toEqual([
      { label: 'изменения', value: 'DN корпуса: 2000 → 3000' },
      { label: 'правок', value: '7' },
    ])
  })

  it('черновики шаблонов и добавленные позиции прайса — со своими подписями', () => {
    expect(auditLabel('template.node.draft')).toBe('Сохранён черновик узла')
    expect(auditLabel('template.product.draft')).toBe('Сохранён черновик шаблона')
    expect(auditDetails({ created: 3, createdNames: ['Люк', 'Насос'] })).toEqual([
      { label: 'добавлено', value: '3' },
      { label: 'добавлены', value: 'Люк, Насос' },
    ])
  })

  it('заметные события отмечаются: удаления, восстановление, подбор пароля', () => {
    expect(isAlarming('auth.login_failed')).toBe(true)
    expect(isAlarming('estimate.delete')).toBe(true)
    expect(isAlarming('db.restore')).toBe(true)
    expect(isAlarming('estimate.create')).toBe(false)
  })

  it('тип объекта — словом', () => {
    expect(entityLabel('Estimate')).toBe('расчёт')
    expect(entityLabel('Project')).toBe('проект')
    expect(entityLabel(null)).toBeNull()
    expect(entityLabel('Neizvestno')).toBe('Neizvestno')
  })
})

describe('подробности события', () => {
  it('подписывает известные ключи meta', () => {
    expect(auditDetails({ kpNumber: 'КП-0042', snapshotVersion: 3 })).toEqual([
      { label: 'номер КП', value: 'КП-0042' },
      { label: 'редакция', value: '3' },
    ])
  })

  it('списки — через запятую, признаки — словами', () => {
    expect(auditDetails({ changed: ['title', 'customer'], isActive: false })).toEqual([
      { label: 'изменения', value: 'title, customer' },
      { label: 'активна', value: 'нет' },
    ])
  })

  it('пустое опускается, а не показывается прочерками', () => {
    expect(auditDetails({ reason: '', rows: [], count: null, email: 'a@b.c' })).toEqual([
      { label: 'почта', value: 'a@b.c' },
    ])
  })

  it('неизвестный ключ остаётся как есть, мусор не роняет экран', () => {
    expect(auditDetails({ своё: 'значение' })).toEqual([{ label: 'своё', value: 'значение' }])
    expect(auditDetails(null)).toEqual([])
    expect(auditDetails('строка')).toEqual([])
    expect(auditDetails([1, 2])).toEqual([])
  })
})
