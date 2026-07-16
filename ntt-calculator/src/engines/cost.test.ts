import { describe, expect, it } from 'vitest'
import { rowSum } from './cost'
import type { CalcRow } from '@/types/calculator'

// Smoke-тест этапа 0: подтверждает, что тестовый харнесс поднят и видит
// движок через алиас '@'. Полноценные тесты движка (§9 ТЗ, контрольные
// числа ОЛ3487) появятся на этапе 2 вместе с новым engines/.

const row = (qty: string, price: string): CalcRow =>
  ({ id: 'r1', qty, price } as CalcRow)

describe('rowSum', () => {
  it('умножает количество на цену', () => {
    expect(rowSum(row('2', '100'))).toBe(200)
  })

  it('трактует нечисловое количество как 0', () => {
    expect(rowSum(row('', '100'))).toBe(0)
  })

  it('строка без цены даёт сумму 0 (§9.2 ТЗ)', () => {
    expect(rowSum(row('11.6', ''))).toBe(0)
  })
})
