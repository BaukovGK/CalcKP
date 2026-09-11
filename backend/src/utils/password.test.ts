/**
 * Временные пароли — первого администратора и сброса (План_устранения 2.1).
 */
import { describe, expect, it } from 'vitest'
import { MIN_PASSWORD_LENGTH, temporaryPassword } from './password'

describe('временный пароль', () => {
  it('длиннее минимума и без похожих знаков', () => {
    for (let i = 0; i < 200; i++) {
      const p = temporaryPassword()
      expect(p.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH)
      expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/)
    }
  })

  it('каждый раз новый', () => {
    const seen = new Set(Array.from({ length: 500 }, () => temporaryPassword()))
    expect(seen.size).toBe(500)
  })
})
