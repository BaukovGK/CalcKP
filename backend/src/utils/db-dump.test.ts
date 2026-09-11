import { describe, expect, it } from 'vitest'
import { pgConnection, redact } from './db-dump'

// План_устранения, 0.4: пароль БД не попадает ни в аргументы pg_dump и
// pg_restore, ни в тексты ошибок, которые админка получает в ответе API.
describe('подключение утилит дампа без пароля в командной строке', () => {
  it('пароль — в PGPASSWORD, строка подключения — без него', () => {
    const { dbname, env } = pgConnection('postgresql://ntt:s3cr3t@db:5432/ntt_estimates')
    expect(dbname).toBe('postgresql://ntt@db:5432/ntt_estimates')
    expect(env).toEqual({ PGPASSWORD: 's3cr3t' })
  })

  it('экранированный в адресе пароль передаётся раскодированным', () => {
    const { dbname, env } = pgConnection('postgresql://ntt:p%40ss%3Aw%2Fd@db:5432/x?sslmode=require')
    expect(dbname).toBe('postgresql://ntt@db:5432/x?sslmode=require')
    expect(env.PGPASSWORD).toBe('p@ss:w/d')
  })

  it('без пароля — пустое окружение', () => {
    expect(pgConnection('postgresql://ntt@db/x').env).toEqual({})
  })
})

describe('маскировка секретов в текстах ошибок', () => {
  it('пароль в строке подключения заменяется', () => {
    const message =
      'Command failed: pg_restore --dbname=postgresql://ntt:s3cr3t@db:5432/ntt_estimates --clean\n' +
      'pg_restore: error: could not execute query'
    expect(redact(message)).toBe(
      'Command failed: pg_restore --dbname=postgresql://ntt:***@db:5432/ntt_estimates --clean\n' +
        'pg_restore: error: could not execute query',
    )
    expect(redact(message)).not.toContain('s3cr3t')
  })

  it('строка без пароля и обычный текст не меняются', () => {
    expect(redact('postgres://ntt@db/x')).toBe('postgres://ntt@db/x')
    expect(redact('Дамп создан, но нечитаем')).toBe('Дамп создан, но нечитаем')
  })
})
