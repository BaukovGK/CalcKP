/**
 * Шапка КП: что присылает окно выпуска, то сервер и принимает, а слепок потом
 * отдаёт обратно без потерь.
 *
 * Тело выпуска описано `.strict()`-схемами: лишний ключ — это или опечатка
 * клиента, или поле, которое забыли добавить на сервере, и молча терять его
 * нельзя. Поэтому здесь лежит ровно тот объект, который собирает
 * `KpIssueModal.vue`.
 */
import { describe, expect, it } from 'vitest'
import { formatKpNumber, headerToJson, isSuggestedNumber, kpIssueSchema, parseKpHeader } from './kp-payload'

/** Тело, которое шлёт окно выпуска (KpIssueModal, функция submit). */
const FROM_UI = {
  number: 'КП-0007',
  position: {
    tag: 'НС1',
    mark: null,
    tu: 'ТУ 4859-006-81652345-2019',
    unit: 'компл.',
    kit: [
      { name: 'Стеклокомпозитный корпус', qty: 1, unit: 'шт.' },
      { name: 'Лестница из нержавеющей стали', qty: 2, unit: 'шт.' },
    ],
  },
  terms: {
    vatRatePct: 22,
    prepaymentPct: 70,
    paymentDays: 3,
    leadTimeDays: '40-50',
    euroThresholdPct: 5,
    validUntil: '2026-10-01T12:00:00.000Z',
    deliveryTo: 'Очистные сооружения, г. Пушкино',
    shipmentFrom: 'д. Коврово',
    excluded: ['Пусконаладка не входит.'],
  },
  signature: {
    signerTitle: 'Коммерческий директор',
    signerName: 'С.В. Иванов',
    executorName: 'Князев В.А.',
    executorPosition: 'Инженер-конструктор',
    executorPhone: '+7 (499) 940-14-04 доб. 3041',
    executorEmail: 'engineer@example.test',
  },
}

describe('шапка КП: приём тела выпуска', () => {
  it('принимает тело окна выпуска целиком', () => {
    const parsed = kpIssueSchema.safeParse(FROM_UI)

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.position?.kit).toHaveLength(2)
  })

  it('пустое тело — это «печатать умолчаниями», а не ошибка', () => {
    expect(kpIssueSchema.safeParse({}).success).toBe(true)
    expect(headerToJson({})).toBeNull()
  })

  it('незнакомый ключ отклоняется: поле, потерянное молча, дороже отказа', () => {
    expect(kpIssueSchema.safeParse({ ...FROM_UI, markup: 1.7 }).success).toBe(false)
    expect(
      kpIssueSchema.safeParse({ ...FROM_UI, position: { ...FROM_UI.position, priceRub: 1 } }).success,
    ).toBe(false)
  })

  it('отказывает на бессмысленных значениях', () => {
    const bad = (terms: Record<string, unknown>) =>
      kpIssueSchema.safeParse({ terms: { ...FROM_UI.terms, ...terms } }).success

    expect(bad({ vatRatePct: 200 })).toBe(false)
    expect(bad({ prepaymentPct: -5 })).toBe(false)
    expect(bad({ validUntil: '01.10.2026' })).toBe(false)
    expect(kpIssueSchema.safeParse({ position: { kit: [{ name: 'Люк', qty: 0, unit: 'шт.' }] } }).success)
      .toBe(false)
  })
})

describe('шапка КП: хранение в слепке', () => {
  it('срок действия переживает JSON и возвращается датой', () => {
    const parsed = kpIssueSchema.parse(FROM_UI)
    const stored = JSON.parse(JSON.stringify(headerToJson(parsed)))
    const header = parseKpHeader(stored)

    expect(header.terms?.validUntil).toBeInstanceOf(Date)
    expect(header.terms?.validUntil?.toISOString()).toBe('2026-10-01T12:00:00.000Z')
    expect(header.terms?.prepaymentPct).toBe(70)
    expect(header.position?.tag).toBe('НС1')
    expect(header.position?.kit).toHaveLength(2)
    expect(header.signature?.executorPosition).toBe('Инженер-конструктор')
  })

  it('старый слепок без шапки печатается умолчаниями, а не падает', () => {
    expect(parseKpHeader(null)).toEqual({})
    expect(parseKpHeader('мусор')).toEqual({})
    expect(parseKpHeader({ position: 42 })).toEqual({})
  })
})

describe('сквозной номер', () => {
  it('приставка и четыре знака', () => {
    expect(formatKpNumber(1, {})).toBe('КП-0001')
    expect(formatKpNumber(42, {})).toBe('КП-0042')
    expect(formatKpNumber(12345, {})).toBe('КП-12345')
  })

  it('приставка меняется переменной окружения', () => {
    expect(formatKpNumber(7, { KP_NUMBER_PREFIX: 'КПВ' })).toBe('КПВ0007')
  })

  it('пустая приставка — «не задана»: так её передаёт docker-compose', () => {
    // 18.09.2026 два КП вышли с номером «0001»: compose отдаёт незаданную
    // переменную пустой строкой, и приставка пропадала.
    expect(formatKpNumber(1, { KP_NUMBER_PREFIX: '' })).toBe('КП-0001')
    expect(formatKpNumber(1, { KP_NUMBER_PREFIX: '   ' })).toBe('КП-0001')
  })

  it('принятый как есть следующий номер — это номер счётчика, а не вписанный свой', () => {
    // Окно подставляет следующий номер; не тронули — счётчик должен вырасти,
    // иначе следующее КП получит тот же номер.
    expect(isSuggestedNumber('КП-0001', 0, {})).toBe(true)
    expect(isSuggestedNumber(' КП-6394 ', 6393, {})).toBe(true)
    expect(isSuggestedNumber('КПВ0008', 7, { KP_NUMBER_PREFIX: 'КПВ' })).toBe(true)
    // Вписанный свой — нет: у журнала корреспонденции своя нумерация.
    expect(isSuggestedNumber('КПВ6393', 0, {})).toBe(false)
    expect(isSuggestedNumber('КП-0001', 1, {})).toBe(false)
  })
})
