import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(__dirname, '../../../.env') })

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // ─── Tenant ───────────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { id: 'seed-tenant-1' },
    update: {},
    create: {
      id: 'seed-tenant-1',
      name: 'Demo Store Co.',
      settings: { currency: 'USD', timezone: 'Asia/Shanghai' },
    },
  })

  // ─── Admin User ──────────────────────────────────────────────────────────
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@demo.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@demo.com',
      passwordHash: await bcrypt.hash('password123', 12),
      name: 'Eric Zhang',
      role: 'ADMIN',
    },
  })

  console.log('Seed complete!')
  console.log(`   Tenant: ${tenant.name}`)
  console.log(`   Login:  admin@demo.com / password123`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
