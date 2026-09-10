import { describe, expect, it } from 'vitest'
import { isStaleTreeWrite } from './survey-write'

describe('isStaleTreeWrite', () => {
  const stored = { surveyRev: 5, treeSurveyRev: 5 }

  // Расчёт открыт в другой вкладке, ОЛ тем временем поправили до ревизии 5.
  it('дерево из старого ОЛ, сохранённое из расчёта, — устаревшая запись', () => {
    expect(isStaleTreeWrite(stored, { tree: {}, treeSurveyRev: 4 })).toBe(true)
  })

  it('дерево из текущего ОЛ — обычное сохранение', () => {
    expect(isStaleTreeWrite(stored, { tree: {}, treeSurveyRev: 5 })).toBe(false)
  })

  it('запись самого ОЛ не проверяется — она и приносит новую ревизию', () => {
    expect(isStaleTreeWrite(stored, { tree: {}, treeSurveyRev: 6, surveyRev: 6, form: {} })).toBe(false)
  })

  it('запись без дерева (только ОЛ) не проверяется', () => {
    expect(isStaleTreeWrite(stored, { form: {} })).toBe(false)
  })

  it('расчёт без ревизий (до их появления) не блокируется', () => {
    expect(isStaleTreeWrite({}, { tree: {}, treeSurveyRev: 0 })).toBe(false)
    expect(isStaleTreeWrite(null, { tree: {}, treeSurveyRev: 0 })).toBe(false)
  })
})
