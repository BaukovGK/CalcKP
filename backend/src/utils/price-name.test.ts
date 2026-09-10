import { describe, expect, it } from 'vitest'
import prices from '../../prisma/seed-data/prices.json'
import vectors from './price-name.vectors.json'
import { normalizePriceName, normalizePriceText } from './price-name'

describe('normalizePriceName — общие примеры', () => {
  it.each(vectors.names)('%j', (input, expected) => {
    expect(normalizePriceName(input)).toBe(expected)
  })

  it.each(vectors.texts)('категория/ЕИ %j', (input, expected) => {
    expect(normalizePriceText(input)).toBe(expected)
  })

  // На идемпотентности держится миграция базы: приведённое наименование не
  // может столкнуться с ещё не приведённым.
  it('повторная нормализация ничего не меняет', () => {
    for (const [input] of vectors.names) {
      const once = normalizePriceName(input)
      expect(normalizePriceName(once)).toBe(once)
    }
    for (const p of prices) {
      const once = normalizePriceName(p.name)
      expect(normalizePriceName(once)).toBe(once)
    }
  })
})

describe('сид прайса', () => {
  // Сид запускается при каждом старте контейнера (createMany skipDuplicates).
  // Грязное имя в нём вернуло бы в базу позицию, которую миграция только что
  // привела: в прайсе стало бы две строки на одну вещь.
  it('наименования, категории и ЕИ в каноническом виде', () => {
    const dirty = prices.filter(
      (p) =>
        p.name !== normalizePriceName(p.name) ||
        p.category !== normalizePriceText(p.category) ||
        p.unit !== normalizePriceText(p.unit),
    )
    expect(dirty.map((p) => p.name)).toEqual([])
  })

  it('ключ (категория, наименование, ЕИ) не повторяется', () => {
    const keys = prices.map((p) => `${p.category}|${p.name}|${p.unit}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
