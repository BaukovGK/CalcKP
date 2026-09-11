/**
 * Справочники, которыми собран расчёт (План_устранения 3.6): сборка
 * записывает прочитанное, открытие сверяет с нынешним.
 */
import { describe, expect, it } from 'vitest'
import { FINGERPRINT_CTX, FINGERPRINT_SURVEYS } from './builtin-fingerprint'
import { materializeKns } from './materialize'
import { recordingContext, refChangeText, refsChanges, type RefsUsed } from './refs-used'
import type { MaterializeContext } from './template-kns'

function ctx(over: Partial<MaterializeContext> = {}): MaterializeContext {
  return {
    priceOf: () => 1,
    pipeWeightOf: (dn) => (dn === 1000 ? 120 : null),
    nozzleNormOf: (dn) => (dn === 200 ? { dn: 200, moldingMassKg: 5 } as never : null),
    jointLayerMassOf: (d) => d / 20,
    ellipticBottomOf: () => ({ massKg: 300, thicknessMm: 12 }),
    catalogNodeOf: (code) => (code === 'B5' ? { code: 'B5', version: 2, body: {} as never } : null),
    priceListVersion: 1,
    ...over,
  }
}

describe('справочники, которыми собран расчёт', () => {
  it('сборка записывает каждое обращение: ключ → прочитанное', () => {
    const used: RefsUsed = {}
    const rec = recordingContext(ctx(), used)
    rec.pipeWeightOf(1000, 0.6, 10000)
    rec.nozzleNormOf!(200)
    rec.jointLayerMassOf!(2000)
    rec.ellipticBottomOf!(2400, 6000)
    rec.catalogNodeOf!('B5')
    rec.pipeWeightOf(1300, 0.6, 10000)

    expect(used).toEqual({
      'pipeWeight:1000|0.6|10000': '120',
      'nozzleNorm:200': '{"dn":200,"moldingMassKg":5}',
      'jointLayer:2000': '100',
      'ellipticBottom:2400|6000': '{"massKg":300,"thicknessMm":12}',
      'node:B5': '2',
      'pipeWeight:1300|0.6|10000': 'null',
    })
  })

  it('справочники те же — изменений нет', () => {
    const used: RefsUsed = {}
    const rec = recordingContext(ctx(), used)
    rec.pipeWeightOf(1000, 0.6, 10000)
    rec.catalogNodeOf!('B5')
    expect(refsChanges(used, ctx())).toEqual([])
  })

  it('поправили значение, которое расчёт прочёл, — изменение со словами', () => {
    const used: RefsUsed = {}
    const rec = recordingContext(ctx(), used)
    rec.pipeWeightOf(1000, 0.6, 10000)
    rec.ellipticBottomOf!(2400, 6000)
    rec.catalogNodeOf!('B5')
    rec.nozzleNormOf!(200)

    const changes = refsChanges(
      used,
      ctx({
        pipeWeightOf: (dn) => (dn === 1000 ? 125 : null),
        ellipticBottomOf: () => ({ massKg: 310, thicknessMm: 12 }),
        catalogNodeOf: (code) => (code === 'B5' ? { code: 'B5', version: 3, body: {} as never } : null),
        nozzleNormOf: () => null,
      }),
    )
    expect(changes.map(refChangeText)).toEqual([
      'вес трубы DN1000 PN0,6 SN10000: 120 → 125',
      'эллиптическое днище DN2400: 300 → 310',
      'узел каталога B5: v2 → v3',
      'норма патрубка DN200: изменена',
    ])
  })

  it('правка строки, которой расчёт не касался, его не тревожит', () => {
    const used: RefsUsed = {}
    recordingContext(ctx(), used).pipeWeightOf(1000, 0.6, 10000)
    expect(refsChanges(used, ctx({ pipeWeightOf: (dn) => (dn === 1000 ? 120 : 999) }))).toEqual([])
  })

  it('дерево, собранное до записи, — ничего не сверяется', () => {
    expect(refsChanges(undefined, ctx())).toEqual([])
  })

  it('материализация кладёт прочитанное в дерево', () => {
    const tree = materializeKns(FINGERPRINT_CTX, FINGERPRINT_SURVEYS.KNS[0] as never)
    expect(Object.keys(tree.refsUsed ?? {}).some((k) => k.startsWith('pipeWeight:'))).toBe(true)
    expect(refsChanges(tree.refsUsed, FINGERPRINT_CTX)).toEqual([])
  })
})
