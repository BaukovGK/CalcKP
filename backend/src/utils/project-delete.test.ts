/**
 * Удаление проекта вместе с единицами: что его разрешает и что запрещает.
 *
 * Правила — те же, что у единицы по отдельности. Главное, что держат тесты:
 * единица с выпущенным КП не даёт удалить проект целиком (удалить полпроекта
 * хуже, чем не удалить ничего), а отказ называет, кто мешает и почему.
 */
import { describe, expect, it } from 'vitest'
import {
  BLOCKS_IN_MESSAGE,
  projectDeletionBlocks,
  projectDeletionMessage,
  unitDeletionBlock,
  type UnitForDeletion,
} from './project-delete'

const unit = (over: Partial<UnitForDeletion> = {}): UnitForDeletion => ({
  id: 'e1',
  title: 'КНС-1',
  status: 'CALC',
  protectedSnapshots: 0,
  ...over,
})

describe('удаление единицы в составе проекта', () => {
  it('черновик, расчёт и отклонённый без слепков — удаляются', () => {
    expect(unitDeletionBlock(unit({ status: 'DRAFT' }))).toBeNull()
    expect(unitDeletionBlock(unit({ status: 'CALC' }))).toBeNull()
    expect(unitDeletionBlock(unit({ status: 'REJECTED' }))).toBeNull()
  })

  it('выпущенное КП или зафиксированная версия — не удаляется', () => {
    expect(unitDeletionBlock(unit({ protectedSnapshots: 1 }))).toBe('выпущено КП или зафиксирована версия')
    expect(unitDeletionBlock(unit({ protectedSnapshots: 3 }))).toContain('— 3')
  })

  it('утверждённый расчёт прежних лет — не удаляется', () => {
    expect(unitDeletionBlock(unit({ status: 'APPROVED' }))).toContain('утверждён')
    expect(unitDeletionBlock(unit({ status: 'REVIEW' }))).toContain('утверждён')
  })
})

describe('удаление проекта', () => {
  it('пустой проект и проект из удаляемых единиц — удаляются', () => {
    expect(projectDeletionBlocks([])).toEqual([])
    expect(projectDeletionBlocks([unit({ id: 'a' }), unit({ id: 'b', status: 'DRAFT' })])).toEqual([])
  })

  it('одна защищённая единица — проект не удаляется, отказ называет её', () => {
    const blocks = projectDeletionBlocks([
      unit({ id: 'a', title: 'ЕМК-1' }),
      unit({ id: 'b', title: 'КНС-1', protectedSnapshots: 1 }),
    ])

    expect(blocks).toEqual([{ id: 'b', title: 'КНС-1', reason: 'выпущено КП или зафиксирована версия' }])
    const text = projectDeletionMessage(blocks)
    expect(text).toContain('«КНС-1» — выпущено КП')
    expect(text).toContain('по одной на экране проекта')
  })

  it('длинный список в тексте обрезается, остальные — числом', () => {
    const many = Array.from({ length: BLOCKS_IN_MESSAGE + 3 }, (_, i) =>
      unit({ id: `e${i}`, title: `КНС-${i + 1}`, protectedSnapshots: 1 }),
    )
    const text = projectDeletionMessage(projectDeletionBlocks(many))

    expect(text).toContain('«КНС-1»')
    expect(text).not.toContain(`«КНС-${BLOCKS_IN_MESSAGE + 1}»`)
    expect(text).toContain('и ещё 3')
  })
})
