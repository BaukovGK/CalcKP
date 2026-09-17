// @vitest-environment jsdom
/**
 * Экран выпуска КП: что менеджер видит и что уходит в выпуск.
 *
 * Черновик приходит с сервера (наименование и состав — из опросного листа),
 * правки менеджера уходят обратно. Тесты держат главное: разделы разведены по
 * меню, номер и условия подставлены, правка состава видна в предпросмотре
 * рядом с таблицей, в выпуск уходит либо состав, либо текст описания — но не
 * оба сразу, а отказ гейта виден на экране со списком строк.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { kpDraft, kp, push, toast } = vi.hoisted(() => ({
  kpDraft: vi.fn(),
  kp: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@/api/estimates', () => ({
  estimatesApi: {
    kpDraft: (id: string) => kpDraft(id),
    kp: (id: string, payload: unknown) => kp(id, payload),
  },
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'e1' } }),
  useRouter: () => ({ push }),
}))
vi.mock('@/composables/useToast', () => ({ toast }))
vi.mock('@/components/ui/ThemeToggle.vue', () => ({ default: { template: '<button />' } }))

const { default: KpIssueView } = await import('./KpIssueView.vue')

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
    executorName: 'Петров П.П.',
    executorPosition: 'Инженер-конструктор',
    executorPhone: '+7 (499) 000-00-00 доб. 101',
    executorEmail: 'petrov@example.test',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  kpDraft.mockResolvedValue(JSON.parse(JSON.stringify(DRAFT)))
  kp.mockResolvedValue({
    kp: { number: 'КП-0007' },
    snapshot: { version: 4, priceListVersion: 5 },
  })
})

async function open() {
  const w = mount(KpIssueView)
  await flushPromises()
  return w
}

type Wrapper = Awaited<ReturnType<typeof open>>

const menu = (w: Wrapper) => w.findAll('.nav-link')
const goTo = async (w: Wrapper, label: string) => {
  await menu(w).find((b) => b.text().startsWith(label))!.trigger('click')
}
const issueBtn = (w: Wrapper) => w.findAll('button').find((b) => b.text().includes('Выпустить КП'))!
/** Раздел «Комплектация» открывается текстом; таблица — по переключателю. */
const asTable = async (w: Wrapper) => {
  await w.find('.kpv-kit .kpv-tgl input[type="checkbox"]').setValue(true)
}
/** Что ушло в выпуск: тело единственного вызова. */
const sent = () => kp.mock.calls[0]?.[1] as Record<string, never>

