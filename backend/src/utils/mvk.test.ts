import { describe, expect, it } from 'vitest'
import { capacityM3day, mvkIssues } from './mvk'

describe('контроль СТО МВК при выпуске КП', () => {
  it.each([
    { rashod: '200', rashodUnit: 'm3/day', expected: 200 },
    { rashod: '10', rashodUnit: 'm3/h', expected: 240 },
    { rashod: '2,5', rashodUnit: 'l/s', expected: 216 },
  ])('перевод производительности всей станции: $rashod $rashodUnit', ({ rashod, rashodUnit, expected }) => {
    expect(capacityM3day({ rashod, rashodUnit })).toBe(expected)
  })

  it('старый расчёт МВК требует пересборки с обязательным комплектом', () => {
    const issues = mvkIssues('KNS', { form: { mvk: true, dn: '2600', nRab: '2', shuPusk: 'ЧП', rashod: '201', rashodUnit: 'm3/day' } })
    expect(issues.join(' ')).toContain('2800')
    expect(issues.join(' ')).toContain('плавным пуском')
    expect(issues.join(' ')).toContain('электромагнитный расходомер')
    expect(issues.join(' ')).toContain('перехватывающее устройство')
  })

  it('ровно 200 м³/сут не требует расходомера', () => {
    const issues = mvkIssues('KNS', { form: { mvk: true, rashod: '200', rashodUnit: 'm3/day' } })
    expect(issues.join(' ')).not.toContain('электромагнитный расходомер')
  })

  it('не затрагивает расчёты без МВК и ёмкости', () => {
    expect(mvkIssues('KNS', {})).toEqual([])
    expect(mvkIssues('EMK', { form: { mvk: true } })).toEqual([])
  })
})
