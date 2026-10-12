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

const { kpDraft, kp, kpExport, push, toast } = vi.hoisted(() => ({
  kpDraft: vi.fn(),
  kp: vi.fn(),
  kpExport: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@/api/estimates', () => ({
  estimatesApi: {
    kpDraft: (id: string) => kpDraft(id),
    kp: (id: string, payload: unknown) => kp(id, payload),
    kpExport: (id: string, format: string, version: number) => kpExport(id, format, version),
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
  kpExport.mockResolvedValue(new Blob(['%PDF-1.7'], { type: 'application/pdf' }))
  URL.createObjectURL = vi.fn(() => 'blob:kp-download')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
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
const confirmBtn = (w: Wrapper) => w.find('.mo-ft .btn-acc')
async function issueAndDownload(w: Wrapper) {
  await issueBtn(w).trigger('click')
  await confirmBtn(w).trigger('click')
  await flushPromises()
}
/** Что ушло в выпуск: тело единственного вызова. */
const sent = () => kp.mock.calls[0]?.[1] as Record<string, never>

describe('экран выпуска КП', () => {
  it('сначала открывает выбор формата; отмена не выпускает КП', async () => {
    const w = await open()
    await issueBtn(w).trigger('click')
    expect(w.find('.mo-tt').text()).toBe('Формат КП')
    expect(w.findAll('.kpv-format strong').map((el) => el.text())).toEqual(['PDF', 'Word (.docx)', 'Excel (.xlsx)'])
    expect((w.find('input[value="pdf"]').element as HTMLInputElement).checked).toBe(true)
    expect(kp).not.toHaveBeenCalled()
    await w.find('.mo-ft .btn').trigger('click')
    expect(w.find('.mo').exists()).toBe(false)
    expect(kp).not.toHaveBeenCalled()
    expect(kpExport).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it.each(['pdf', 'docx', 'xlsx'])('выпускает КП и скачивает выбранный формат %s по точной редакции', async (format) => {
    const w = await open()
    await issueBtn(w).trigger('click')
    await w.find(`input[value="${format}"]`).setValue(true)
    await confirmBtn(w).trigger('click')
    await flushPromises()
    expect(kp).toHaveBeenCalledTimes(1)
    expect(kpExport).toHaveBeenCalledWith('e1', format, 4)
    const link = vi.mocked(HTMLAnchorElement.prototype.click).mock.instances[0] as unknown as HTMLAnchorElement
    expect(link.download).toBe(`КП_КП-0007_v4.${format}`)
    expect(link.href).toBe('blob:kp-download')
    expect(push).toHaveBeenCalledWith({ name: 'calculator', params: { id: 'e1' } })
  })

  it('при ошибке скачивания остаётся на экране и повторяет выгрузку без нового выпуска', async () => {
    kpExport.mockRejectedValueOnce({ isAxiosError: true, response: { data: { message: 'Файл временно недоступен' } } })
    const w = await open()
    await issueAndDownload(w)
    expect(kp).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
    expect(w.find('.mo [role="alert"]').text()).toContain('Файл временно недоступен')
    expect(w.text()).toContain('КП КП-0007 выпущено')
    expect(confirmBtn(w).text()).toBe('Скачать')
    await w.find('input[value="docx"]').setValue(true)
    await confirmBtn(w).trigger('click')
    await flushPromises()
    expect(kp).toHaveBeenCalledTimes(1)
    expect(kpExport).toHaveBeenLastCalledWith('e1', 'docx', 4)
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('возвращается в расчёт только после получения файла', async () => {
    let finish: (value: Blob) => void = () => {}
    kpExport.mockReturnValueOnce(new Promise<Blob>((resolve) => { finish = resolve }))
    const w = await open()
    await issueAndDownload(w)
    expect(kpExport).toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(confirmBtn(w).attributes('disabled')).toBeDefined()
    finish(new Blob(['%PDF-1.7']))
    await flushPromises()
    expect(push).toHaveBeenCalledTimes(1)
  })

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
    expect(w.find('.kit-list').exists()).toBe(false)
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

  it('состав — список позиций: наименование многострочным полем, количество и единица рядом', async () => {
    const w = await open()
    await goTo(w, 'Комплектация')

    const rows = w.findAll('.kit-row')
    expect(rows).toHaveLength(2)
    // Наименование — textarea, а не однострочное поле: у КНС оно в сотню знаков.
    expect((rows[0]!.find('textarea.kit-name').element as HTMLTextAreaElement).value).toBe('Стеклокомпозитный корпус')
    expect((rows[0]!.find('input.kit-qty').element as HTMLInputElement).value).toBe('1')
    expect((rows[0]!.find('input.kit-unit').element as HTMLInputElement).value).toBe('шт.')
    // Заголовок изделия над списком — контекст, без самого списка.
    expect(w.find('.kpv-head-prev').text()).toContain('Стеклокомпозитная канализационная насосная станция')
    expect(w.find('.kpv-head-prev').text()).not.toContain('В комплекте')
  })

  it('правка позиции уходит в выпуск, лишняя позиция убирается', async () => {
    const w = await open()
    await goTo(w, 'Комплектация')

    await w.findAll('.kit-row')[1]!.find('input.kit-qty').setValue('2')
    await w.findAll('.kit-row')[1]!.find('textarea.kit-name').setValue('Лестница из нержавеющей стали с ограждением')
    await w.findAll('button').find((b) => b.text() === '+ строка')!.trigger('click')
    await w.findAll('.kit-row')[2]!.find('textarea.kit-name').setValue('Шкаф управления')
    await w.findAll('.kit-row')[2]!.find('input.kit-unit').setValue('компл.')
    await w.findAll('.kit-row')[0]!.find('.kit-drop').trigger('click')

    await issueAndDownload(w)
    const payload = sent() as unknown as { position: { kit: Array<{ name: string; qty: number; unit: string }> } }
    expect(payload.position.kit).toEqual([
      { name: 'Лестница из нержавеющей стали с ограждением', qty: 2, unit: 'шт.' },
      { name: 'Шкаф управления', qty: 1, unit: 'компл.' },
    ])
  })

  it('в выпуск уходят номер, состав, условия и подпись', async () => {
    const w = await open()
    await issueAndDownload(w)

    const payload = sent() as unknown as {
      number: string
      position: { kit: Array<{ name: string }>; description?: string; unit: string }
      terms: { validUntil: string; excluded: string[]; prepaymentPct: number }
      signature: { signerTitle: string; executorName: string; executorPosition: string; executorPhone: string }
    }
    expect(kp).toHaveBeenCalledWith('e1', expect.anything())
    // Номер не меняли — не уходит: его выдаст и потратит счётчик. Прежде
    // уходил как «вписанный», счётчик стоял, и КП подряд получали один номер.
    expect(payload.number).toBeUndefined()
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

  it('вписанный свой номер уходит в выпуск', async () => {
    const w = await open()
    await w.find('.ol-grid').findAll('input')[0]!.setValue('КПВ6394')
    await issueAndDownload(w)

    expect((sent() as unknown as { number?: string }).number).toBe('КПВ6394')
  })

  it('после выпуска возвращает в расчёт и говорит номер', async () => {
    const w = await open()
    await issueAndDownload(w)

    expect(toast).toHaveBeenCalledWith(expect.stringContaining('КП-0007'), 'success')
    expect(push).toHaveBeenCalledWith({ name: 'calculator', params: { id: 'e1' } })
  })

  it('пустые строки состава в документ не уходят', async () => {
    const w = await open()
    await goTo(w, 'Комплектация')
    await w.findAll('button').find((b) => b.text() === '+ строка')!.trigger('click')
    await issueAndDownload(w)

    const payload = sent() as unknown as { position: { kit: unknown[] } }
    expect(payload.position.kit).toHaveLength(2)
  })

  it('ручной текст описания заменяет и черновик, и состав', async () => {
    const w = await open()
    await w.find('.kpv-tgl input[type="checkbox"]').setValue(true)
    await w.find('textarea.kpv-text').setValue('Станция по чертежу заказчика')
    await goTo(w, 'Комплектация')
    expect(w.find('.kit-list').exists()).toBe(false)
    expect(w.find('.kpv-note').text()).toContain('состав в документ не пойдёт')
    await issueAndDownload(w)

    const payload = sent() as unknown as { position: { description: string; kit?: unknown[] } }
    expect(payload.position.description).toBe('Станция по чертежу заказчика')
    expect(payload.position.kit).toBeUndefined()


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
    await issueAndDownload(w)

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
