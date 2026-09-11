import { describe, expect, it } from 'vitest'
import type { DeviceType } from '@/types/device'
import { BUILTIN_REVISIONS, builtinRevision, revisionsAfter } from './builtin-revisions'
import { builtinCanon, builtinFingerprint } from './builtin-fingerprint'
import { materializeEmk, materializeKns, materializeKol } from './materialize'
import { SAMPLE_SURVEYS } from './template-samples'
import type { MaterializeContext } from './template-kns'

const DEVICES: DeviceType[] = ['KNS', 'EMK', 'KOL']
const last = (d: DeviceType) => BUILTIN_REVISIONS[d][BUILTIN_REVISIONS[d].length - 1]!

describe('редакции встроенного шаблона: страж', () => {
  // Упал этот тест — релиз меняет то, что код строит из ОЛ: состав узлов,
  // формулы, наименования, встроенный шаблон или исполнение узлов каталога.
  // Если так и задумано — заведите редакцию (см. сообщение и шапку
  // engines/builtin-revisions.ts): без неё снапшот КП не отличит расчёт,
  // собранный прежним кодом, от собранного новым.
  it.each(DEVICES)('%s: сборка совпадает с последней редакцией', (d) => {
    const fp = builtinFingerprint(d)
    const rev = last(d)
    expect(
      fp,
      `Встроенный шаблон ${d} собирается иначе, чем в редакции ${rev.version}: отпечаток ${fp} вместо ${rev.fingerprint}. ` +
        `Если изменение намеренное, добавьте в engines/builtin-revisions.ts редакцию ${rev.version + 1} ` +
        `с отпечатком '${fp}', датой релиза и словами, что изменилось.`,
    ).toBe(rev.fingerprint)
  })

  it.each(DEVICES)('%s: журнал редакций — номера подряд, даты по порядку, у каждой есть что изменилось', (d) => {
    const list = BUILTIN_REVISIONS[d]
    expect(list.length).toBeGreaterThan(0)
    list.forEach((r, i) => {
      expect(r.version).toBe(i + 1)
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      if (i > 0) expect(r.date >= list[i - 1]!.date).toBe(true)
      expect(r.note.trim().length).toBeGreaterThan(10)
      expect(r.fingerprint).toMatch(/^[0-9a-f]{16}$/)
    })
    expect(builtinRevision(d)).toBe(list.length)
  })
})

describe('отпечаток сборки', () => {
  it('воспроизводим: два расчёта подряд дают один отпечаток', () => {
    expect(builtinFingerprint('KNS')).toBe(builtinFingerprint('KNS'))
  })

  it('держит количества и состав, но не пояснения и не id', () => {
    const canon = builtinCanon('KNS')
    // 1,25 × H (11,6 м) — изготовление лестницы: количество входит в отпечаток.
    expect(canon).toContain('R|ОПЕРАЦИЯ|Собственное производство|Изготовление Лестницы|чел. ч|14.5|')
    expect(canon).toContain('S|1|Корпус|1')
    expect(canon).not.toContain('ƒ')
    expect(canon).not.toMatch(/\br-[0-9a-z]+\b/)
  })

  it('у изделий отпечатки разные — у каждого своя редакция', () => {
    const fps = DEVICES.map(builtinFingerprint)
    expect(new Set(fps).size).toBe(3)
  })
})

describe('редакция в дереве расчёта', () => {
  const ctx: MaterializeContext = {
    priceOf: () => 100,
    pipeWeightOf: () => 900,
    nozzleNormOf: (dn) => ({ dn, odMm: null, minLengthMm: null, moldingMassKg: 1, h1Mm: null, s1Mm: null, flangeMassKg: 2, bolt: 'М20х90', boltCount: 8 }),
    jointLayerMassOf: () => 100,
    priceListVersion: 1,
  }

  it('материализация помнит редакцию встроенного шаблона своего изделия', () => {
    expect(materializeKns(ctx, SAMPLE_SURVEYS.KNS).builtinRevision).toBe(builtinRevision('KNS'))
    expect(materializeEmk(ctx, SAMPLE_SURVEYS.EMK).builtinRevision).toBe(builtinRevision('EMK'))
    expect(materializeKol(ctx, SAMPLE_SURVEYS.KOL).builtinRevision).toBe(builtinRevision('KOL'))
  })

  it('что изменилось с редакции расчёта: новее — список, та же — пусто, без номера — всё', () => {
    const d: DeviceType = 'KNS'
    expect(revisionsAfter(d, builtinRevision(d))).toEqual([])
    expect(revisionsAfter(d, null)).toEqual(BUILTIN_REVISIONS[d])
    expect(revisionsAfter(d, 0)).toEqual(BUILTIN_REVISIONS[d])
  })
})
