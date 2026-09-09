import { describe, expect, it } from 'vitest'
// Прямой импорт прайса из бэкенда — как в types.test.ts: тип-конфиг фронта
// браузерный, а тянуть node:fs ради теста значит ослабить проверки всего src.
// В сборку приложения файл не попадает: он виден только этому тесту.
import prices from '../../../backend/prisma/seed-data/prices.json'
import { PRESSURE_PIPE_EXTRAS, PRESSURE_PIPE_KITS, type KitItem } from './pressure-pipe-kit'
import { fastenerSetNames, boltFullName } from './template-kns'

/**
 * Наименования комплектов — часть ключа поиска цены `категория|наименование|ЕИ`.
 * Опечатка в ГОСТе, двойном пробеле или кириллической «х» не падает и не
 * подсвечивается: строка просто выходит «красной», и выпуск КП блокируется
 * уже у менеджера. Поэтому каждое имя сверяется с настоящим прайсом.
 */

const KEYS = new Set(prices.map((p) => `${p.category}|${p.name}|${p.unit}`))
const key = (i: KitItem) => `${i.category}|${i.name}|${i.unit}`

describe('комплекты напорной нитки против прайса', () => {
  for (const [dn, kit] of Object.entries(PRESSURE_PIPE_KITS)) {
    it(`DN${dn}: все десять позиций находятся в прайсе`, () => {
      const items = Object.values(kit)
      expect(items).toHaveLength(10)
      for (const item of items) {
        expect(KEYS.has(key(item)), `нет в прайсе: ${key(item)}`).toBe(true)
      }
    })
  }

  it('в эталоне описаны комплекты для DN 50, 65, 80 и 150', () => {
    expect(Object.keys(PRESSURE_PIPE_KITS).map(Number).sort((a, b) => a - b)).toEqual([50, 65, 80, 150])
  })

  it('одиночные позиции раздела 5 тоже находятся', () => {
    for (const item of Object.values(PRESSURE_PIPE_EXTRAS)) {
      expect(KEYS.has(key(item)), `нет в прайсе: ${key(item)}`).toBe(true)
    }
  })

  // В листе позиция названа «РОТ-ГАЙКА ГМ150», в прайсе — «Гайка пожарная
  // ГМ150». Ключ ищется по прайсу, поэтому берётся второе имя.
  it('гайка аварийного трубопровода названа так, как в прайсе, а не в листе', () => {
    expect(PRESSURE_PIPE_EXTRAS.hoseNut.name).toBe('Гайка пожарная ГМ150')
    expect(KEYS.has('Прочие материалы|РОТ-ГАЙКА ГМ150|шт')).toBe(false)
  })
})

describe('крепёжный комплект против прайса', () => {
  // Размеры, которые реально приходят из норм патрубков (поле `bolt`).
  const BOLTS = ['М16х80', 'М20х90', 'М24х100', 'М27х110']

  for (const bolt of BOLTS) {
    it(`${bolt}: болт, обе шайбы и гайка находятся в прайсе`, () => {
      const set = fastenerSetNames(bolt)!
      expect(set).not.toBeNull()
      for (const name of [boltFullName(bolt), set.washer, set.lockWasher, set.nut]) {
        expect(KEYS.has(`Метизы|${name}|шт`), `нет в прайсе: ${name}`).toBe(true)
      }
    })
  }

  it('нераспознанное обозначение не порождает выдуманных имён', () => {
    expect(fastenerSetNames('болт какой-то')).toBeNull()
  })
})
