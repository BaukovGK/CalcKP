/**
 * Ручная правка цены — новая версия прайса (План_устранения, 1.2).
 *
 * Дефект, который держат тесты: версию прайса поднимал только импорт. После
 * правки цены на экране прайса расчёты не узнавали, что цены под ними
 * сдвинулись, — плашка «прайс обновился» и вопрос при выпуске КП молчали, а
 * два расчёта с подписью «НН v5» стояли на разных ценах.
 */
import type { PrismaClient } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { applyPriceEdit, changesPrice, manualEditNote } from './price-edit'
import { PRICE_VERSION_RETRIES } from './price-version'

type Row = Record<string, unknown>

/**
 * База в памяти: позиция прайса, история цен и версии прайса.
 *
 * Транзакция откатывается целиком — как в Postgres: записи неудавшейся
 * попытки пропадают. Версии, «занятые параллельной записью», живут отдельно:
 * их транзакция закоммичена, откат нашей их не трогает.
 */
function fakeDb(opts: { price?: number | null; exists?: boolean; lastVersion?: number; races?: number; failUpdate?: boolean } = {}) {
  const state = {
    item: opts.exists === false ? null : ({ id: 'p1', name: 'Задвижка клиновая', unit: 'шт', priceRub: opts.price === undefined ? 100 : opts.price, supplier: null } as Row | null),
    versions: [] as Row[],
    history: [] as Row[],
    others: [] as number[],
    transactions: 0,
    /** Порядок обращений транзакции: блокировка, чтение позиции. */
    calls: [] as string[],
  }
  let races = opts.races ?? 0
  const maxVersion = () => Math.max(opts.lastVersion ?? 0, ...state.others, ...state.versions.map((v) => v.version as number))

  const tx = {
    $executeRaw: async () => {
      state.calls.push('lock')
      return 1
    },
    priceItem: {
      findUnique: async () => {
        state.calls.push('read')
        return state.item ? { ...state.item } : null
      },
      update: async ({ data }: { data: Row }) => {
        if (opts.failUpdate) throw new Error('соединение с базой потеряно')
        state.item = { ...state.item!, ...data }
        return { ...state.item }
      },
    },
    priceHistory: { create: async ({ data }: { data: Row }) => void state.history.push(data) },
    priceListVersion: {
      findFirst: async () => (maxVersion() ? { version: maxVersion() } : null),
      create: async ({ data }: { data: Row }) => {
        if (races > 0) {
          races--
          // Параллельная правка успела закоммитить тот же номер.
          state.others.push(data.version as number)
          throw Object.assign(new Error('Unique constraint failed on the fields: (`version`)'), { code: 'P2002' })
        }
        state.versions.push(data)
      },
    },
  }

  const prisma = {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      state.transactions++
      const saved = JSON.stringify({ item: state.item, versions: state.versions, history: state.history })
      try {
        return await fn(tx)
      } catch (e) {
        Object.assign(state, JSON.parse(saved))
        throw e
      }
    },
  }
  return { prisma: prisma as unknown as PrismaClient, state }
}

