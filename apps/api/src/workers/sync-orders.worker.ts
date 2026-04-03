import type { Job } from 'bullmq'
import { prisma } from '@ems/db'

interface SyncOrdersJob {
  shopId: string
  tenantId: string
}

export async function syncOrdersProcessor(job: Job<SyncOrdersJob>) {
  const { shopId, tenantId } = job.data
  const shop = await prisma.shop.findFirst({ where: { id: shopId, tenantId } })
  if (!shop) throw new Error(`Shop ${shopId} not found`)

  // Platform adapter will be wired here in Phase 2
  // For now, just log
  console.log(`[sync-orders] Syncing orders for shop ${shop.name} (${shop.platform})`)
}
