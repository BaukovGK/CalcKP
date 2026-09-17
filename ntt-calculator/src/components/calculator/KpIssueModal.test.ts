// @vitest-environment jsdom
/**
 * Окно выпуска КП: что менеджер видит и что уходит в выпуск.
 *
 * Черновик приходит с сервера (наименование и состав — из опросного листа),
 * правки менеджера уходят обратно. Тесты держат главное: номер и условия
 * подставлены, правка состава видна в предпросмотре, а в выпуск уходит либо
 * состав, либо текст описания — но не оба сразу.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const { kpDraft } = vi.hoisted(() => ({ kpDraft: vi.fn() }))
vi.mock('@/api/estimates', () => ({ estimatesApi: { kpDraft: (id: string) => kpDraft(id) } }))

const { default: KpIssueModal } = await import('./KpIssueModal.vue')

const DRAFT = {
  number: 'КП-0007',
  issuedAt: '2026-09-17T09:00:00.000Z',
  customer: 'ООО «Заказчик»',
  object: 'Очистные сооружения, г. Пушкино',
  position: {
    number: '1.1',
    tag: null,
    mark: null,
    tu: 'ТУ 4859-006-81652345-2019',
    description:
      'Стеклокомпозитная канализационная насосная станция «НТТ» GRP ТУ 4859-006-81652345-2019.\n' +
      'Изделие соответствует ТУ 4859-006-81652345-2019.\n' +
      'В комплекте:\n- Стеклокомпозитный корпус - 1 шт.;\n- Лестница из нержавеющей стали - 1 шт.;',
    kit: [
      { name: 'Стеклокомпозитный корпус', qty: 1, unit: 'шт.' },
      { name: 'Лестница из нержавеющей стали', qty: 1, unit: 'шт.' },
    ],
    qty: 2,
    unit: 'компл.',
    priceRub: 1_200_000,
    totalRub: 2_400_000,
  },
  terms: {
    vatRatePct: 22,
    deliveryTo: 'Очистные сооружения, г. Пушкино',
    shipmentFrom: 'д. Коврово',
    validUntil: '2026-10-01T09:00:00.000Z',
    prepaymentPct: 70,
    paymentDays: 3,
    leadTimeDays: '40-50',
    euroThresholdPct: 5,
    excluded: ['Пусконаладка не входит.', 'Электромонтаж не входит.'],
  },
  signature: {
    signerTitle: 'Коммерческий директор',
    signerName: null,
    executorName: 'Пётр Петров',
    executorPhone: null,
    executorEmail: 'petrov@example.test',
  },
}

async function open() {
  kpDraft.mockResolvedValue(JSON.parse(JSON.stringify(DRAFT)))
  const w = mount(KpIssueModal, { props: { show: true, estimateId: 'e1' } })
  await flushPromises()
  return w
}

type Wrapper = Awaited<ReturnType<typeof open>>
const submitBtn = (w: Wrapper) => w.findAll('button').find((b) => b.text().includes('Выпустить КП'))!
const payload = (w: Wrapper) => w.emitted('submit')?.[0]?.[0] as Record<string, never>

describe('окно выпуска КП', () => {
  it('подставляет номер, условия и подпись из черновика', async () => {
    const w = await open()

    expect(kpDraft).toHaveBeenCalledWith('e1')
    const head = w.findAll('.kpi-sec').at(0)!.findAll('input')
    expect((head[0]!.element as HTMLInputElement).value).toBe('КП-0007')
    // Заказчик и объект — только показать: правятся они в карточке проекта.
    expect((head[1]!.element as HTMLInputElement).value).toBe('ООО «Заказчик»')
    expect(head[1]!.attributes('disabled')).toBeDefined()
    expect((head[2]!.element as HTMLInputElement).value).toBe('Очистные сооружения, г. Пушкино')
    const date = w.find('input[type="date"]').element as HTMLInputElement
    expect(date.value).toBe('2026-10-01')
  })

  it('показывает состав строками и пересобирает предпросмотр при правке', async () => {
    const w = await open()
    const rows = w.findAll('.kpi-tbl tbody tr')
    expect(rows).toHaveLength(2)

    await rows[1]!.findAll('input')[1]!.setValue('3')
    expect(w.find('.kpi-prev').text()).toContain('- Лестница из нержавеющей стали - 3 шт.;')
    // Заголовок изделия остался на месте — правится только список.
    expect(w.find('.kpi-prev').text()).toContain('Стеклокомпозитная канализационная насосная станция')
  })

  it('в выпуск уходят номер, состав, условия и подпись', async () => {
    const w = await open()
    await submitBtn(w).trigger('click')

    const sent = payload(w) as unknown as {
      number: string
      position: { kit: Array<{ name: string }>; description?: string; unit: string }
      terms: { validUntil: string; excluded: string[]; prepaymentPct: number }
      signature: { signerTitle: string; executorName: string }
    }
    expect(sent.number).toBe('КП-0007')
    expect(sent.position.kit.map((i) => i.name)).toEqual([
      'Стеклокомпозитный корпус',
      'Лестница из нержавеющей стали',
    ])
    expect(sent.position.description).toBeUndefined()
    expect(sent.position.unit).toBe('компл.')
    expect(sent.terms.validUntil?.slice(0, 10)).toBe('2026-10-01')
    expect(sent.terms.excluded).toHaveLength(2)
    expect(sent.terms.prepaymentPct).toBe(70)
    expect(sent.signature.signerTitle).toBe('Коммерческий директор')
    expect(sent.signature.executorName).toBe('Пётр Петров')
  })

  it('пустые строки состава в документ не уходят', async () => {
    const w = await open()
    await w.findAll('button').find((b) => b.text() === '+ строка')!.trigger('click')
    await submitBtn(w).trigger('click')

    const sent = payload(w) as unknown as { position: { kit: unknown[] } }
    expect(sent.position.kit).toHaveLength(2)
  })

  it('ручной текст описания заменяет и черновик, и состав', async () => {
    const w = await open()
    await w.find('.kpi-tgl input[type="checkbox"]').setValue(true)
    await w.find('textarea.kpi-text').setValue('Станция по чертежу заказчика')
    await submitBtn(w).trigger('click')

    const sent = payload(w) as unknown as { position: { description: string; kit?: unknown[] } }
    expect(sent.position.description).toBe('Станция по чертежу заказчика')
    expect(sent.position.kit).toBeUndefined()
    // Список состава спрятан: править его и текст одновременно нельзя.
    expect(w.find('.kpi-tbl').exists()).toBe(false)
  })

  it('у каждой подписи поля есть сноска', async () => {
    const w = await open()
    const captions = w.findAll('.fld > span')

    expect(captions.length).toBeGreaterThan(10)
    expect(captions.filter((c) => c.attributes('data-hint') === undefined).map((c) => c.text())).toEqual([])
  })

  it('отказ сервера показывает причину, а не пустое окно', async () => {
    kpDraft.mockRejectedValue({ response: { data: { message: 'Расчёт не найден' } } })
    const w = mount(KpIssueModal, { props: { show: true, estimateId: 'nope' } })
    await flushPromises()

    expect(w.find('.kpi-state--err').text()).toBe('Расчёт не найден')
    expect(submitBtn(w).attributes('disabled')).toBeDefined()
  })
})
