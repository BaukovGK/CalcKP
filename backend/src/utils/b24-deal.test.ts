import { describe, expect, it } from 'vitest'
import { dealSummary, entityId } from './b24-deal'
import { launchDealId, launchTokens } from './bitrix-auth'

describe('запуск из вкладки сделки', () => {
  it('ID сделки — только из вкладки сделки и только число', () => {
    expect(launchDealId({ placement: 'CRM_DEAL_DETAIL_TAB', placementOptions: '{"ID":"123"}' })).toBe('123')
    expect(launchDealId({ placement: 'CRM_DEAL_DETAIL_TAB', placementOptions: '{"ID":45}' })).toBe('45')
    expect(launchDealId({ placement: 'DEFAULT', placementOptions: '{"ID":"123"}' })).toBeNull()
    expect(launchDealId({ placement: 'CRM_DEAL_DETAIL_TAB', placementOptions: '{"ID":"1/../x"}' })).toBeNull()
    expect(launchDealId({ placement: 'CRM_DEAL_DETAIL_TAB', placementOptions: 'не json' })).toBeNull()
    expect(launchDealId({ placement: 'CRM_DEAL_DETAIL_TAB' })).toBeNull()
  })

  it('ключи из запуска', () => {
    const now = 1_000_000
    expect(launchTokens({ authId: ' A ', refreshId: 'R', authExpires: '3600' }, now))
      .toEqual({ accessToken: 'A', refreshToken: 'R', expiresAt: new Date(now + 3600_000) })
    expect(launchTokens({ authId: 'A', authExpires: 'мусор' }, now))
      .toEqual({ accessToken: 'A', refreshToken: null, expiresAt: new Date(now + 3600_000) })
    expect(launchTokens({ refreshId: 'R' }, now)).toBeNull()
  })
})

describe('шапка сделки', () => {
  it('заказчик — компания, нет её — контакт', () => {
    const deal = { ID: '12', TITLE: 'КНС Протвино', STAGE_ID: 'NEW', OPPORTUNITY: '1500000.00', CURRENCY_ID: 'RUB', COMPANY_ID: '3', CONTACT_ID: '0' }
    const s = dealSummary('nttcrm.bitrix24.ru', deal, { TITLE: 'ООО «Вода»' }, null, { LAST_NAME: 'Иванов', NAME: 'Пётр' })
    expect(s).toEqual({
      id: '12', title: 'КНС Протвино', stageId: 'NEW', opportunity: 1500000, currency: 'RUB',
      companyId: '3', contactId: null, customer: 'ООО «Вода»', assignedName: 'Иванов Пётр',
      url: 'https://nttcrm.bitrix24.ru/crm/deal/details/12/',
    })
    const byContact = dealSummary('p', { ID: '1', COMPANY_ID: '0', CONTACT_ID: '9', OPPORTUNITY: '' }, null, { NAME: 'Анна', LAST_NAME: 'Петрова' }, null)
    expect(byContact).toMatchObject({ title: 'Сделка №1', customer: 'Петрова Анна', opportunity: null, companyId: null, contactId: '9' })
  })

  it('ID «0» — не задан', () => {
    expect(entityId('0')).toBeNull()
    expect(entityId(' 7 ')).toBe('7')
    expect(entityId('7a')).toBeNull()
  })
})
