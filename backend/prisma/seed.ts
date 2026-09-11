/**
 * Сид — начальные данные: первый администратор, прайс, справочники
 * материализации, каталог насосов. Выполняется при каждом старте контейнера
 * (`docker-entrypoint.sh`) и в CI.
 *
 * Правило: сид досоздаёт недостающее и не спорит с тем, что ведётся в
 * приложении. Прайс и насосы досоздаются построчно; справочники
 * материализации заливаются только в пустую таблицу (`seedReference`).
 * Строгие сверки с JSON — только в CI, на пустой базе (`SEED_STRICT=1`).
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Конфиг передаётся адаптеру напрямую — так же, как в src/utils/prisma.ts.
// Раньше сюда передавался готовый `new Pool(...)`, и типы не сходились
// (Pool из 'pg' против ожидаемого адаптером). Ошибку не было видно: tsconfig
// собирает только src/**, а ts-node-dev --transpile-only типы игнорирует —
// она всплыла лишь при компиляции сида для прод-образа.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter } as never)

const SEED_DATA = resolve(__dirname, 'seed-data')

/** Справочники извлекаются из «Шаблон 3.0.xlsx» через `npm run refs:extract`. */
function load<T>(file: string): T {
  try {
    return JSON.parse(readFileSync(resolve(SEED_DATA, file), 'utf8')) as T
  } catch {
    throw new Error(
      `Не найден ${file}. Сначала выполните «npm run refs:extract» — ` +
        `он извлекает справочники из мастер-шаблона.`,
    )
  }
}

// ─── Режим: строгий (CI) или мягкий (старт контейнера) ────────────────────────

/**
 * Строгий режим — CI на пустой базе (`SEED_STRICT=1`): любое расхождение с
 * JSON там — ошибка данных или ключей, и сид падает.
 *
 * Без флага режим мягкий. Так сид работает при каждом старте контейнера:
 * база живая, справочники в ней ведёт технолог, и расхождение с JSON — его
 * правки, а не поломка. Прежде сид падал и на них — норма патрубка,
 * добавленная на экране «Шаблоны», останавливала запуск бэкенда. Мягкий режим
 * предупреждает и не падает.
 */
const STRICT = process.env.SEED_STRICT === '1'

/** Предупреждения мягкого режима — сводкой в конце. */
const warnings: string[] = []

/** Расхождение с ожидаемым: в строгом режиме — ошибка, в мягком — предупреждение. */
function mismatch(message: string): void {
  if (STRICT) throw new Error(message)
  warnings.push(message)
  console.warn(`  ⚠ ${message}`)
}

interface PriceSeed {
  category: string
  name: string
  unit: string
  priceBaseRub: number | null
  discountPct: number | null
  currency: string
  priceRub: number | null
  comment: string | null
}
interface PipeWeightSeed { dn: number; pn: number; sn: number; wallMm: number | null; kgPerM: number }
interface PePipeSeed { dn: number; name: string; odMm: number; wallMm: string | null; kgPerM: number }
interface PumpSeed {
  name: string
  capacityMinM3h: number
  capacityMaxM3h: number
  headMinM: number
  headMaxM: number
  nozzleDiameterMm: number
}

interface MatrixCellSeed { d: number; lengthMm: number; massKg: number; thicknessMm: number | null }
interface JointLayerSeed {
  d: number
  pn: number
  odMm: number | null
  hMm: number | null
  sMm: number | null
  xMm: number | null
  yMm: number | null
  massKg: number
}
interface NozzleNormSeed {
  dn: number
  odMm: number | null
  minLengthMm: number | null
  moldingMassKg: number
  h1Mm: number | null
  s1Mm: number | null
  flangeMassKg: number | null
  bolt: string | null
  boltCount: number | null
}
interface EngineeringSeed {
  shell: MatrixCellSeed[]
  ellipticBottom: MatrixCellSeed[]
  nozzles: NozzleNormSeed[]
}

// ─── Пользователи ────────────────────────────────────────────────────────────
// Пароли демонстрационные и предназначены только для локальной разработки.

