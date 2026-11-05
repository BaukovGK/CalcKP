// @vitest-environment jsdom
/**
 * Админка → Битрикс24: состояние вкладки в карточке сделки, подключение,
 * отключение через подтверждение, отказ портала — текстом сервера.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dealTab, bindDealTab, unbindDealTab } = vi.hoisted(() => ({
  dealTab: vi.fn(), bindDealTab: vi.fn(), unbindDealTab: vi.fn(),
}))
vi.mock('@/api/admin', () => ({ b24AdminApi: { dealTab, bindDealTab, unbindDealTab } }))

const { default: B24Panel } = await import('./B24Panel.vue')

const H = 'https://calc.ntt.su/api/auth/bitrix/launch'
const OFF = { handler: H, bound: false, current: false, handlers: [] }
const ON = { handler: H, bound: true, current: true, handlers: [H] }

const mountPanel = () => mount(B24Panel, {
  global: { stubs: { BaseModal: { props: ['show'], template: '<div v-if="show" class="modal"><slot /><slot name="footer" /></div>' } } },
})

beforeEach(() => vi.clearAllMocks())

describe('вкладка в сделках', () => {
  it('не подключена — кнопка подключает', async () => {
    dealTab.mockResolvedValue(OFF)
    bindDealTab.mockResolvedValue(ON)
    const w = mountPanel()
    await flushPromises()
    expect(w.text()).toContain('не подключена')
    await w.find('.btn-acc').trigger('click')
    await flushPromises()
    expect(bindDealTab).toHaveBeenCalled()
    expect(w.text()).toContain('подключена')
    expect(w.text()).not.toContain('не подключена')
  })

  it('старый адрес — «Переподключить»', async () => {
    dealTab.mockResolvedValue({ ...OFF, bound: true, handlers: ['https://old/launch'] })
    const w = mountPanel()
    await flushPromises()
    expect(w.text()).toContain('подключена на другой адрес')
    expect(w.text()).toContain('https://old/launch')
    expect(w.find('.btn-acc').text()).toBe('Переподключить')
  })

  it('отключение — только после подтверждения', async () => {
    dealTab.mockResolvedValue(ON)
    unbindDealTab.mockResolvedValue(OFF)
    const w = mountPanel()
    await flushPromises()
    const off = w.findAll('button').find(b => b.text() === 'Отключить')!
    await off.trigger('click')
    expect(unbindDealTab).not.toHaveBeenCalled()
    await w.find('.modal .btn-acc').trigger('click')
    await flushPromises()
    expect(unbindDealTab).toHaveBeenCalled()
    expect(w.text()).toContain('не подключена')
  })

  it('портал отказал — текст сервера', async () => {
    dealTab.mockRejectedValue({ isAxiosError: true, response: { status: 403, data: { message: 'Битрикс24 отказал: подключать вкладку может только администратор портала' } } })
    const w = mountPanel()
    await flushPromises()
    expect(w.find('.b24-err').text()).toContain('только администратор портала')
  })
})