describe('экран выпуска КП', () => {
  it('разделы разведены по боковому меню, открыт первый', async () => {
    const w = await open()

    expect(kpDraft).toHaveBeenCalledWith('e1')
    expect(menu(w).map((b) => b.text().replace(/\s+\d+$/, ''))).toEqual([
      'Изделие',
      'Комплектация',
      'Условия',
      'Подпись',
    ])
    // Состав виден счётчиком в меню, не открывая раздел.
    expect(menu(w)[1]!.find('.kpv-cnt').text()).toBe('2')
    // Разделы показываются по одному: в этом и был смысл ухода из окна.
    expect(w.find('.kpv-tbl').exists()).toBe(false)
  })

  it('подставляет номер, условия и подпись из черновика', async () => {
    const w = await open()

    const head = w.find('.ol-grid').findAll('input')
    expect((head[0]!.element as HTMLInputElement).value).toBe('КП-0007')
    // Заказчик и объект — только показать: правятся они в карточке проекта.
    expect((head[1]!.element as HTMLInputElement).value).toBe('ООО «Заказчик»')
    expect(head[1]!.attributes('disabled')).toBeDefined()

    await goTo(w, 'Условия')
    const date = w.find('input[type="date"]').element as HTMLInputElement
    expect(date.value).toBe('2026-10-01')
  })

  it('состав открывается текстом: строка на позицию, целиком', async () => {
    const w = await open()
    await goTo(w, 'Комплектация')

    const area = w.find('textarea.kpv-text--kit')
    expect((area.element as HTMLTextAreaElement).value.split('\n')).toEqual([
      'Стеклокомпозитный корпус - 1 шт.',
      'Лестница из нержавеющей стали - 1 шт.',
    ])
    expect(w.find('.kpv-tbl').exists()).toBe(false)
  })

  it('правка текста сразу видна в предпросмотре и уходит в выпуск', async () => {
    const w = await open()
    await goTo(w, 'Комплектация')

    await w.find('textarea.kpv-text--kit').setValue(
      ['Стеклокомпозитный корпус - 1 шт.', 'Лестница из нержавеющей стали - 2 шт.', 'Шкаф управления - 1 компл.'].join('\n'),
    )
    const prev = w.find('.kpv-prev').text()
    expect(prev).toContain('- Лестница из нержавеющей стали - 2 шт.;')
    expect(prev).toContain('- Шкаф управления - 1 компл.;')

    await issueBtn(w).trigger('click')
    await flushPromises()
    const payload = sent() as unknown as { position: { kit: Array<{ name: string; qty: number; unit: string }> } }
    expect(payload.position.kit).toEqual([
      { name: 'Стеклокомпозитный корпус', qty: 1, unit: 'шт.' },
      { name: 'Лестница из нержавеющей стали', qty: 2, unit: 'шт.' },
      { name: 'Шкаф управления', qty: 1, unit: 'компл.' },
    ])
  })

  it('таблицей — по переключателю, правка в ней пересобирает предпросмотр', async () => {
    const w = await open()
    await goTo(w, 'Комплектация')
    await asTable(w)

    const rows = w.findAll('.kpv-tbl tbody tr')
    expect(rows).toHaveLength(2)

    await rows[1]!.findAll('input')[1]!.setValue('3')
    const prev = w.find('.kpv-prev').text()
    expect(prev).toContain('- Лестница из нержавеющей стали - 3 шт.;')
    // Заголовок изделия остался на месте — правится только список.
    expect(prev).toContain('Стеклокомпозитная канализационная насосная станция')
  })

  it('в выпуск уходят номер, состав, условия и подпись', async () => {
    const w = await open()
    await issueBtn(w).trigger('click')
    await flushPromises()

    const payload = sent() as unknown as {
      number: string
      position: { kit: Array<{ name: string }>; description?: string; unit: string }
      terms: { validUntil: string; excluded: string[]; prepaymentPct: number }
      signature: { signerTitle: string; executorName: string; executorPosition: string; executorPhone: string }
    }
    expect(kp).toHaveBeenCalledWith('e1', expect.anything())
    expect(payload.number).toBe('КП-0007')
    expect(payload.position.kit.map((i) => i.name)).toEqual([
      'Стеклокомпозитный корпус',
      'Лестница из нержавеющей стали',
    ])
    expect(payload.position.description).toBeUndefined()
    expect(payload.position.unit).toBe('компл.')
    expect(payload.terms.validUntil?.slice(0, 10)).toBe('2026-10-01')
    expect(payload.terms.excluded).toHaveLength(2)
    expect(payload.terms.prepaymentPct).toBe(70)
    expect(payload.signature.signerTitle).toBe('Коммерческий директор')
    // Исполнитель, его должность и телефон приходят из учётной записи автора.
    expect(payload.signature.executorName).toBe('Петров П.П.')
    expect(payload.signature.executorPosition).toBe('Инженер-конструктор')
    expect(payload.signature.executorPhone).toBe('+7 (499) 000-00-00 доб. 101')
  })

  it('после выпуска возвращает в расчёт и говорит номер', async () => {
    const w = await open()
    await issueBtn(w).trigger('click')
    await flushPromises()

    expect(toast).toHaveBeenCalledWith(expect.stringContaining('КП-0007'), 'success')
    expect(push).toHaveBeenCalledWith({ name: 'calculator', params: { id: 'e1' } })
  })

  it('пустые строки состава в документ не уходят', async () => {
    const w = await open()
    await goTo(w, 'Комплектация')
    await asTable(w)
    await w.findAll('button').find((b) => b.text() === '+ строка')!.trigger('click')
    await issueBtn(w).trigger('click')
    await flushPromises()

    const payload = sent() as unknown as { position: { kit: unknown[] } }
    expect(payload.position.kit).toHaveLength(2)
  })

  it('ручной текст описания заменяет и черновик, и состав', async () => {
    const w = await open()
    await w.find('.kpv-tgl input[type="checkbox"]').setValue(true)
    await w.find('textarea.kpv-text').setValue('Станция по чертежу заказчика')
    await issueBtn(w).trigger('click')
    await flushPromises()

    const payload = sent() as unknown as { position: { description: string; kit?: unknown[] } }
    expect(payload.position.description).toBe('Станция по чертежу заказчика')
    expect(payload.position.kit).toBeUndefined()

    // Список состава спрятан: править его и текст одновременно нельзя.
    await goTo(w, 'Комплектация')
    expect(w.find('.kpv-tbl').exists()).toBe(false)
    expect(w.find('.kpv-note').text()).toContain('состав в документ не пойдёт')
  })

  it('отказ гейта виден на экране, а строки открываются в расчёте', async () => {
    kp.mockRejectedValue({
      response: {
        data: {
          code: 'ROWS_WITHOUT_PRICE',
          message: 'В расчёте 4 строки без цены',
          rows: [{ name: 'Труба корпуса', unit: 'м' }, { name: 'Люк', unit: 'шт.' }],
        },
      },
    })
    const w = await open()
    await issueBtn(w).trigger('click')
    await flushPromises()

    expect(w.find('.kpv-block-msg').text()).toBe('В расчёте 4 строки без цены')
    expect(w.findAll('.kpv-block-list li')).toHaveLength(2)
    // На экране выпуска остаёмся: чинить нечего, пока не ушли в расчёт.
    expect(push).not.toHaveBeenCalled()

    await w.findAll('button').find((b) => b.text() === 'Показать строки в расчёте')!.trigger('click')
    expect(push).toHaveBeenCalledWith({
      name: 'calculator',
      params: { id: 'e1' },
      query: { rows: 'missing' },
    })
  })

  it('у каждой подписи поля есть сноска', async () => {
    const w = await open()
    const captions = w.findAll('.fld > span')

    expect(captions.length).toBeGreaterThan(8)
    expect(captions.filter((c) => c.attributes('data-hint') === undefined).map((c) => c.text())).toEqual([])
  })

  it('отказ сервера в черновике показывает причину, а не пустой экран', async () => {
    kpDraft.mockRejectedValue({ response: { data: { message: 'Расчёт не найден' } } })
    const w = await open()

    expect(w.find('.kpv-state--err').text()).toBe('Расчёт не найден')
    expect(issueBtn(w).attributes('disabled')).toBeDefined()
  })
})
