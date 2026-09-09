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

// ─── Справочники весов ───────────────────────────────────────────────────────

async function seedPipeWeights() {
  const grp = load<PipeWeightSeed[]>('pipe-weights-grp.json')
  const pe = load<PePipeSeed[]>('pipe-weights-pe.json')

  await prisma.pipeWeight.createMany({ data: grp, skipDuplicates: true })
  await prisma.pePipe.createMany({ data: pe, skipDuplicates: true })

  // skipDuplicates молчалив: сверяем количество, иначе потеря строк пройдёт
  // незамеченной (так уже случилось с ПЭ ⌀140 из-за неверного ключа по dn).
  const [grpCount, peCount] = [await prisma.pipeWeight.count(), await prisma.pePipe.count()]
  if (grpCount !== grp.length) throw new Error(`GRP-трубы: в JSON ${grp.length}, в БД ${grpCount} — потеря при сиде`)
  if (peCount !== pe.length) throw new Error(`ПЭ-трубы: в JSON ${pe.length}, в БД ${peCount} — потеря при сиде`)

  console.log(`  веса труб: GRP ${grpCount}, ПЭ ${peCount}`)
}

// ─── Инженерные матрицы (лист «Для расчетов») ────────────────────────────────

async function seedEngineering() {
  const eng = load<EngineeringSeed>('engineering.json')

  await prisma.engineeringMatrix.createMany({
    data: [
      ...eng.shell.map((c) => ({ kind: 'SHELL' as const, ...c })),
      ...eng.ellipticBottom.map((c) => ({ kind: 'ELLIPTIC_BOTTOM' as const, ...c })),
    ],
    skipDuplicates: true,
  })
  await prisma.nozzleNorm.createMany({ data: eng.nozzles, skipDuplicates: true })

  // skipDuplicates молчалив — сверяем количества (как с ПЭ-трубами).
  const expected = eng.shell.length + eng.ellipticBottom.length
  const [matrixCount, nozzleCount] = [
    await prisma.engineeringMatrix.count(),
    await prisma.nozzleNorm.count(),
  ]
  if (matrixCount !== expected) throw new Error(`матрицы: в JSON ${expected}, в БД ${matrixCount} — потеря при сиде`)
  if (nozzleCount !== eng.nozzles.length) throw new Error(`нормы патрубков: в JSON ${eng.nozzles.length}, в БД ${nozzleCount}`)

  console.log(`  инженерные матрицы: корпус ${eng.shell.length}, днища ${eng.ellipticBottom.length}, патрубки ${nozzleCount}`)
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
  if (count !== pumps.length) throw new Error(`насосы: в JSON ${pumps.length}, в БД ${count} — потеря при сиде`)

  console.log(`  каталог насосов: ${count} позиций`)
  await seedPumpCurves()
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
    if (pumpId == null) throw new Error(`кривая для «${c.name}»: такого насоса нет в каталоге`)

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
  if (total !== points) throw new Error(`кривые насосов: в JSON ${points} точек, в БД ${total} — потеря при сиде`)

  const withoutCurve = (await prisma.pump.count()) - seeded
  console.log(`  кривые насосов: ${seeded} моделей, ${total} точек (без кривой — ${withoutCurve})`)
}

// ─── Проверки: сид обязан оставить БД пригодной для расчёта ──────────────────

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

  if (errors.length) {
    errors.forEach((e) => console.error(`  ✗ ${e}`))
    throw new Error('Сид завершился, но проверки не пройдены')
  }
}

async function main() {
  console.log('Сид:')
  await seedUsers()
  await seedPrices()
  await seedPipeWeights()
  await seedEngineering()
  await seedPumps()
  await verify()

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
