/**
 * Отказ в выпуске КП виден и объясним.
 *
 * Жалоба 17.09.2026: «нажимаю "Сформировать КП" — ничего не происходит».
 * На деле сервер отвечал 422 `ROWS_WITHOUT_PRICE` (четыре строки без цены), а
 * экран показывал тост на несколько секунд — его не замечали. Теперь отказ
 * превращается в окно со списком строк, и эти тесты держат правило: гейт —
 * окно, всё остальное — тост.
 */
import { describe, expect, it } from 'vitest'
import { BLOCK_ROWS_SHOWN, blockOf, missingPriceBlock, serverBlock } from './kp-gate'

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `Строка ${i + 1}`, unit: 'шт.' }))

describe('отказ по строкам без цены', () => {
  it('называет число строк и перечисляет их', () => {
    const block = missingPriceBlock(rows(4))

    expect(block.message).toContain('Строк без цены: 4')
    expect(block.message).toContain('итог занижен')
    expect(block.rows).toHaveLength(4)
    expect(block.rows[0]?.name).toBe('Строка 1')
    expect(block.showRows).toBe(true)
    expect(block.more).toBe(0)
  })

  it('длинный список обрезается, остальное — счётчиком', () => {
    const block = missingPriceBlock(rows(30))

    expect(block.rows).toHaveLength(BLOCK_ROWS_SHOWN)
    expect(block.more).toBe(30 - BLOCK_ROWS_SHOWN)
  })
})

describe('отказ сервера', () => {
  it('строки без цены: текст сервера, его список и переход к строкам', () => {
    const block = serverBlock({
      code: 'ROWS_WITHOUT_PRICE',
      message: 'Нельзя выпустить КП: 4 строки без цены — итог занижен',
      rows: [{ name: 'Труба СК/НПС-К 400-0,1-2500', unit: 'м.п.' }],
    })

    expect(block?.message).toContain('4 строки без цены')
    expect(block?.rows).toHaveLength(1)
    expect(block?.showRows).toBe(true)
  })

  it('отрицательные суммы — тоже со списком', () => {
    expect(serverBlock({ code: 'NEGATIVE_ROWS', message: 'есть отрицательные', rows: rows(2) })?.showRows)
      .toBe(true)
  })

  it('гейты без строк объясняются текстом, кнопки «показать строки» нет', () => {
    for (const code of ['RATES_NOT_IN_PRICE', 'TOTAL_MISMATCH']) {
      const block = serverBlock({ code, message: `отказ ${code}` })
      expect(block?.message).toBe(`отказ ${code}`)
      expect(block?.rows).toEqual([])
      expect(block?.showRows).toBe(false)
    }
  })

  it('не гейт — окна нет: сеть и 500 остаются тостом', () => {
    expect(serverBlock(undefined)).toBeNull()
    expect(serverBlock(null)).toBeNull()
    expect(serverBlock({ message: 'Internal Server Error' })).toBeNull()
  })

  it('отказ без текста всё равно объясняет, что произошло', () => {
    expect(serverBlock({ code: 'ROWS_WITHOUT_PRICE' })?.message).toBe('Выпустить КП не удалось')
  })
})

describe('сборка окна', () => {
  it('без строк кнопка «показать строки» не появляется', () => {
    expect(blockOf('Ставок нет в прайсе').showRows).toBe(false)
    expect(blockOf('Ставок нет в прайсе', [], true).showRows).toBe(false)
  })
})
