import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { PrismaClient } from '@ems/db'

/**
 * Pre-deploy migration runner for the sub-account-system PR.
 *
 * Usage:
 *   DATABASE_URL=... pnpm --filter @ems/api migrate:sub-account
 *   DATABASE_URL=... pnpm --filter @ems/api migrate:sub-account --dry-run
 *
 * The SQL file is fully wrapped in BEGIN/COMMIT and idempotent, so a failed
 * run can be retried safely.
 */

const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, 'migrate-sub-account-system.sql')

const dryRun = process.argv.includes('--dry-run')
const yes = process.argv.includes('--yes')

const prisma = new PrismaClient()

async function preflight() {
  const tenants = await prisma.$queryRawUnsafe<{ c: number }[]>(`SELECT COUNT(*)::int AS c FROM tenants`)
  const users = await prisma.$queryRawUnsafe<{ c: number }[]>(`SELECT COUNT(*)::int AS c FROM users`)
  const shops = await prisma.$queryRawUnsafe<{ c: number }[]>(`SELECT COUNT(*)::int AS c FROM shops`)
  const orders = await prisma.$queryRawUnsafe<{ c: number }[]>(`SELECT COUNT(*)::int AS c FROM orders`)
  const tickets = await prisma.$queryRawUnsafe<{ c: number }[]>(`SELECT COUNT(*)::int AS c FROM after_sales_tickets`)
  const dupes = await prisma.$queryRawUnsafe<unknown[]>(
    `SELECT "orderId" FROM after_sales_tickets GROUP BY "orderId" HAVING COUNT(*) > 1`
  )
  console.log('Preflight:')
  console.log(`  tenants=${tenants[0].c}, users=${users[0].c}, shops=${shops[0].c}, orders=${orders[0].c}, after_sales_tickets=${tickets[0].c}`)
  if (dupes.length > 0) {
    console.error(`  ABORT: ${dupes.length} duplicate orderIds in after_sales_tickets — dedupe before running`)
    process.exit(1)
  }

  const tenantsWithoutAdmin = await prisma.$queryRawUnsafe<{ id: string }[]>(`
    SELECT t.id FROM tenants t
    WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u."tenantId" = t.id AND u.role = 'ADMIN')
      AND (
        EXISTS (SELECT 1 FROM shops s WHERE s."tenantId" = t.id) OR
        EXISTS (SELECT 1 FROM system_products p WHERE p."tenantId" = t.id)
      )
  `)
  if (tenantsWithoutAdmin.length > 0) {
    console.error(`  ABORT: tenants with shops/products but no ADMIN user: ${tenantsWithoutAdmin.map(t => t.id).join(', ')}`)
    process.exit(1)
  }
}

async function confirm(prompt: string): Promise<boolean> {
  if (yes) return true
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(prompt, ans => { rl.close(); resolve(ans.trim().toLowerCase() === 'yes') }))
}

async function main() {
  console.log(`DB: ${process.env.DATABASE_URL?.replace(/:[^:@]*@/, ':***@')}`)
  await preflight()

  const sql = readFileSync(sqlPath, 'utf8')
  console.log(`\nLoaded ${sqlPath} (${sql.length} bytes)`)

  if (dryRun) {
    console.log('\n--dry-run: not executing. SQL preview:\n')
    console.log(sql.split('\n').slice(0, 30).join('\n') + '\n...')
    await prisma.$disconnect()
    return
  }

  if (!await confirm('\nProceed against this DB? type "yes" to continue: ')) {
    console.log('Aborted.')
    await prisma.$disconnect()
    process.exit(0)
  }

  console.log('\nExecuting migration (single transaction in SQL)...')
  await prisma.$executeRawUnsafe(sql)
  console.log('Done.')

  // Re-verify post-state
  const orphan = await prisma.$queryRawUnsafe<{ c: number }[]>(`
    SELECT
      (SELECT COUNT(*)::int FROM shops WHERE "ownerUserId" IS NULL) +
      (SELECT COUNT(*)::int FROM system_products WHERE "ownerUserId" IS NULL) +
      (SELECT COUNT(*)::int FROM warehouse_skus WHERE "ownerUserId" IS NULL)
      AS c
  `)
  const pending = await prisma.$queryRawUnsafe<{ c: number }[]>(
    `SELECT COUNT(*)::int AS c FROM orders WHERE "merchantConfirmStatus" = 'PENDING_CONFIRM'`
  )
  console.log(`Verify: null_owners=${orphan[0].c}, orders_pending_confirm=${pending[0].c} (new orders will be PENDING_CONFIRM, expected 0 here)`)

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('Migration failed:', err)
  prisma.$disconnect().finally(() => process.exit(1))
})