type SeedUser = { email: string; name: string; role: 'ADMIN' | 'MANAGER' | 'ENGINEER' | 'TECHNOLOG' | 'VIEWER'; password: string }

/**
 * Первый администратор. Заводится всегда: без него в свежую систему было бы
 * не войти и некому создать остальных.
 *
 * Пароль надо сменить сразу после первого входа — `POST /api/auth/password`
 * или раздел «Администрирование» в интерфейсе.
 */
const ADMIN: SeedUser = { email: 'admin@ntt.local', name: 'Администратор', role: 'ADMIN', password: 'admin123' }

/**
 * Демонстрационные учётки остальных ролей. Заводятся ТОЛЬКО при
 * `SEED_DEMO_USERS=1` — по умолчанию их нет.
 *
 * Раньше они создавались при каждом старте, включая прод: пять учёток с
 * общеизвестными паролями появлялись на свежей базе сами. Решение (2026-09-09):
 * первый администратор — из сида, остальные пользователи заводятся вручную.
 * Флаг оставлен для локальной разработки и `verify.ps1`, которым нужны роли.
 */
const DEMO_USERS: SeedUser[] = [
  { email: 'manager@ntt.local', name: 'Менеджер', role: 'MANAGER', password: 'manager123' },
  { email: 'engineer@ntt.local', name: 'Инженер', role: 'ENGINEER', password: 'engineer123' },
  { email: 'technolog@ntt.local', name: 'Технолог', role: 'TECHNOLOG', password: 'technolog123' },
  // Наблюдатель: просмотр расчётов без правки (вкладка «Расчёт» в Битрикс24).
  { email: 'viewer@ntt.local', name: 'Наблюдатель', role: 'VIEWER', password: 'viewer123' },
]

const USERS: SeedUser[] = process.env.SEED_DEMO_USERS === '1' ? [ADMIN, ...DEMO_USERS] : [ADMIN]

async function seedUsers() {
  for (const u of USERS) {
    const passwordHash = await bcrypt.hash(u.password, 10)
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, name: u.name, role: u.role, passwordHash },
    })
  }
  console.log(`  пользователи: ${USERS.length}`)
}

// ─── Прайс ───────────────────────────────────────────────────────────────────

async function seedPrices() {
  const prices = load<PriceSeed[]>('prices.json')

  // Первая версия прайса: снапшоты расчётов ссылаются на неё (ТЗ §3).
  await prisma.priceListVersion.upsert({
    where: { version: 1 },
    update: {},
    create: { version: 1, label: 'НН v1 (Шаблон 3.0)', note: 'Извлечён из мастер-шаблона при первичном сиде' },
  })

  await prisma.priceItem.createMany({
    data: prices.map((p) => ({
      lookupKey: `${p.category}:${p.name}:${p.unit}`,
      category: p.category,
      name: p.name,
      unit: p.unit,
      priceBaseRub: p.priceBaseRub,
      discountPct: p.discountPct,
      currency: p.currency,
      priceRub: p.priceRub,
      comment: p.comment,
    })),
    skipDuplicates: true,
  })

  const count = await prisma.priceItem.count()
  console.log(`  прайс: ${count} позиций (версия 1)`)
}

// ─── Справочники материализации ─────────────────────────────────────────────

/**
 * Справочник материализации заливается только в пустую таблицу.
 *
 * JSON — стартовое состояние. После первого запуска справочники ведёт
 * технолог на экране «Шаблоны» (`/api/templates`): добавляет, правит и удаляет
 * строки. Прежде сид при каждом старте досоздавал строки из JSON и сверял их
 * число с файлом — добавленная технологом строка останавливала запуск
 * бэкенда, удалённая возвращалась. Теперь непустой справочник сид не трогает;
 * новые справочные данные будущих релизов доставляются миграцией.
 *
 * Опустевший целиком справочник сид заполнит заново: без него расчёт не
 * соберётся.
 *
 * @returns сколько строк залито; `null` — справочник не пуст и не тронут
 */
