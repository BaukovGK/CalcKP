/**
 * Проверка: повторный сид на базе, где технолог правил справочники.
 *
 * Сид идёт при каждом старте контейнера, а справочники материализации ведёт
 * технолог на экране «Шаблоны». Прежде сид падал на добавленной строке и
 * возвращал удалённую (doc/План_устранения.md, 0.1). Скрипт делает такие
 * правки на уже засеянной базе, запускает сид в мягком режиме и проверяет,
 * что сид завершился успешно, а правки на месте. В конце правки откатываются.
 *
 * Меняет данные, поэтому без SEED_RERUN_CHECK=1 не запускается: это проверка
 * для CI и временной базы, не для рабочей.
 *
 *   SEED_RERUN_CHECK=1 DATABASE_URL=… node tools/seed-rerun-check.cjs
 *
 * SEED_CMD — чем запускать сид (по умолчанию ts-node-dev по исходнику; в
 * собранном образе — `node dist-seed/seed.js`).
 */
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { Pool } = require('pg')

if (process.env.SEED_RERUN_CHECK !== '1') {
  console.error('seed-rerun-check: скрипт меняет данные базы — запуск только с SEED_RERUN_CHECK=1 (CI, временная база)')
  process.exit(2)
}
if (!process.env.DATABASE_URL) {
  console.error('seed-rerun-check: DATABASE_URL не задан')
  process.exit(2)
}

const backendDir = path.resolve(__dirname, '..')
const seedCmd = process.env.SEED_CMD ?? 'npx ts-node-dev --transpile-only prisma/seed.ts'
const nozzle150 = require(path.join(backendDir, 'prisma/seed-data/engineering.json')).nozzles.find((n) => n.dn === 150)

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const q = (sql, params) => pool.query(sql, params)
const exists = async (sql, params) => (await q(sql, params)).rowCount > 0

/** Правки технолога на экране «Шаблоны» — и их откат. */
const edits = {
  async apply(state) {
    await q('INSERT INTO "NozzleNorm" (dn, "moldingMassKg") VALUES (1100, 20)')
    await q('DELETE FROM "NozzleNorm" WHERE dn = 150')
    state.mc = (await q('SELECT "massKg" FROM "JointLayerNorm" WHERE d = 3000 AND pn = 4')).rows[0]?.massKg
    await q('UPDATE "JointLayerNorm" SET "massKg" = 113 WHERE d = 3000 AND pn = 4')
    await q('INSERT INTO "PipeWeight" (id, dn, pn, sn, "kgPerM") VALUES (gen_random_uuid()::text, 3200, 0.6, 5000, 1000)')
    await q(`INSERT INTO "EngineeringMatrix" (kind, d, "lengthMm", "massKg") VALUES ('SHELL', 9999, 3000, 1)`)
  },
  async revert(state) {
    await q('DELETE FROM "NozzleNorm" WHERE dn = 1100')
    const cols = Object.keys(nozzle150)
    await q(
      `INSERT INTO "NozzleNorm" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (dn) DO NOTHING`,
      cols.map((c) => nozzle150[c]),
    )
    if (state.mc != null) await q('UPDATE "JointLayerNorm" SET "massKg" = $1 WHERE d = 3000 AND pn = 4', [state.mc])
    await q('DELETE FROM "PipeWeight" WHERE dn = 3200 AND pn = 0.6 AND sn = 5000')
    await q(`DELETE FROM "EngineeringMatrix" WHERE kind = 'SHELL' AND d = 9999 AND "lengthMm" = 3000`)
  },
}

async function main() {
  const failures = []
  const check = (ok, message) => { if (!ok) failures.push(message) }
  const state = {}

  // Правки ложатся на базу в исходном состоянии сида — иначе откат затронул
  // бы чужие строки.
  const pristine =
    !(await exists('SELECT 1 FROM "NozzleNorm" WHERE dn = 1100')) &&
    (await exists('SELECT 1 FROM "NozzleNorm" WHERE dn = 150')) &&
    !(await exists('SELECT 1 FROM "PipeWeight" WHERE dn = 3200 AND pn = 0.6 AND sn = 5000')) &&
    !(await exists(`SELECT 1 FROM "EngineeringMatrix" WHERE kind = 'SHELL' AND d = 9999 AND "lengthMm" = 3000`))
  if (!pristine) throw new Error('база не в исходном состоянии сида — проверка запускается на свежезасеянной базе')

  let output = ''
  try {
    await edits.apply(state)
    // Мягкий режим — как при старте контейнера: SEED_STRICT не задан.
    const env = { ...process.env }
    delete env.SEED_STRICT
    const run = spawnSync(seedCmd, { cwd: backendDir, env, encoding: 'utf8', shell: true })
    output = `${run.stdout ?? ''}${run.stderr ?? ''}`

    check(run.status === 0, `сид в мягком режиме завершился с кодом ${run.status}`)
    check(await exists('SELECT 1 FROM "NozzleNorm" WHERE dn = 1100'), 'добавленная норма DN 1100 пропала')
    check(!(await exists('SELECT 1 FROM "NozzleNorm" WHERE dn = 150')), 'удалённая норма DN 150 вернулась')
    check(
      await exists('SELECT 1 FROM "JointLayerNorm" WHERE d = 3000 AND pn = 4 AND "massKg" = 113'),
      'правка Мс (DN 3000, PN 4) не сохранилась',
    )
    check(await exists('SELECT 1 FROM "PipeWeight" WHERE dn = 3200 AND pn = 0.6 AND sn = 5000'), 'добавленный вес трубы пропал')
    check(
      await exists(`SELECT 1 FROM "EngineeringMatrix" WHERE kind = 'SHELL' AND d = 9999 AND "lengthMm" = 3000`),
      'добавленная ячейка матрицы пропала',
    )
    check(output.includes('Мс(DN3000, PN4) = 113'), 'сид не предупредил о правке контрольной Мс')
  } finally {
    await edits.revert(state)
  }

  if (failures.length) {
    // Вывод сида — без строк учётных записей.
    console.error(output.split('\n').filter((l) => !l.includes('@')).slice(-40).join('\n'))
    failures.forEach((f) => console.error(`✗ ${f}`))
    process.exitCode = 1
    return
  }
  console.log('seed-rerun-check: сид на изменённой базе прошёл, правки технолога целы ✓')
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => pool.end())
