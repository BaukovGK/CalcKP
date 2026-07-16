import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

const pool    = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma  = new PrismaClient({ adapter } as never)

async function main() {
  const adminHash = await bcrypt.hash('admin123', 10)
  await prisma.user.upsert({
    where:  { email: 'admin@ntt.local' },
    update: {},
    create: { email: 'admin@ntt.local', name: 'Администратор', role: 'ADMIN', passwordHash: adminHash },
  })

  const mgrHash = await bcrypt.hash('manager123', 10)
  await prisma.user.upsert({
    where:  { email: 'manager@ntt.local' },
    update: {},
    create: { email: 'manager@ntt.local', name: 'Менеджер', role: 'MANAGER', passwordHash: mgrHash },
  })

  console.log('Seed завершён')
  console.log('  admin@ntt.local   / admin123')
  console.log('  manager@ntt.local / manager123')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