async function seedReference<T>(
  label: string,
  rows: T[],
  count: () => Promise<number>,
  insert: (rows: T[]) => Promise<unknown>,
): Promise<number | null> {
  const before = await count()
  if (before > 0) {
    console.log(`  ${label}: ${before} строк в базе — справочник ведётся в приложении, сид его не трогает`)
    return null
  }
  await insert(rows)
  // skipDuplicates молчалив: сверяем количество, иначе потеря строк пройдёт
  // незамеченной (так уже случилось с ПЭ ⌀140 из-за неверного ключа по dn).
  const after = await count()
  if (after !== rows.length) mismatch(`${label}: в JSON ${rows.length}, залито ${after} — потеря при сиде`)
  console.log(`  ${label}: залито ${after}`)
  return after
}

async function seedPipeWeights() {
  const grp = load<PipeWeightSeed[]>('pipe-weights-grp.json')
  const pe = load<PePipeSeed[]>('pipe-weights-pe.json')

  await seedReference('веса GRP-труб', grp, () => prisma.pipeWeight.count(), (data) =>
    prisma.pipeWeight.createMany({ data, skipDuplicates: true }),
  )
  await seedReference('ПЭ-трубы', pe, () => prisma.pePipe.count(), (data) =>
    prisma.pePipe.createMany({ data, skipDuplicates: true }),
  )
}

// ─── Инженерные матрицы (лист «Для расчетов») ────────────────────────────────

async function seedEngineering() {
  const eng = load<EngineeringSeed>('engineering.json')

  // Обе матрицы лежат в одной таблице — пустоту проверяем по каждой.
  const matrices = [
    { kind: 'SHELL', cells: eng.shell, label: 'матрица корпуса' },
    { kind: 'ELLIPTIC_BOTTOM', cells: eng.ellipticBottom, label: 'матрица эллиптических днищ' },
  ] as const
  for (const { kind, cells, label } of matrices) {
    await seedReference(label, cells, () => prisma.engineeringMatrix.count({ where: { kind } }), (data) =>
      prisma.engineeringMatrix.createMany({ data: data.map((c) => ({ kind, ...c })), skipDuplicates: true }),
    )
  }
  await seedReference('нормы патрубков', eng.nozzles, () => prisma.nozzleNorm.count(), (data) =>
    prisma.nozzleNorm.createMany({ data, skipDuplicates: true }),
  )
}

/**
 * Мс — масса формованных слоёв на стыке, f(Dу, PN). Лист «Для расчетов»
 * J36:S143. На ней стоят «Ламинирование частей корпуса» (КНС) и «Ламинация
 * днища» (ЕМК), поэтому потеря строк тихо занизила бы обе.
 */
async function seedJointLayers() {
  const rows = load<JointLayerSeed[]>('joint-layers.json')
  await seedReference('Мс на стыке (Dу × PN)', rows, () => prisma.jointLayerNorm.count(), (data) =>
    prisma.jointLayerNorm.createMany({ data, skipDuplicates: true }),
  )
}

// ─── Каталог насосов (utils/pump-selection.ts) ────────────────────────────────

/** Паспортная характеристика Q–H (выгрузка VJ Select). */
interface PumpCurveSeed {
  name: string
  article: string
  minQM3h: number
  maxQM3h: number
  qNomM3h: number
  hNomM: number
  points: Array<{ q: number; h: number; p2: number; p1: number; eff: number }>
}

async function seedPumps() {
  const pumps = load<PumpSeed[]>('pumps.json')

  await prisma.pump.createMany({ data: pumps, skipDuplicates: true })

  const count = await prisma.pump.count()
  if (count !== pumps.length) mismatch(`насосы: в JSON ${pumps.length}, в БД ${count}`)

  console.log(`  каталог насосов: ${count} позиций`)
  await seedPumpCurves()
  await seedPumpPrices()
}

/**
 * Цены насосов — позиции прайса, по одной на модель каталога.
 *
 * Ключ тот же, по которому строка насоса ищет цену при материализации:
 * «Насосы, АТМ | Насос <марка> | шт» (`engines/template-kns.ts`, pumpRowName).
 * Цены в каталоге производителя нет, поэтому позиции заводятся пустыми, а
 * цифру вносит закупка на экране прайса — как любую другую цену, с историей
 * правок.
 *
 * `skipDuplicates` — не формальность: сид идёт при каждом старте контейнера,
 * и перезапись затёрла бы внесённые цены пустотой.
 */
