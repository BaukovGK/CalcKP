/**
 * Дампы базы из приложения: список, создание, восстановление.
 *
 * Работает поверх тех же `pg_dump`/`pg_restore`, что и скрипты в
 * `backend/scripts/`, и того же каталога `BACKUP_DIR` — чтобы дамп, снятый
 * из админки, был виден скриптам, а снятый перед миграцией — админке.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ЗАГРУЖЕННЫЙ ДАМП ПРОВЕРЯЕТСЯ, А НЕ ПРОСТО ВОССТАНАВЛИВАЕТСЯ
 *
 * `pg_restore` выполняет SQL, записанный в архиве. Пользователь БД в образе
 * postgres — суперпользователь, поэтому подсунутый архив может содержать
 * `COPY … FROM PROGRAM`, `CREATE FUNCTION` на недоверенном языке и тому
 * подобное, то есть выполнение команд в контейнере БД. Одной проверки роли
 * ADMIN мало: токен лежит в localStorage и угоняется XSS.
 *
 * Поэтому архив перед восстановлением разворачивается в SQL (`pg_restore -f -`)
 * и проверяется двумя ситами: состав объектов должен совпадать с ожидаемым
 * (только наши таблицы и их индексы/ключи), а текст не должен содержать
 * опасных конструкций. Это не абсолютная защита — обфускация возможна, — но
 * она закрывает подстановку постороннего архива, а не только опечатку.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * @module utils/db-dump
 */

import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const BACKUP_DIR = process.env.BACKUP_DIR ?? '/backups'

/** Миграции Prisma, которые знает эта версия программы (в образе — /app/prisma/migrations). */
export const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), 'prisma/migrations')

/** Максимальный размер загружаемого дампа, байт. */
export const MAX_DUMP_BYTES = 200 * 1024 * 1024

/**
 * Имя файла дампа. Формат задаётся нами (`scripts/db-backup.sh` и
 * {@link createDump}), поэтому шаблон жёсткий: он же защищает от выхода за
 * пределы каталога — ни слэшей, ни точек-родителей в имя не попадёт.
 */
const NAME_RE = /^ntt-\d{8}-\d{6}Z-[a-z-]{1,32}\.dump$/

export function isValidDumpName(name: string): boolean {
  return NAME_RE.test(name)
}

/** Полный путь к дампу по имени. Бросает, если имя не наше. */
export function dumpPath(name: string): string {
  if (!isValidDumpName(name)) throw new DumpError(`Недопустимое имя файла: ${name}`, 'BAD_NAME')
  return path.join(BACKUP_DIR, name)
}

export class DumpError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'DumpError'
  }
}

export interface DumpInfo {
  name: string
  sizeBytes: number
  createdAt: Date
  /** Метка из имени: manual, pre-migrate, pre-restore, uploaded. */
  label: string
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new DumpError('DATABASE_URL не задан', 'NO_DATABASE_URL')
  return url
}

/**
 * Подключение для `pg_dump`/`pg_restore`: строка без пароля — в аргумент,
 * пароль — в окружение (`PGPASSWORD`).
 *
 * Аргументы процесса видны в `ps`, а `execFile` вписывает всю командную
 * строку в текст ошибки. Прежде пароль БД шёл в `--dbname=URL` — и при
 * неудачном восстановлении возвращался в админку в ответе API.
 */
export function pgConnection(url: string): { dbname: string; env: NodeJS.ProcessEnv } {
  const u = new URL(url)
  const password = decodeURIComponent(u.password)
  u.password = ''
  return { dbname: u.toString(), env: password ? { PGPASSWORD: password } : {} }
}

/** Команда с доступом к БД: аргумент без пароля, пароль — в окружении. */
function runWithDb(command: string, args: string[], opts: { maxBuffer?: number } = {}) {
  const { dbname, env } = pgConnection(databaseUrl())
  return run(command, [`--dbname=${dbname}`, ...args], { ...opts, env: { ...process.env, ...env } })
}

