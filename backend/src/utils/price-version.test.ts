/**
 * Версия прайса — следующая по номеру, с подписью «НН vN» или заданной
 * импортом; повтор — только при гонке за номер.
 */
import { describe, expect, it } from 'vitest'
import { createPriceVersion, PRICE_VERSION_LOCK, PRICE_VERSION_RETRIES, withPriceVersionRetry } from './price-version'

function fakeTx(last: number | null) {
  const created: Array<Record<string, unknown>> = []
  const calls: string[] = []
  const tx = {
    $executeRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(`${sql.join('?')} ${values.join(',')}`)
      return 1
    },
    priceListVersion: {
      findFirst: async () => {
        calls.push('findFirst')
        return last == null ? null : { version: last }
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        calls.push('create')
        created.push(data)
      },
    },
  }
  return { tx: tx as never, created, calls }
}

describe('версия прайса', () => {
  it('пустая таблица — первая версия «НН v1»', async () => {
    const { tx, created } = fakeTx(null)

    expect(await createPriceVersion(tx, { note: 'Импорт из «прайс.xlsx», лист «НН»', userId: null })).toBe(1)
    expect(created).toEqual([{ version: 1, label: 'НН v1', note: 'Импорт из «прайс.xlsx», лист «НН»', createdById: null }])
  })

  it('номер читается под блокировкой транзакции — параллельная запись ждёт', async () => {
    const { tx, calls } = fakeTx(7)

    await createPriceVersion(tx, { note: 'правка', userId: null })

    expect(calls).toEqual([`SELECT pg_advisory_xact_lock(?::bigint) ${PRICE_VERSION_LOCK}`, 'findFirst', 'create'])
  })

  it('подпись, заданная при импорте, остаётся', async () => {
    const { tx, created } = fakeTx(4)

    expect(await createPriceVersion(tx, { label: 'НН от 20.09', note: 'импорт', userId: 'u1' })).toBe(5)
    expect(created[0]).toMatchObject({ version: 5, label: 'НН от 20.09' })
  })

  it('повторяет только гонку за номер и не больше заданного числа раз', async () => {
    const race = Object.assign(new Error('unique'), { code: 'P2002' })
    let calls = 0
    const retries: number[] = []

    const ok = await withPriceVersionRetry(async () => {
      if (++calls < 2) throw race
      return 'записано'
    }, (attempt) => retries.push(attempt))
    expect(ok).toBe('записано')
    expect(retries).toEqual([1])

    calls = 0
    await expect(withPriceVersionRetry(async () => { calls++; throw race })).rejects.toBe(race)
    expect(calls).toBe(PRICE_VERSION_RETRIES)

    calls = 0
    await expect(withPriceVersionRetry(async () => { calls++; throw new Error('другое') })).rejects.toThrow('другое')
    expect(calls).toBe(1)
  })
})
