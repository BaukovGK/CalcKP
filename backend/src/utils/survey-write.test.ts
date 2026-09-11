import { describe, expect, it } from 'vitest'
import { isStaleTreeWrite, isSurveyRevRegression, isVersionConflict } from './survey-write'

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

// План_устранения 3.1: долго открытый ОЛ перезаписывал ручные правки,
// сохранённые с экрана расчёта в другой вкладке.
describe('isVersionConflict', () => {
  it('клиент работал с другой версией — конфликт', () => {
    expect(isVersionConflict(8, 7)).toBe(true)
    expect(isVersionConflict(8, 8)).toBe(false)
  })

  it('клиент без версии (до её появления) — не проверяется', () => {
    expect(isVersionConflict(8, undefined)).toBe(false)
    expect(isVersionConflict(8, '7')).toBe(false)
  })
})

describe('isSurveyRevRegression', () => {
  it('ревизия ОЛ ниже сохранённой — устаревшая вкладка', () => {
    expect(isSurveyRevRegression({ surveyRev: 5 }, { surveyRev: 4 })).toBe(true)
    expect(isSurveyRevRegression({ surveyRev: 5 }, { surveyRev: 5 })).toBe(false)
    expect(isSurveyRevRegression({ surveyRev: 5 }, { surveyRev: 6 })).toBe(false)
  })

  it('запись без ревизии ОЛ (экран расчёта) и расчёт без ревизий — не проверяются', () => {
    expect(isSurveyRevRegression({ surveyRev: 5 }, { tree: {} })).toBe(false)
    expect(isSurveyRevRegression(null, { surveyRev: 0 })).toBe(false)
  })
})
