/**
 * Печатная форма КП собирается и открывается: docx — zip с документом, PDF —
 * настоящий PDF с кириллицей.
 *
 * Вёрстку эти тесты не проверяют (для этого её надо смотреть глазами), но
 * ловят то, что ломается молча: несобираемый документ, пустой буфер, потерю
 * шрифта с кириллицей.
 */
import { describe, expect, it } from 'vitest'
import { buildKpDocument, type KpDocumentInput } from './kp-document'
import { renderKpDocx } from './kp-docx'
import { renderKpPdf } from './kp-pdf'

/** Опросный лист КНС — как его сохраняет экран ОЛ. */
const survey = {
  totals: { tirage: 2, salePriceRub: 2_400_000 },
  form: {
    tipNs: 'Канализационная',
    dn: '3000',
    vozv: '300',
    mvk: true,
    insulation: true,
    tiGlubina: '2000',
    podvDn: '250',
    podvKol: '1',
    napDn: '150',
    napKol: '2',
    rashod: '25,13',
    rashodUnit: 'l/s',
    napor: '12,9',
    nRab: '2',
    nRez: '1',
    nZap: '0',
    drobilka: 'корзина',
    shu: true,
    shuTip: 'уличный',
    shuPusk: 'плавный',
    datchikiDavl: true,
    datchikiUrov: true,
    rashodomer: true,
  },
  derived: {
    npodzMm: 11600,
    fullHeightMm: 11900,
    sn: 10000,
    pn: 0.1,
    gates: 1,
    balls: 3,
    checkValves: 2,
    pumpModel: 'VSL.100.55.4.5.0D',
  },
}

const input: KpDocumentInput = {
  estimateId: '1a2b3c4d-0000-0000-0000-000000000000',
  estimateTitle: 'КНС 3 000×11 900 мм',
  deviceType: 'KNS',
  wallMm: 55.1,
  number: 'КП-0042',
  project: { title: 'Очистные сооружения', customer: 'ООО «Заказчик»', address: 'г. Москва' },
  signature: { signerName: 'И.О. Фамилия' },
  executor: { name: 'П.П. Петров', email: 'petrov@example.test' },
  snapshot: {
    version: 3,
    priceListVersion: 5,
    totalRub: 2_400_000,
    createdAt: new Date('2026-09-17T09:00:00Z'),
    bundlesJson: survey,
  },
}

describe('печать КП', () => {
  const doc = buildKpDocument(input)

  it('позиция несёт описание изделия, количество, цену и сумму', () => {
    const position = doc.positions[0]!

    expect(position.description).toContain('Стеклокомпозитная канализационная насосная станция')
    expect(position.description).toContain('SN12000') // обозначение по ТТ МВК
    expect(position.description).toContain('В комплекте:')
    expect(position.qty).toBe(2)
    expect(position.priceRub).toBe(1_200_000)
    expect(position.totalRub).toBe(2_400_000)
  })

  it('docx собирается и остаётся документом Word', async () => {
    const body = await renderKpDocx(doc)

    expect(body.length).toBeGreaterThan(5_000)
    // Сигнатура zip: .docx — это архив с word/document.xml внутри.
    expect(body.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('PDF собирается и открывается', async () => {
    const body = await renderKpPdf(doc)

    expect(body.length).toBeGreaterThan(5_000)
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(body.subarray(-6).toString('latin1')).toContain('EOF')
  })
})
