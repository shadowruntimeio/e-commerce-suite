import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { Client } from 'pg'

/**
 * Pre-deploy migration runner for the sub-account-system PR.
 *
 * Usage:
 *   DATABASE_URL=... pnpm --filter @ems/api migrate:sub-account
 *   DATABASE_URL=... pnpm --filter @ems/api migrate:sub-account --dry-run
 *
 * Each statement is run in its own auto-commit transaction so a deadlock vs.
 * the live sync worker only has to retry that single statement, not the whole
 * batch. SQL is idempotent — partial completion can be re-run.
 */

const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, 'migrate-sub-account-system.sql')

const dryRun = process.argv.includes('--dry-run')
const yes = process.argv.includes('--yes')

const client = new Client({ connectionString: process.env.DATABASE_URL })

async function preflight() {
  const tenants = (await client.query(`SELECT COUNT(*)::int AS c FROM tenants`)).rows[0].c
  const users = (await client.query(`SELECT COUNT(*)::int AS c FROM users`)).rows[0].c
  const shops = (await client.query(`SELECT COUNT(*)::int AS c FROM shops`)).rows[0].c
  const orders = (await client.query(`SELECT COUNT(*)::int AS c FROM orders`)).rows[0].c
  const tickets = (await client.query(`SELECT COUNT(*)::int AS c FROM after_sales_tickets`)).rows[0].c
  const dupes = (await client.query(
    `SELECT "orderId" FROM after_sales_tickets GROUP BY "orderId" HAVING COUNT(*) > 1`
  )).rows
  console.log('Preflight:')
  console.log(`  tenants=${tenants}, users=${users}, shops=${shops}, orders=${orders}, after_sales_tickets=${tickets}`)
  if (dupes.length > 0) {
    console.error(`  ABORT: ${dupes.length} duplicate orderIds in after_sales_tickets — dedupe before running`)
    process.exit(1)
  }

  const tenantsWithoutAdmin = (await client.query(`
    SELECT t.id FROM tenants t
    WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u."tenantId" = t.id AND u.role = 'ADMIN')
      AND (
        EXISTS (SELECT 1 FROM shops s WHERE s."tenantId" = t.id) OR
        EXISTS (SELECT 1 FROM system_products p WHERE p."tenantId" = t.id) OR
        EXISTS (SELECT 1 FROM warehouse_skus ws JOIN warehouses w ON ws."warehouseId"=w.id WHERE w."tenantId" = t.id)
      )
  `)).rows
  if (tenantsWithoutAdmin.length > 0) {
    console.error(`  ABORT: tenants with data but no ADMIN user: ${tenantsWithoutAdmin.map(t => t.id).join(', ')}`)
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
  await client.connect()
  await preflight()

  const sql = readFileSync(sqlPath, 'utf8')
  console.log(`\nLoaded ${sqlPath} (${sql.length} bytes)`)

  if (dryRun) {
    console.log('\n--dry-run: not executing.')
    await client.end()
    return
  }

  if (!await confirm('\nProceed against this DB? type "yes" to continue: ')) {
    console.log('Aborted.')
    await client.end()
    process.exit(0)
  }

  console.log('\nExecuting migration...')
  const statements = splitSql(sql).filter(s => {
    const h = s.trim().toUpperCase()
    return h !== 'BEGIN' && h !== 'COMMIT' && h !== 'ROLLBACK'
  })
  console.log(`  ${statements.length} statements to execute`)

  // Short lock_timeout so we don't pile against the live sync worker; we'll
  // retry on transient errors.
  await client.query(`SET lock_timeout = '15s'`)

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]
    const label = stmt.slice(0, 90).replace(/\s+/g, ' ')
    let attempt = 0
    const delays = [0, 1000, 3000, 8000, 15000]
    while (true) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, delays[attempt]))
        await client.query(stmt)
        process.stdout.write(`  [${i + 1}/${statements.length}] ok: ${label}\n`)
        break
      } catch (err) {
        const e = err as { code?: string; message?: string }
        const transient = e.code === '40P01' || e.code === '55P03' || e.code === '40001'
        if (transient && attempt < delays.length - 1) {
          attempt++
          process.stdout.write(`  [${i + 1}/${statements.length}] retry ${attempt} after ${e.code}: ${(e.message ?? '').slice(0, 80)}\n`)
          continue
        }
        console.error(`  [${i + 1}/${statements.length}] FAILED: ${label}`)
        console.error(`    code=${e.code} msg=${e.message}`)
        await client.end()
        process.exit(1)
      }
    }
  }
  console.log('Done.')

  // Verify
  const orphan = (await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM shops WHERE "ownerUserId" IS NULL) +
      (SELECT COUNT(*)::int FROM system_products WHERE "ownerUserId" IS NULL) +
      (SELECT COUNT(*)::int FROM warehouse_skus WHERE "ownerUserId" IS NULL)
      AS c
  `)).rows[0].c
  const pending = (await client.query(
    `SELECT COUNT(*)::int AS c FROM orders WHERE "merchantConfirmStatus" = 'PENDING_CONFIRM'`
  )).rows[0].c
  console.log(`Verify: null_owners=${orphan}, orders_pending_confirm=${pending} (expected 0; new orders going forward will land as PENDING_CONFIRM)`)

  await client.end()
}

/**
 * Split a SQL script on top-level semicolons. Respects:
 *   - `'...'` single-quoted strings (with escaped '')
 *   - `"..."` quoted identifiers
 *   - `$tag$ ... $tag$` dollar-quoted blocks (DO $$ ... $$ etc.)
 *   - `-- ... \n` line comments
 *   - `/* ... *\/` block comments
 */
function splitSql(input: string): string[] {
  const out: string[] = []
  let buf = ''
  let i = 0
  const n = input.length
  let dollarTag: string | null = null

  while (i < n) {
    const ch = input[i]
    const next = input[i + 1]

    if (dollarTag !== null) {
      const end = `$${dollarTag}$`
      if (input.startsWith(end, i)) {
        buf += end
        i += end.length
        dollarTag = null
        continue
      }
      buf += ch
      i++
      continue
    }

    if (ch === '-' && next === '-') {
      const eol = input.indexOf('\n', i)
      const stop = eol < 0 ? n : eol + 1
      buf += input.slice(i, stop)
      i = stop
      continue
    }

    if (ch === '/' && next === '*') {
      const close = input.indexOf('*/', i + 2)
      const stop = close < 0 ? n : close + 2
      buf += input.slice(i, stop)
      i = stop
      continue
    }

    if (ch === "'") {
      buf += ch; i++
      while (i < n) {
        const c = input[i]
        buf += c; i++
        if (c === "'" && input[i] === "'") { buf += input[i]; i++ }
        else if (c === "'") break
      }
      continue
    }

    if (ch === '"') {
      buf += ch; i++
      while (i < n) {
        const c = input[i]
        buf += c; i++
        if (c === '"') break
      }
      continue
    }

    if (ch === '$') {
      const m = input.slice(i + 1).match(/^([A-Za-z_][A-Za-z0-9_]*)?\$/)
      if (m) {
        dollarTag = m[1] ?? ''
        const len = 2 + (m[1]?.length ?? 0)
        buf += input.slice(i, i + len)
        i += len
        continue
      }
    }

    if (ch === ';') {
      const stmt = buf.trim()
      if (stmt) out.push(stmt)
      buf = ''
      i++
      continue
    }

    buf += ch
    i++
  }
  const tail = buf.trim()
  if (tail) out.push(tail)
  return out
}

main().catch(err => {
  console.error('Migration failed:', err)
  client.end().finally(() => process.exit(1))
})
