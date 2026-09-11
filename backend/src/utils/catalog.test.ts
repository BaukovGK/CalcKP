import { describe, expect, it } from 'vitest'
import {
  BUILTIN_REFS,
  isReservedCode,
  nextVersion,
  nodeBodySchema,
  nodeDraftSchema,
  nodeProblems,
  parseDevice,
  RESERVED_NODE_CODES,
  templateBodySchema,
  templateCatalogCodes,
  templateDraftSchema,
  templateProblems,
  type NodeBody,
  type TemplateBody,
} from './catalog'

const NODE: NodeBody = {
  code: 'B5',
  name: 'Площадка обслуживания Ø{d}',
  tag: 'конструкции обслуживания',
  params: [{ key: 'd', label: 'DN корпуса', type: 'number', unit: 'мм', default: 2000 }],
  rows: [
    { kind: 'МАТЕРИАЛ', category: 'Металлопрокат', name: 'Уголок 40х40х3мм', unit: 'м', qty: 'ПИ() * d / 1000' },
    { kind: 'ОПЕРАЦИЯ', category: 'Собственное производство', name: 'Ручная формовка настила', unit: 'кг', qty: 'd / 100', fotK: 1 },
  ],
}

describe('узел каталога на сервере', () => {
  it('публикуемая версия: годный узел проходит схему и проверки', () => {
    expect(nodeBodySchema.safeParse(NODE).success).toBe(true)
    expect(nodeProblems(NODE)).toEqual([])
  })

  it('черновик мягче: пустые наименования и ни одной строки — можно сохранить, нельзя опубликовать', () => {
    const draft = { ...NODE, name: '', rows: [] }
    expect(nodeDraftSchema.safeParse(draft).success).toBe(true)
    expect(nodeBodySchema.safeParse(draft).success).toBe(false)
  })

  it('рубрика и категория — только из контракта; строки ФОТ не заводятся', () => {
    expect(nodeDraftSchema.safeParse({ ...NODE, tag: 'прочее' }).success).toBe(false)
    const fot = { ...NODE, rows: [{ ...NODE.rows[0]!, category: 'ФОТ' }] }
    expect(nodeDraftSchema.safeParse(fot).success).toBe(false)
  })

  it('коды встроенных узлов заняты — в любом регистре', () => {
    expect(isReservedCode('a10')).toBe(true)
    expect(isReservedCode('B5')).toBe(false)
    expect(nodeProblems({ ...NODE, code: 'B1' })).toEqual(['Код B1 занят встроенным узлом'])
  })

  it('коэффициент ФОТ — обязателен у операции в кг и запрещён у остальных; параметры без повторов', () => {
    const body: NodeBody = {
      ...NODE,
      params: [...NODE.params, { ...NODE.params[0]! }],
      rows: [
        { ...NODE.rows[1]!, fotK: null },
        { ...NODE.rows[0]!, fotK: 0.56 },
      ],
    }
    expect(nodeProblems(body)).toEqual([
      'Параметр «d» повторяется',
      'Строка 1: у операции в кг нужен коэффициент ФОТ',
      'Строка 2: коэффициент ФОТ — только у операции в кг',
    ])
  })
})

describe('шаблон изделия на сервере', () => {
  const body: TemplateBody = {
    sections: [
      { title: 'Корпус', nodes: [{ kind: 'builtin', ref: 'kns.shell' }, { kind: 'catalog', code: 'B5', bindings: { d: 'dn' } }] },
      { title: 'Оборудование', nodes: [{ kind: 'builtin', ref: 'kns.pumps' }] },
    ],
  }
  const published = new Map([['B5', { activeVersion: 2, archived: false }]])

  it('годный шаблон проходит; ссылки на узлы каталога собираются без повторов', () => {
    expect(templateBodySchema.safeParse(body).success).toBe(true)
    expect(templateProblems('KNS', body, published)).toEqual([])
    expect(templateCatalogCodes({ sections: [...body.sections, ...body.sections] })).toEqual(['B5'])
  })

  it('встроенный узел чужого изделия, повтор узла и раздела, неопубликованный и архивный узел каталога', () => {
    const bad: TemplateBody = {
      sections: [
        { title: 'Корпус', nodes: [{ kind: 'builtin', ref: 'emk.shaft' }, { kind: 'builtin', ref: 'kns.shell' }, { kind: 'builtin', ref: 'kns.shell' }] },
        { title: 'корпус ', nodes: [{ kind: 'catalog', code: 'B7', bindings: {} }, { kind: 'catalog', code: 'B5', bindings: {} }] },
      ],
    }
    expect(templateProblems('KNS', bad, new Map([['B5', { activeVersion: 1, archived: true }]]))).toEqual([
      'Раздел 1: встроенного узла «emk.shaft» у этого изделия нет',
      'Раздел 1: встроенный узел «kns.shell» стоит в шаблоне дважды',
      'Раздел «корпус» повторяется',
      'Раздел 2: узел каталога B7 не опубликован',
      'Раздел 2: узел каталога B5 в архиве',
    ])
  })

  it('черновик шаблона допускает пустое название раздела, публикация — нет', () => {
    const draft = { sections: [{ title: '', nodes: [] }] }
    expect(templateDraftSchema.safeParse(draft).success).toBe(true)
    expect(templateBodySchema.safeParse(draft).success).toBe(false)
    expect(templateBodySchema.safeParse({ sections: [] }).success).toBe(false)
  })
})

describe('контракт каталога и версии', () => {
  it('у каждого изделия свои встроенные узлы; коды каталога встроенных узлов заняты', () => {
    expect(BUILTIN_REFS.KNS).toContain('kns.shell')
    expect(BUILTIN_REFS.EMK.every((r) => r.startsWith('emk.'))).toBe(true)
    expect(BUILTIN_REFS.KOL.every((r) => r.startsWith('kol.'))).toBe(true)
    expect([...RESERVED_NODE_CODES]).toEqual(expect.arrayContaining(['A1', 'A10', 'B1', 'C2', 'D5']))
  })

  it('номер следующей версии — максимум плюс один, даже после отката', () => {
    expect(nextVersion([])).toBe(1)
    expect(nextVersion([{ version: 1 }, { version: 3 }, { version: 2 }])).toBe(4)
  })

  it('изделие из адреса', () => {
    expect(parseDevice('KNS')).toBe('KNS')
    expect(parseDevice('kns')).toBeNull()
  })
})
