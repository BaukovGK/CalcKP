/**
 * Отчёты о нарушениях CSP: оба формата браузеров, без адресных параметров
 * (в них бывает одноразовый код входа), мусор не роняет, повторы — один раз.
 */
import { describe, expect, it } from 'vitest'
import { createCspDeduper, parseCspReport } from './csp-report'

describe('разбор отчёта', () => {
  it('старый формат report-uri', () => {
    expect(parseCspReport({
      'csp-report': {
        'document-uri': 'https://calc.ntt.su/prices?tab=1',
        'violated-directive': 'img-src',
        'effective-directive': 'img-src',
        'blocked-uri': 'https://cdn.example.com/a.png?x=1',
        'source-file': 'https://calc.ntt.su/assets/index-abc.js',
        'line-number': 42,
        disposition: 'report',
      },
    })).toEqual([{
      page: 'https://calc.ntt.su/prices',
      directive: 'img-src',
      blocked: 'https://cdn.example.com/a.png',
      source: 'https://calc.ntt.su/assets/index-abc.js:42',
      disposition: 'report',
    }])
  })

  it('Reporting API — массив, чужие типы пропускаются', () => {
    const got = parseCspReport([
      { type: 'csp-violation', body: { documentURL: 'https://calc.ntt.su/', effectiveDirective: 'script-src-elem', blockedURL: 'inline' } },
      { type: 'deprecation', body: { id: 'x' } },
    ])
    expect(got).toEqual([{ page: 'https://calc.ntt.su/', directive: 'script-src-elem', blocked: 'inline' }])
  })

  it('одноразовый код входа из адреса в лог не попадает', () => {
    const [v] = parseCspReport({ 'csp-report': { 'document-uri': 'https://calc.ntt.su/bitrix?code=SECRET', 'violated-directive': 'frame-ancestors' } })
    expect(v!.page).toBe('https://calc.ntt.su/bitrix')
    expect(JSON.stringify(v)).not.toContain('SECRET')
  })

  it('старые браузеры — правило с источниками, берётся только имя', () => {
    const [v] = parseCspReport({ 'csp-report': { 'document-uri': 'https://calc.ntt.su/', 'violated-directive': "style-src 'self'" } })
    expect(v!.directive).toBe('style-src')
  })

  it('мусор — пустой список, без исключений', () => {
    for (const junk of [null, undefined, 'строка', 42, {}, [], { 'csp-report': 'x' }, { 'csp-report': { 'document-uri': 'https://a/' } }]) {
      expect(parseCspReport(junk)).toEqual([])
    }
  })

  it('длинные строки обрезаются', () => {
    const [v] = parseCspReport({ 'csp-report': { 'document-uri': 'https://calc.ntt.su/', 'violated-directive': 'img-src', 'blocked-uri': `data:${'a'.repeat(5000)}` } })
    expect(v!.blocked.length).toBeLessThanOrEqual(300)
  })
})

describe('повторы', () => {
  const v = { page: 'https://calc.ntt.su/', directive: 'img-src', blocked: 'https://cdn/a.png' }

  it('одно и то же — раз в окно', () => {
    const fresh = createCspDeduper(1000)
    expect(fresh(v, 0)).toBe(true)
    expect(fresh(v, 500)).toBe(false)
    expect(fresh(v, 1000)).toBe(true)
  })

  it('другое нарушение — пишется сразу', () => {
    const fresh = createCspDeduper(1000)
    expect(fresh(v, 0)).toBe(true)
    expect(fresh({ ...v, blocked: 'inline' }, 1)).toBe(true)
  })
})
