/**
 * Нормализация наименований прайса во фронтенде — на тех же примерах, что
 * бэкенд и SQL-миграция: правила повторены в трёх местах и обязаны совпадать.
 */
import { describe, expect, it } from 'vitest'
import vectors from '../../../backend/src/utils/price-name.vectors.json'
import { normalizePriceName, normalizePriceText } from './price-name'

describe('normalizePriceName — общие примеры с бэкендом', () => {
  it.each(vectors.names)('%j', (input, expected) => {
    expect(normalizePriceName(input)).toBe(expected)
  })

  it.each(vectors.texts)('категория/ЕИ %j', (input, expected) => {
    expect(normalizePriceText(input)).toBe(expected)
  })
})
