import { describe, expect, it } from 'vitest'
import { compareMigrations, labelOf, parseMigrationsCopy, pgConnection, redact, staleDumps } from './db-dump'

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

// План_устранения 3.3: восстановление сверяет миграции дампа и программы.
describe('миграции дампа', () => {
  const copy = [
    'COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;',
    'a1\tc1\t2026-09-10 09:00:00+00\t20260910090000_add_snapshot_reason\t\\N\t\\N\t2026-09-10 09:00:00+00\t1',
    'a2\tc2\t\\N\t20260911000000_broken\t\\N\t\\N\t2026-09-11 00:00:00+00\t0',
    'a3\tc3\t2026-09-11 00:00:00+00\t20260911010000_rolled\t\\N\t2026-09-11 00:05:00+00\t2026-09-11 00:00:00+00\t1',
    'a4\tc4\t2026-09-11 02:00:00+00\t20260911020000_template_editor\t\\N\t\\N\t2026-09-11 02:00:00+00\t1',
    '\\.',
    '',
  ].join('\n')

  it('применённые миграции — из COPY; незавершённые и откатанные не считаются', () => {
    expect(parseMigrationsCopy(copy)).toEqual(['20260910090000_add_snapshot_reason', '20260911020000_template_editor'])
  })

  it('таблицы миграций в дампе нет — пусто', () => {
    expect(parseMigrationsCopy('-- PostgreSQL database dump\n')).toEqual([])
  })

  it('неизвестные программе — отказ; недостающие — применятся при старте', () => {
    expect(compareMigrations(['m1', 'm2', 'm9'], ['m1', 'm2', 'm3'])).toEqual({ unknown: ['m9'], missing: ['m3'] })
    expect(compareMigrations(['m1'], ['m1'])).toEqual({ unknown: [], missing: [] })
  })
})

// План_устранения 3.4: ротация по видам — серия ручных дампов не вытесняет
// предмиграционные, единственную точку отката миграции.
describe('ротация дампов по видам', () => {
  const names = [
    'ntt-20260901-000000Z-pre-migrate.dump',
    'ntt-20260902-000000Z-manual.dump',
    'ntt-20260903-000000Z-manual.dump',
    'ntt-20260904-000000Z-manual.dump',
    'ntt-20260905-000000Z-pre-migrate.dump',
    'ntt-20260906-000000Z-manual.dump',
    '.upload-123.tmp',
    'чужой-файл.txt',
  ]

  it('лишние — только своей метки, самые старые', () => {
    expect(staleDumps(names, 'manual', 2)).toEqual(['ntt-20260903-000000Z-manual.dump', 'ntt-20260902-000000Z-manual.dump'])
    expect(staleDumps(names, 'pre-migrate', 2)).toEqual([])
  })

  it('чужие файлы каталога не трогаются; хранить «0» — не удалять ничего', () => {
    expect(staleDumps(names, 'manual', 0)).toEqual([])
    expect(staleDumps(['чужой-файл.txt'], 'manual', 1)).toEqual([])
  })

  it('метка из имени', () => {
    expect(labelOf('ntt-20260911-201751Z-pre-restore.dump')).toBe('pre-restore')
  })
})