describe('ручная правка цены', () => {
  it('смена цены — позиция, история и новая версия прайса одной транзакцией', async () => {
    const { prisma, state } = fakeDb({ lastVersion: 5 })

    const r = await applyPriceEdit(prisma, 'p1', { priceRub: 120 }, 'u1')

    expect(r!.version).toBe(6)
    expect(r!.before.priceRub).toBe(100)
    expect(r!.item.priceRub).toBe(120)
    expect(state.history).toEqual([{ priceItemId: 'p1', oldPrice: 100, newPrice: 120, changedById: 'u1' }])
    expect(state.versions).toEqual([
      { version: 6, label: 'НН v6', note: 'Ручная правка цены: Задвижка клиновая, шт', createdById: 'u1' },
    ])
    expect(state.transactions).toBe(1)
  })

  // Две вкладки правят одну позицию разом: без блокировки обе прочитали бы
  // одну «прежнюю» цену, и история соврала бы (проверено на Postgres).
  it('позиция читается под блокировкой — прежняя цена в истории та, что стояла при записи', async () => {
    const { prisma, state } = fakeDb()

    await applyPriceEdit(prisma, 'p1', { priceRub: 120 }, 'u1')

    expect(state.calls.slice(0, 2)).toEqual(['lock', 'read'])
  })

  it('первая цена у позиции без цены — тоже ценовое событие', async () => {
    const { prisma, state } = fakeDb({ price: null })

    const r = await applyPriceEdit(prisma, 'p1', { priceRub: 80 }, null)

    expect(r!.version).toBe(1)
    expect(state.history).toEqual([{ priceItemId: 'p1', oldPrice: null, newPrice: 80, changedById: null }])
  })

  it('правка одного поставщика и та же цена версии не создают', async () => {
    const { prisma, state } = fakeDb({ lastVersion: 5 })

    const supplierOnly = await applyPriceEdit(prisma, 'p1', { supplier: 'Завод арматуры' }, 'u1')
    const samePrice = await applyPriceEdit(prisma, 'p1', { priceRub: 100 }, 'u1')

    expect(supplierOnly!.version).toBeNull()
    expect(supplierOnly!.item.supplier).toBe('Завод арматуры')
    expect(samePrice!.version).toBeNull()
    expect(state.history).toEqual([])
    expect(state.versions).toEqual([])
  })

  it('позиции нет — null, ничего не записано', async () => {
    const { prisma, state } = fakeDb({ exists: false })

    expect(await applyPriceEdit(prisma, 'p1', { priceRub: 120 }, 'u1')).toBeNull()
    expect(state.history).toEqual([])
    expect(state.versions).toEqual([])
  })

  it('номер версии заняла параллельная запись — транзакция повторяется целиком', async () => {
    const { prisma, state } = fakeDb({ lastVersion: 5, races: 1 })

    const r = await applyPriceEdit(prisma, 'p1', { priceRub: 120 }, 'u1')

    // v6 заняла параллельная правка, наша — v7; история не задвоилась.
    expect(r!.version).toBe(7)
    expect(state.versions.map((v) => v.version)).toEqual([7])
    expect(state.history).toHaveLength(1)
    expect(state.transactions).toBe(2)
  })

  it('гонка не прекращается — после последней попытки ошибка уходит наверх, база прежняя', async () => {
    const { prisma, state } = fakeDb({ lastVersion: 5, races: 10 })

    await expect(applyPriceEdit(prisma, 'p1', { priceRub: 120 }, 'u1')).rejects.toMatchObject({ code: 'P2002' })
    expect(state.transactions).toBe(PRICE_VERSION_RETRIES)
    expect(state.item!.priceRub).toBe(100)
    expect(state.history).toEqual([])
  })

  it('другая ошибка не повторяется', async () => {
    const { prisma, state } = fakeDb({ failUpdate: true })

    await expect(applyPriceEdit(prisma, 'p1', { priceRub: 120 }, 'u1')).rejects.toThrow('соединение с базой потеряно')
    expect(state.transactions).toBe(1)
  })
})

describe('правка цены: признаки', () => {
  it('цена меняется, только если задана и отличается от прежней', () => {
    expect(changesPrice({ priceRub: 100 }, { priceRub: 120 })).toBe(true)
    expect(changesPrice({ priceRub: null }, { priceRub: 0 })).toBe(true)
    expect(changesPrice({ priceRub: 100 }, { priceRub: 100 })).toBe(false)
    expect(changesPrice({ priceRub: 100 }, { supplier: 'X' })).toBe(false)
  })

  it('примечание версии называет позицию и её ЕИ', () => {
    expect(manualEditNote({ name: 'Лист 4 мм', unit: 'м2' })).toBe('Ручная правка цены: Лист 4 мм, м2')
  })
})
