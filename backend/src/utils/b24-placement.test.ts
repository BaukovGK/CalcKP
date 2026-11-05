import { describe, expect, it } from 'vitest'
import { dealTabState, launchHandlerUrl } from './b24-placement'

describe('вкладка в карточке сделки', () => {
  it('обработчик — адрес входа на этом сервере, только https', () => {
    expect(launchHandlerUrl('https://calc.ntt.su/')).toBe('https://calc.ntt.su/api/auth/bitrix/launch')
    expect(launchHandlerUrl(' https://calc.ntt.su ')).toBe('https://calc.ntt.su/api/auth/bitrix/launch')
    expect(launchHandlerUrl('http://calc.ntt.su')).toBeNull()
    expect(launchHandlerUrl('')).toBeNull()
    expect(launchHandlerUrl(undefined)).toBeNull()
    expect(launchHandlerUrl('мусор')).toBeNull()
  })

  it('состояние по ответу placement.get', () => {
    const h = 'https://calc.ntt.su/api/auth/bitrix/launch'
    expect(dealTabState([], h)).toEqual({ handler: h, bound: false, current: false, handlers: [] })
    expect(dealTabState([{ placement: 'CRM_DEAL_DETAIL_TAB', handler: h + '/' }, { placement: 'CRM_COMPANY_DETAIL_TAB', handler: 'x' }], h))
      .toMatchObject({ bound: true, current: true, handlers: [h + '/'] })
    // Вкладка ведёт на старый адрес — подключена, но не сюда.
    expect(dealTabState([{ PLACEMENT: 'CRM_DEAL_DETAIL_TAB', HANDLER: 'https://old/launch' }], h))
      .toMatchObject({ bound: true, current: false })
    expect(dealTabState(null, null)).toMatchObject({ bound: false, current: false })
  })
})