async function seedPumpPrices() {
  const pumps = load<PumpSeed[]>('pumps.json')
  const category = 'Насосы, АТМ'
  const unit = 'шт'

  const { count } = await prisma.priceItem.createMany({
    data: pumps.map((p) => {
      const name = `Насос ${p.name}`
      return {
        lookupKey: `${category}:${name}:${unit}`,
        category,
        name,
        unit,
        priceRub: null,
        comment: 'Цена насоса по марке каталога — вносит закупка',
      }
    }),
    skipDuplicates: true,
  })

  const total = await prisma.priceItem.count({ where: { category } })
  console.log(`  цены насосов: ${total} позиций в прайсе (новых ${count})`)
}

/**
 * Кривые Q–H. Есть у 56 моделей из 61: пять DN50/DN65 производитель не отдал,
 * они остаются с грубой рамкой диапазонов (см. utils/pump-selection.ts).
 *
 * Идемпотентность: точки пересоздаются целиком у тех насосов, у которых их
 * число не совпало с файлом. Дозаписывать по одной нельзя — кривая имеет смысл
 * только как целое.
 */
async function seedPumpCurves() {
  const curves = load<PumpCurveSeed[]>('pump-curves.json')
  const byName = new Map(
    (await prisma.pump.findMany({ select: { id: true, name: true } })).map((p) => [p.name, p.id]),
  )

  let seeded = 0
  let points = 0
  for (const c of curves) {
    const pumpId = byName.get(c.name)
    if (pumpId == null) {
      mismatch(`кривая для «${c.name}»: такого насоса нет в каталоге`)
      continue
    }

    await prisma.pump.update({
      where: { id: pumpId },
      data: { article: c.article, qNomM3h: c.qNomM3h, hNomM: c.hNomM },
    })

    const have = await prisma.pumpCurvePoint.count({ where: { pumpId } })
    if (have !== c.points.length) {
      await prisma.pumpCurvePoint.deleteMany({ where: { pumpId } })
      await prisma.pumpCurvePoint.createMany({
        data: c.points.map((p, idx) => ({ pumpId, idx, q: p.q, h: p.h, p2: p.p2, p1: p.p1, eff: p.eff })),
      })
    }
    seeded++
    points += c.points.length
  }

  const total = await prisma.pumpCurvePoint.count()
  if (total !== points) mismatch(`кривые насосов: в JSON ${points} точек, в БД ${total}`)

  const withoutCurve = (await prisma.pump.count()) - seeded
  console.log(`  кривые насосов: ${seeded} моделей, ${total} точек (без кривой — ${withoutCurve})`)
}

// ─── Проверки: сид обязан оставить БД пригодной для расчёта ──────────────────
//
// Контрольные значения — числа мастер-шаблона. На живой базе их может
// поменять технолог или закупка: в мягком режиме расхождение — предупреждение.

