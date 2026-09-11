/**
 * Ограничение частоты входа (План_устранения 2.2): окно, сброс, отказ 429,
 * память под поток подделанных ключей.
 */
import type { Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { createLimiter, limitByIp, retryText } from './rate-limit'

describe('лимитер', () => {
  it('в окне — не больше max попыток; окно кончилось — счёт заново', () => {
    const l = createLimiter({ windowMs: 60_000, max: 3 })
    expect([1, 2, 3].map(() => l.hit('ip', 0).allowed)).toEqual([true, true, true])
    expect(l.hit('ip', 1_000)).toEqual({ allowed: false, retryAfterS: 59 })
    expect(l.hit('ip', 60_000).allowed).toBe(true)
  })

  it('ключи независимы', () => {
    const l = createLimiter({ windowMs: 60_000, max: 1 })
    expect(l.hit('a', 0).allowed).toBe(true)
    expect(l.hit('b', 0).allowed).toBe(true)
    expect(l.hit('a', 0).allowed).toBe(false)
  })

  it('проверка без счёта: неудачные входы исчерпали лимит — вход закрыт до конца окна', () => {
    const l = createLimiter({ windowMs: 60_000, max: 2 })
    expect(l.blocked('mail', 0).allowed).toBe(true)
    l.hit('mail', 0)
    l.hit('mail', 0)
    expect(l.blocked('mail', 30_000)).toEqual({ allowed: false, retryAfterS: 30 })
    expect(l.blocked('mail', 60_000).allowed).toBe(true)
  })

  it('удачный вход сбрасывает счётчик', () => {
    const l = createLimiter({ windowMs: 60_000, max: 2 })
    l.hit('mail', 0)
    l.hit('mail', 0)
    l.reset('mail')
    expect(l.blocked('mail', 0).allowed).toBe(true)
  })

  it('поток подделанных ключей не раздувает память', () => {
    const l = createLimiter({ windowMs: 60_000, max: 5, maxKeys: 100 })
    for (let i = 0; i < 1_000; i++) l.hit(`ip-${i}`, 0)
    // Старые ключи вытеснены: первый снова считается с нуля.
    expect(l.hit('ip-0', 0).allowed).toBe(true)
  })

  it('время ожидания словами', () => {
    expect(retryText(40)).toBe('через 40 с')
    expect(retryText(61)).toBe('через 2 мин')
  })
})

describe('middleware лимита по адресу', () => {
  function run(limiter: ReturnType<typeof createLimiter>) {
    const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() }
    res.status.mockReturnValue(res)
    const next = vi.fn()
    limitByIp(limiter, 'Слишком много попыток входа с этого адреса')({ ip: '10.0.0.1' } as Request, res as unknown as Response, next)
    return { res, next }
  }

  it('в лимите — дальше, сверх — 429 с Retry-After и текстом', () => {
    const l = createLimiter({ windowMs: 60_000, max: 1 })
    expect(run(l).next).toHaveBeenCalled()

    const { res, next } = run(l)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(429)
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String))
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'TOO_MANY_REQUESTS', message: expect.stringMatching(/^Слишком много попыток входа с этого адреса — повторите через/) }),
    )
  })
})
