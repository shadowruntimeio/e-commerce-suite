// Ad-hoc probe / backfill — pulls TikTok returns over a wide window and
// optionally writes them into our DB via upsertReturnFromPlatform. Use this
// for first-time backfill and to inspect what status strings TK actually
// returns (the documented enum is not always what live API emits).
//
// Usage:
//   pnpm --filter @ems/api exec tsx scripts/probe-returns.ts            # 90d, list only
//   pnpm --filter @ems/api exec tsx scripts/probe-returns.ts 30         # 30d, list only
//   pnpm --filter @ems/api exec tsx scripts/probe-returns.ts 90 --write # 90d, upsert into DB
import { config } from 'dotenv'
import { resolve } from 'node:path'
config({ path: resolve(__dirname, '../../../.env') })
import { prisma } from '@ems/db'
import { TikTokAdapter } from '../src/platform/tiktok/tiktok.adapter'
import { getShopTikTokAppCreds } from '../src/platform/tiktok/tiktok-app-creds'
import { upsertReturnFromPlatform } from '../src/modules/returns/returns.service'

const DAYS = parseInt(process.argv[2] ?? '90', 10)
const WRITE = process.argv.includes('--write')
const DUMP_ONE = process.argv.includes('--dump-one')

async function main() {
  const shops = await prisma.shop.findMany({
    where: { platform: 'TIKTOK', status: 'ACTIVE' },
    select: { id: true, name: true, tenantId: true, externalShopId: true, credentialsEncrypted: true, ownerUserId: true, platform: true, status: true, tokenExpiresAt: true, lastSyncAt: true, createdAt: true, updatedAt: true },
  })
  if (shops.length === 0) {
    console.log('No active TikTok shops found.')
    return
  }

  for (const shop of shops) {
    console.log(`\n=== Shop: ${shop.name} (id=${shop.id}, externalShopId=${shop.externalShopId}) ===`)
    let appCreds
    try {
      appCreds = await getShopTikTokAppCreds(shop.id)
    } catch (err) {
      console.error(`  Failed to load app creds: ${(err as Error).message}`)
      continue
    }
    const adapter = new TikTokAdapter(appCreds)

    const params: { since: number; pageToken?: string; pageSize: number } = {
      since: DAYS > 0 ? Math.floor(Date.now() / 1000) - DAYS * 86400 : 0,
      pageSize: 50,
    }
    console.log(`  Window: ${DAYS > 0 ? `last ${DAYS} days (since=${new Date(params.since * 1000).toISOString()})` : 'unfiltered'}`)

    let pageToken: string | undefined
    let total = 0
    let pages = 0
    let upserted = 0
    let upsertFailed = 0
    let dumped = false
    const statusHistogram: Record<string, number> = {}
    do {
      try {
        const page = await adapter.searchReturns(shop as any, { ...params, pageToken })
        pages++
        for (const ret of page.returns) {
          total++
          const status = ret.return_status ?? '<unknown>'
          statusHistogram[status] = (statusHistogram[status] ?? 0) + 1
          if (DUMP_ONE && !dumped) {
            console.log('  ── FULL PAYLOAD ──')
            console.log(JSON.stringify(ret, null, 2).split('\n').map(l => '    ' + l).join('\n'))
            console.log('  ── /FULL PAYLOAD ──')
            dumped = true
          }
          console.log(`  • return_id=${ret.return_id}  order_id=${ret.order_id}  status=${status}  update_time=${ret.update_time ? new Date(ret.update_time * 1000).toISOString() : '—'}`)
          if (WRITE) {
            try {
              await upsertReturnFromPlatform({ id: shop.id, tenantId: shop.tenantId }, ret)
              upserted++
            } catch (err) {
              upsertFailed++
              console.warn(`    upsert failed: ${(err as Error).message}`)
            }
          }
        }
        pageToken = page.nextPageToken ?? undefined
      } catch (err) {
        console.error(`  searchReturns failed: ${(err as Error).message}`)
        break
      }
    } while (pageToken)

    console.log(`  TOTAL: ${total} returns across ${pages} page(s)`)
    console.log(`  STATUS HISTOGRAM:`)
    for (const [s, n] of Object.entries(statusHistogram).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${s.padEnd(45)} ${n}`)
    }
    if (WRITE) {
      console.log(`  UPSERT: ${upserted} succeeded, ${upsertFailed} failed`)
    }
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('Probe failed:', err)
  await prisma.$disconnect()
  process.exit(1)
})