async function verify() {
  const errors: string[] = []

  // На ставке ФОТ стоит вся экономика (§9.5) — ищем ровно тем же тройным ключом.
  const fot = await prisma.priceItem.findUnique({
    where: { category_name_unit: { category: 'ФОТ', name: 'ФОТ', unit: 'чел. ч' } },
  })
  if (!fot?.priceRub) errors.push('не найдена ставка ФОТ («ФОТ / ФОТ / чел. ч»)')
  else console.log(`  ставка ФОТ: ${fot.priceRub} ₽/чел.ч ✓`)

  // Контрольный вес трубы ОЛ3487: DN3000, PN_трубы 0,6 (автоподбор F7), SN 10000.
  const w = await prisma.pipeWeight.findUnique({ where: { dn_pn_sn: { dn: 3000, pn: 0.6, sn: 10000 } } })
  if (!w) errors.push('не найден контрольный вес DN3000 / PN0,6 / SN10000')
  else console.log(`  контроль веса DN3000;0,6;10000 = ${w.kgPerM} кг/пм ✓`)

  // Норма патрубка DN250 — на ней считается формовка гильзы подводящего ОЛ3487.
  const n250 = await prisma.nozzleNorm.findUnique({ where: { dn: 250 } })
  if (!n250) errors.push('не найдена норма патрубка DN250')
  else console.log(`  контроль нормы патрубка DN250 = ${n250.moldingMassKg} кг ✓`)

  // Мс при PN 4 — то самое значение, которое берут оба калькулятора.
  // В эталонном листе КНС для DN3000 ячейка I20 показывает ровно 112 кг.
  const joint = await prisma.jointLayerNorm.findUnique({ where: { d_pn: { d: 3000, pn: 4 } } })
  if (joint?.massKg !== 112) errors.push(`Мс(DN3000, PN4) = ${joint?.massKg ?? '—'}, в мастер-шаблоне 112 кг`)
  else console.log(`  контроль Мс DN3000 при PN4 = ${joint.massKg} кг ✓`)

  // Контроль паспортной кривой: подбор идёт по ней, а не по диапазонам, и
  // потерянные при сиде точки не проявят себя ничем, кроме неверной марки.
  // Проверяем узловую точку VSL.80.37.4.5.0D из выгрузки VJ Select.
  //
  // Прежняя проверка утверждала, что этот же насос «подбирается» для
  // Q = 45 м³/ч и H = 12,7 м, — она осталась от прямоугольной рамки и была
  // прямо неверной: на кривой при 45 м³/ч модель даёт около 12,69 м, то есть
  // до 12,7 м не дотягивает и в подбор не попадает.
  const curvePump = await prisma.pump.findUnique({
    where: { name: 'Vandjord VSL.80.37.4.5.0D' },
    include: { curve: { orderBy: { idx: 'asc' } } },
  })
  if (!curvePump) {
    errors.push('не найден насос Vandjord VSL.80.37.4.5.0D')
  } else if (curvePump.curve.length !== 10) {
    errors.push(`кривая VSL.80.37.4.5.0D: ожидалось 10 точек, получено ${curvePump.curve.length}`)
  } else {
    const p = curvePump.curve.find((c) => Math.abs(c.q - 40.95) < 0.01)
    // 13.0141 — значение из pump-curves.json: точки округлены до 4 знаков при
    // подготовке файла (исходное 13.0140822875). Сверяем именно с тем, что
    // лежит в сиде, иначе проверка ловила бы округление, а не потерю данных.
    if (!p) errors.push('кривая VSL.80.37.4.5.0D: нет узловой точки Q = 40,95 м³/ч')
    else if (Math.abs(p.h - 13.0141) > 1e-9) {
      errors.push(`кривая VSL.80.37.4.5.0D: при Q = 40,95 ожидался напор 13,0141 м, получено ${p.h}`)
    } else {
      console.log(`  контроль кривой VSL.80.37.4.5.0D: Q 40,95 м³/ч → H ${p.h.toFixed(3)} м ✓`)
    }
  }

  const pumpCount = await prisma.pump.count()
  if (pumpCount !== 61) errors.push(`каталог насосов: ожидалось 61 позиция, в БД ${pumpCount}`)

  if (errors.length === 0) return
  if (STRICT) {
    errors.forEach((e) => console.error(`  ✗ ${e}`))
    throw new Error('Сид завершился, но проверки не пройдены')
  }
  for (const e of errors) mismatch(e)
}

async function main() {
  console.log('Сид:')
  await seedUsers()
  await seedPrices()
  await seedPipeWeights()
  await seedEngineering()
  await seedJointLayers()
  await seedPumps()
  await verify()

  if (warnings.length) {
    console.warn(`\nСид завершён с предупреждениями (${warnings.length}) — запуск продолжается.`)
  }

  console.log('\nГотово. Заведённые учётные записи:')
  USERS.forEach((u) => console.log(`  ${u.email.padEnd(20)} / ${u.password}  [${u.role}]`))
  if (process.env.SEED_DEMO_USERS !== '1') {
    console.log('  Смените пароль администратора сразу после первого входа.')
    console.log('  Демо-учётки остальных ролей не заводятся; для разработки — SEED_DEMO_USERS=1.')
  }
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
  .finally(() => void prisma.$disconnect())
