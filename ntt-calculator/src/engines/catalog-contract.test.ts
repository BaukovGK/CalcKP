import { describe, expect, it } from 'vitest'
import contract from '../../../backend/src/utils/catalog-contract.json'
import { BUILTIN_NODES, RESERVED_NODE_CODES } from './code-nodes'
import { NODE_TAGS } from './node-def'
import { CATEGORIES } from './types'

/**
 * Сервер проверяет узлы и шаблоны технолога по контракту
 * `backend/src/utils/catalog-contract.json`, а встроенные узлы живут здесь,
 * в коде. Добавили или переименовали встроенный узел — контракт обязан
 * последовать, иначе сервер отклонит годный шаблон или пропустит негодный.
 */
describe('контракт каталога совпадает с реестром встроенных узлов', () => {
  it('ссылки встроенных узлов по изделиям — в том же порядке', () => {
    const refs: Record<string, string[]> = { KNS: [], EMK: [], KOL: [] }
    for (const n of BUILTIN_NODES) refs[n.device]!.push(n.ref)
    expect(contract.builtinRefs).toEqual(refs)
  })

  it('коды каталога, занятые встроенными узлами', () => {
    expect([...contract.reservedNodeCodes].sort()).toEqual([...RESERVED_NODE_CODES].sort())
  })

  it('рубрики и категории строк (ФОТ — только спутник)', () => {
    expect(contract.nodeTags).toEqual([...NODE_TAGS])
    expect(contract.rowCategories).toEqual(CATEGORIES.filter((c) => c !== 'ФОТ'))
  })
})
