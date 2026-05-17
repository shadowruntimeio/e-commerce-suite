import type { Job } from 'bullmq'
import { prisma } from '@ems/db'
import { TikTokAdapter } from '../platform/tiktok/tiktok.adapter'
import { getShopTikTokAppCreds } from '../platform/tiktok/tiktok-app-creds'
import { upsertReturnFromPlatform } from '../modules/returns/returns.service'

interface SyncReturnsJob {
  shopId: string
  tenantId: string
}

// Overlap window keeps us idempotent (upsert) and covers webhook misses.
const SYNC_WINDOW_SECONDS = 60 * 60 // last hour

export async function syncReturnsProcessor(job: Job<SyncReturnsJob>) {
  const { shopId, tenantId } = job.data
  console.log(`[sync-returns] Job received: shopId=${shopId} tenantId=${tenantId}`)

  const shop = await prisma.shop.findFirst({ where: { id: shopId, tenantId } })
  if (!shop) throw new Error(`Shop ${shopId} not found`)

  if (shop.platform !== 'TIKTOK') {
    console.log(`[sync-returns] Skipping non-TikTok shop ${shop.id} (${shop.platform})`)
    return
  }
  if (shop.status !== 'ACTIVE') {
    console.log(`[sync-returns] Skipping inactive shop ${shop.id} (status=${shop.status})`)
    return
  }

  const appCreds = await getShopTikTokAppCreds(shop.id)
  const adapter = new TikTokAdapter(appCreds)
  const since = Math.floor(Date.now() / 1000) - SYNC_WINDOW_SECONDS

  let pageToken: string | undefined
  let totalSeen = 0
  do {
    let page: { returns: Awaited<ReturnType<TikTokAdapter['searchReturns']>>['returns']; nextPageToken: string | null }
    try {
      page = await adapter.searchReturns(shop, { since, pageToken })
    } catch (err) {
      console.error(`[sync-returns] searchReturns failed for shop ${shop.id}:`, (err as Error).message)
      throw err
    }

    for (const ret of page.returns) {
      try {
        await upsertReturnFromPlatform({ id: shop.id, tenantId: shop.tenantId }, ret)
        totalSeen++
      } catch (err) {
        console.warn(`[sync-returns] upsert failed for return ${ret.return_id}:`, (err as Error).message)
      }
    }

    pageToken = page.nextPageToken ?? undefined
  } while (pageToken)

  console.log(`[sync-returns] Completed sync for shop ${shop.id}: ${totalSeen} returns processed`)
}
