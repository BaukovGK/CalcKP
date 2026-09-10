/**
 * Что можно делать со слепком — по причине, с которой он снят.
 *
 * Держит два дефекта, которые появились бы вместе со слепком при создании
 * единицы, не будь у слепка причины: каждая новая единица стала бы
 * неудаляемой, а КП на проект напечатался бы по непроверенному расчёту.
 */
import { describe, expect, it } from 'vitest'
import { blocksDeletion, isPrintable, PRINTABLE_REASONS, REASON_LABEL } from './snapshot-reason'

describe('причина слепка', () => {
  it('КП печатается по выпуску КП и по ручной фиксации, но не по слепку создания', () => {
    expect(isPrintable('KP')).toBe(true)
    expect(isPrintable('MANUAL')).toBe(true)
    // Слепок создания проверку строк без цены не проходил.
    expect(isPrintable('CREATE')).toBe(false)
    expect([...PRINTABLE_REASONS].sort()).toEqual(['KP', 'MANUAL'])
  })

  it('слепок создания не мешает удалить единицу, остальные мешают', () => {
    expect(blocksDeletion('CREATE')).toBe(false)
    expect(blocksDeletion('MANUAL')).toBe(true)
    expect(blocksDeletion('KP')).toBe(true)
  })

  it('у каждой причины есть подпись для людей', () => {
    expect(REASON_LABEL.CREATE).toBe('создание единицы')
    expect(Object.keys(REASON_LABEL).sort()).toEqual(['CREATE', 'KP', 'MANUAL'])
  })
})