/**
 * Текст ошибки без секретов: пароль в строке подключения заменяется на `***`.
 * Страховка к {@link pgConnection} — на случай, если строка с паролем попадёт
 * в сообщение другим путём (текст самой утилиты, чужая обёртка).
 */
export function redact(text: string): string {
  return text.replace(/(postgres(?:ql)?:\/\/[^:/@\s]*):[^@\s]*@/gi, '$1:***@')
}

/** Сообщение ошибки утилиты — без секретов. */
const errorText = (e: unknown) => redact(e instanceof Error ? e.message : String(e))

/** Список дампов, свежие первыми. */
export async function listDumps(): Promise<DumpInfo[]> {
  await mkdir(BACKUP_DIR, { recursive: true })
  const files = (await readdir(BACKUP_DIR)).filter(isValidDumpName)

  const infos = await Promise.all(
    files.map(async (name) => {
      const s = await stat(path.join(BACKUP_DIR, name))
      return {
        name,
        sizeBytes: s.size,
        createdAt: s.mtime,
        label: name.replace(/^ntt-\d{8}-\d{6}Z-/, '').replace(/\.dump$/, ''),
      }
    }),
  )

  return infos.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

function stamp(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`
  )
}

/**
 * Снять дамп. Возвращает сведения о созданном файле.
 *
 * Как и в скрипте, файл сразу проверяется на читаемость: дамп, который не
 * восстановится, хуже отсутствия дампа, а узнать об этом в момент аварии —
 * худший из возможных моментов.
 */
export async function createDump(label = 'manual', now = new Date()): Promise<DumpInfo> {
  if (!/^[a-z-]{1,32}$/.test(label)) throw new DumpError(`Недопустимая метка: ${label}`, 'BAD_LABEL')
  await mkdir(BACKUP_DIR, { recursive: true })

  const name = `ntt-${stamp(now)}-${label}.dump`
  const file = path.join(BACKUP_DIR, name)

  try {
    await runWithDb('pg_dump', [
      '--format=custom',
      '--compress=6',
      '--no-owner',
      '--no-privileges',
      `--file=${file}`,
    ])
  } catch (e) {
    await unlink(file).catch(() => {})
    throw new DumpError(`Не удалось снять дамп: ${errorText(e)}`, 'DUMP_FAILED')
  }

  try {
    await run('pg_restore', ['--list', file])
  } catch {
    await unlink(file).catch(() => {})
    throw new DumpError('Дамп создан, но нечитаем — удалён', 'DUMP_UNREADABLE')
  }

  const s = await stat(file)
  return { name, sizeBytes: s.size, createdAt: s.mtime, label }
}

export async function deleteDump(name: string): Promise<void> {
  await unlink(dumpPath(name))
}

/** Поток для отдачи файла клиенту. */
export function dumpStream(name: string) {
  return createReadStream(dumpPath(name))
}

/**
 * Объекты, которые вправе содержать наш дамп. Всё прочее — повод отказаться:
 * посторонний архив почти наверняка принесёт что-то за пределами этого списка.
 */
const ALLOWED_ENTRY_TYPES = new Set([
  'TABLE', 'TABLE DATA', 'CONSTRAINT', 'FK CONSTRAINT', 'INDEX',
  'SEQUENCE', 'SEQUENCE OWNED BY', 'SEQUENCE SET', 'DEFAULT', 'TYPE',
])

/** Конструкции, которых в дампе прикладной базы быть не должно. */
const FORBIDDEN_SQL = [
  /\bFROM\s+PROGRAM\b/i,
  /\bTO\s+PROGRAM\b/i,
  /\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i,
  /\bCREATE\s+(OR\s+REPLACE\s+)?PROCEDURE\b/i,
  /\bCREATE\s+EXTENSION\b/i,
  /\bCREATE\s+(EVENT\s+)?TRIGGER\b/i,
  /\bCREATE\s+(OR\s+REPLACE\s+)?RULE\b/i,
  /\bCREATE\s+SERVER\b/i,
  /\bCREATE\s+SUBSCRIPTION\b/i,
  /\bDO\s+\$\$/i,
  /\bpg_read_file\b/i,
  /\bpg_write_file\b/i,
  /\blo_import\b/i,
  /\blo_export\b/i,
  /\bALTER\s+(SYSTEM|ROLE|USER)\b/i,
]

export interface DumpCheck {
  ok: boolean
  problems: string[]
  /** Таблицы, найденные в архиве, — показываются администратору перед заменой. */
  tables: string[]
}

/**
 * Проверить архив перед восстановлением: состав объектов и текст SQL.
 *
 * Проверяется именно РАЗВЁРНУТЫЙ SQL, а не только оглавление: оглавление
 * показывает имена и типы записей, но сам исполняемый текст лежит внутри них.
 */
export async function inspectDump(file: string): Promise<DumpCheck> {
  const problems: string[] = []
  const tables = new Set<string>()

  let toc: string
  try {
    toc = (await run('pg_restore', ['--list', file], { maxBuffer: 64 * 1024 * 1024 })).stdout
  } catch {
    return { ok: false, problems: ['Файл не является читаемым дампом PostgreSQL'], tables: [] }
  }

  // Строки оглавления: «id; tblOid oid ТИП схема имя владелец».
  for (const line of toc.split('\n')) {
    const m = /^\d+;\s+\d+\s+\d+\s+([A-Z][A-Z ]*[A-Z])\s+(\S+)\s+(\S+)/.exec(line.trim())
    if (!m) continue
    const [, type, , name] = m
    if (!ALLOWED_ENTRY_TYPES.has(type!)) problems.push(`Посторонний объект в архиве: ${type} ${name}`)
    if (type === 'TABLE') tables.add(name!)
  }

  let sql: string
  try {
    sql = (await run('pg_restore', ['--file=-', '--no-owner', '--no-privileges', file], {
      maxBuffer: 256 * 1024 * 1024,
    })).stdout
  } catch (e) {
    return { ok: false, problems: [`Не удалось развернуть архив в SQL: ${errorText(e)}`], tables: [...tables] }
  }

  for (const re of FORBIDDEN_SQL) {
    const hit = re.exec(sql)
    if (hit) problems.push(`Запрещённая конструкция в дампе: ${hit[0]}`)
  }

  return { ok: problems.length === 0, problems: [...new Set(problems)], tables: [...tables].sort() }
}

// ── Миграции дампа и кода (План_устранения 3.3) ─────────────────────────────

/** Миграции, которые знает код: каталоги `prisma/migrations`. */
export async function codeMigrations(dir = MIGRATIONS_DIR): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
}

/**
 * Разобрать данные `_prisma_migrations` из SQL дампа (блок COPY): имена
 * применённых миграций. Незавершённые и откатанные не считаются.
 */
export function parseMigrationsCopy(sql: string): string[] {
  const m = /COPY\s+\S*_prisma_migrations\s*\(([^)]*)\)\s+FROM\s+stdin;\r?\n([\s\S]*?)\r?\n\\\.(?:\r?\n|$)/i.exec(sql)
  if (!m) return []
  const cols = m[1]!.split(',').map((c) => c.trim().replace(/"/g, ''))
  const iName = cols.indexOf('migration_name')
  const iFinished = cols.indexOf('finished_at')
  const iRolledBack = cols.indexOf('rolled_back_at')
  if (iName < 0) return []
  const names = new Set<string>()
  for (const line of m[2]!.split(/\r?\n/)) {
    if (!line) continue
    const f = line.split('\t')
    if (iFinished >= 0 && f[iFinished] === '\\N') continue
    if (iRolledBack >= 0 && f[iRolledBack] !== undefined && f[iRolledBack] !== '\\N') continue
    if (f[iName]) names.add(f[iName]!)
  }
  return [...names].sort()
}

/** Миграции, записанные в дампе: строки его `_prisma_migrations`. */
export async function dumpMigrations(file: string): Promise<string[]> {
  try {
    const { stdout } = await run('pg_restore', ['--file=-', '--data-only', '--table=_prisma_migrations', file], {
      maxBuffer: 16 * 1024 * 1024,
    })
    return parseMigrationsCopy(stdout)
  } catch (e) {
    throw new DumpError(`Не удалось прочитать миграции дампа: ${errorText(e)}`, 'DUMP_UNREADABLE')
  }
}

/**
 * Сравнить миграции дампа и кода: `unknown` — в дампе есть, коду неизвестны
 * (дамп снят более новой версией программы); `missing` — код знает, в дампе
 * их нет: применятся при следующем старте.
 */
export function compareMigrations(inDump: readonly string[], inCode: readonly string[]): { unknown: string[]; missing: string[] } {
  const code = new Set(inCode)
  const dump = new Set(inDump)
  return { unknown: inDump.filter((n) => !code.has(n)), missing: inCode.filter((n) => !dump.has(n)) }
}

/**
 * Восстановить базу из дампа.
 *
 * Перед заменой снимается страховочный дамп текущего состояния: если окажется,
 * что восстановили не то, вернуться будет куда. Возвращает имя страховочного
 * файла — его показывают администратору.
 *
 * Побочный эффект, о котором стоит помнить: `AuditLog` лежит в этой же базе,
 * поэтому восстановление откатывает и журнал. Записи о действиях, сделанных
 * после снятия дампа, исчезают вместе с остальными данными; запись о самом
 * восстановлении переживает его, потому что пишется после.
 */
export async function restoreDump(name: string): Promise<{ safetyDump: string; missingMigrations: string[] }> {
  const file = dumpPath(name)

  const check = await inspectDump(file)
  if (!check.ok) {
    throw new DumpError(`Дамп не прошёл проверку:\n— ${check.problems.join('\n— ')}`, 'DUMP_REJECTED')
  }

  // Дамп новее программы — его схему эта версия не знает и не поймёт
  // (План_устранения 3.3). Старше — нормально: недостающие миграции
  // применятся при старте.
  const { unknown, missing } = compareMigrations(await dumpMigrations(file), await codeMigrations())
  if (unknown.length) {
    throw new DumpError(
      `Дамп снят более новой версией программы: в нём миграции, которых эта версия не знает — ${unknown.join(', ')}. ` +
        'Восстановите его на той версии, которой он снят.',
      'DUMP_NEWER_THAN_CODE',
    )
  }

  const safety = await createDump('pre-restore')

  try {
    // В чистую схему: `pg_restore --clean` пересоздаёт только объекты из
    // дампа — таблицы и колонки более поздних миграций оставались, а
    // `_prisma_migrations` откатывалась, и следующий старт падал на
    // `migrate deploy` («колонка уже есть»).
    await runWithDb('psql', [
      '-v', 'ON_ERROR_STOP=1', '-q',
      '-c', 'SET client_min_messages TO warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
    ])
    await runWithDb('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', file], {
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (e) {
    throw new DumpError(
      `Восстановление не удалось: ${errorText(e)}. Состояние до замены сохранено в ${safety.name} — восстановите его ` +
        `(база может быть пустой, и вход не сработает: docker compose exec backend /app/scripts/db-restore.sh --yes ${safety.name})`,
      'RESTORE_FAILED',
    )
  }

  return { safetyDump: safety.name, missingMigrations: missing }
}

/**
 * Принять загруженный файл: проверить и положить в каталог дампов под нашим
 * именем. Восстановление — отдельным действием: загрузка не должна незаметно
 * подменять базу.
 */
export async function acceptUpload(tmpFile: string, now = new Date()): Promise<DumpInfo> {
  const check = await inspectDump(tmpFile)
  if (!check.ok) {
    await unlink(tmpFile).catch(() => {})
    throw new DumpError(`Файл отклонён:\n— ${check.problems.join('\n— ')}`, 'DUMP_REJECTED')
  }

  const name = `ntt-${stamp(now)}-uploaded.dump`
  const dest = path.join(BACKUP_DIR, name)
  await mkdir(BACKUP_DIR, { recursive: true })
  await rename(tmpFile, dest)

  const s = await stat(dest)
  return { name, sizeBytes: s.size, createdAt: s.mtime, label: 'uploaded' }
}
