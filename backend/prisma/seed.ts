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

// ─── Пользователи ────────────────────────────────────────────────────────────
// Пароли демонстрационные и предназначены только для локальной разработки.

const USERS: Array<{ email: string; name: string; role: 'ADMIN' | 'MANAGER' | 'ENGINEER'; password: string }> = [
  { email: 'admin@ntt.local', name: 'Администратор', role: 'ADMIN', password: 'admin123' },
  { email: 'manager@ntt.local', name: 'Менеджер', role: 'MANAGER', password: 'manager123' },
  { email: 'engineer@ntt.local', name: 'Инженер', role: 'ENGINEER', password: 'engineer123' },
]

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
  await verify()

  console.log('\nГотово. Учётные записи (только для локальной разработки):')
  USERS.forEach((u) => console.log(`  ${u.email.padEnd(20)} / ${u.password}  [${u.role}]`))
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
  .finally(() => void prisma.$disconnect())
