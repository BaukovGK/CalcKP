import { describe, expect, it } from 'vitest'
import type { DeviceType } from '@/types/device'
import { FINGERPRINT_CTX, FINGERPRINT_SURVEYS } from './builtin-fingerprint'
import { titleStem } from './component-key'
import { builtinTemplate, materializeTemplate, type DeviceEnv } from './template-def'

/**
 * Ключ узла (CalcComponent.slot) — то, по чему пересборка переносит ручные
 * правки (План_устранения, 1.1). Ключ обязан:
 *  - быть у каждого узла и не повторяться в дереве;
 *  - во всех вариантах ОЛ указывать на узел одной и той же роли. Ключ из
 *    номера компонента сдвинулся бы, если строитель при другом ОЛ не строит
 *    один из узлов, — и правки подводящего патрубка уехали бы на напорный.
 *
 * Роль узла здесь опознаётся по основе названия (без DN, Ø, h, ×N): узел
 * одной роли называется одинаково.
 */
const DEVICES: DeviceType[] = ['KNS', 'EMK', 'KOL']

function trees(device: DeviceType) {
  return FINGERPRINT_SURVEYS[device].map((survey) =>
    materializeTemplate(FINGERPRINT_CTX, { device, survey } as DeviceEnv, builtinTemplate(device)),
  )
}

describe('основа названия узла', () => {
  it('без параметров ОЛ', () => {
    expect(titleStem('Нитка напорного трубопровода DN150 ×2')).toBe('Нитка напорного трубопровода')
    expect(titleStem('Патрубок подводящий стеклопластиковый DN250 ×1')).toBe('Патрубок подводящий')
    expect(titleStem('Шахта обслуживания Ø1200 h2300 ×2')).toBe('Шахта обслуживания')
    expect(titleStem('Горловина Ø1000 h800')).toBe('Горловина')
    expect(titleStem('Обечайка корпуса')).toBe('Обечайка корпуса')
  })
})

describe.each(DEVICES)('ключи узлов %s', (device) => {
  const built = trees(device)

  it('у каждого узла есть ключ, и в дереве он один', () => {
    for (const tree of built) {
      const slots = tree.sections.flatMap((s) => s.components.map((c) => c.slot))
      expect(slots.every((s) => typeof s === 'string' && s.length > 0)).toBe(true)
      expect(new Set(slots).size).toBe(slots.length)
    }
  })

  // Ключ из номера компонента (`…#0`) обязан указывать на узел одной роли.
  // Явную роль (`…#inlet`) задаёт строитель — для неё проверяется код узла.
  it('ключ из номера во всех вариантах ОЛ — узел одной роли', () => {
    const stems = new Map<string, Set<string>>()
    for (const tree of built) {
      for (const s of tree.sections) {
        for (const c of s.components) {
          if (!/#\d+$/.test(c.slot!)) continue
          const set = stems.get(c.slot!) ?? new Set<string>()
          set.add(titleStem(c.title))
          stems.set(c.slot!, set)
        }
      }
    }
    const mixed = [...stems].filter(([, set]) => set.size > 1).map(([slot, set]) => `${slot}: ${[...set].join(' | ')}`)
    expect(mixed).toEqual([])
  })

  it('любой ключ во всех вариантах ОЛ — один и тот же код узла', () => {
    const codes = new Map<string, Set<string>>()
    for (const tree of built) {
      for (const s of tree.sections) {
        for (const c of s.components) {
          const set = codes.get(c.slot!) ?? new Set<string>()
          set.add(c.nodeCode ?? '—')
          codes.set(c.slot!, set)
        }
      }
    }
    const mixed = [...codes].filter(([, set]) => set.size > 1).map(([slot, set]) => `${slot}: ${[...set].join(' | ')}`)
    expect(mixed).toEqual([])
  })
})
