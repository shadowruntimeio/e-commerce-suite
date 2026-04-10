import { prisma } from '@ems/db'
import { syncOrdersQueue, syncProductsQueue, refreshTokensQueue, restockingQueue, etlQueue } from '../lib/queues'

const SYNC_INTERVAL_MS = 5 * 60 * 1000          // 5 minutes
const REFRESH_INTERVAL_MS = 30 * 60 * 1000     // 30 minutes
const RESTOCKING_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours
const ETL_INTERVAL_MS = 24 * 60 * 60 * 1000    // 24 hours

async function scheduleOrderSyncs() {
  try {
    const activeShops = await prisma.shop.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, tenantId: true, name: true },
    })
    console.log(`[scheduler] Scheduling sync-orders + sync-products for ${activeShops.length} active shops`)
    for (const shop of activeShops) {
      await syncOrdersQueue.add(
        'sync-orders',
        { shopId: shop.id, tenantId: shop.tenantId },
        { jobId: `scheduled-sync-${shop.id}-${Math.floor(Date.now() / 60000)}` }
      )
      await syncProductsQueue.add(
        'sync-products',
        { shopId: shop.id, tenantId: shop.tenantId },
        { jobId: `scheduled-product-sync-${shop.id}-${Math.floor(Date.now() / 60000)}` }
      )
    }
  } catch (err) {
    console.error('[scheduler] Failed to schedule order syncs:', err)
  }
}

async function scheduleTokenRefreshes() {
  try {
    const expiryThreshold = new Date(Date.now() + 2 * 60 * 60 * 1000) // tokens expiring within 2h
    const expiringShops = await prisma.shop.findMany({
      where: {
        status: 'ACTIVE',
        tokenExpiresAt: { lt: expiryThreshold },
      },
      select: { id: true, tenantId: true, name: true },
    })
    if (expiringShops.length > 0) {
      console.log(`[scheduler] Scheduling refresh-tokens for ${expiringShops.length} shops with expiring tokens`)
      await refreshTokensQueue.add(
        'refresh-tokens',
        { shopIds: expiringShops.map((s: { id: string }) => s.id) },
        { jobId: `scheduled-refresh-${Math.floor(Date.now() / 60000)}` }
      )
    }
  } catch (err) {
    console.error('[scheduler] Failed to schedule token refreshes:', err)
  }
}

async function scheduleRestocking() {
  try {
    console.log('[scheduler] Scheduling nightly restocking suggestions run')
    await restockingQueue.add(
      'restocking',
      {},
      { jobId: `restocking-${Math.floor(Date.now() / 86400000)}` }
    )
  } catch (err) {
    console.error('[scheduler] Failed to schedule restocking run:', err)
  }
}

async function scheduleEtl() {
  try {
    console.log('[scheduler] Scheduling nightly ETL run')
    await etlQueue.add(
      'etl',
      {},
      { jobId: `etl-${Math.floor(Date.now() / 86400000)}` }
    )
  } catch (err) {
    console.error('[scheduler] Failed to schedule ETL run:', err)
  }
}

export function startScheduler() {
  console.log('[scheduler] Starting — sync interval: 5m, refresh interval: 30m, restocking interval: 24h, etl interval: 24h')

  // Run immediately on startup, then on interval
  void scheduleOrderSyncs()
  void scheduleTokenRefreshes()
  void scheduleRestocking()
  void scheduleEtl()

  const syncInterval = setInterval(() => {
    void scheduleOrderSyncs()
  }, SYNC_INTERVAL_MS)

  const refreshInterval = setInterval(() => {
    void scheduleTokenRefreshes()
  }, REFRESH_INTERVAL_MS)

  const restockingInterval = setInterval(() => {
    void scheduleRestocking()
  }, RESTOCKING_INTERVAL_MS)

  const etlInterval = setInterval(() => {
    void scheduleEtl()
  }, ETL_INTERVAL_MS)

  // Allow the process to exit cleanly (unref intervals)
  syncInterval.unref()
  refreshInterval.unref()
  restockingInterval.unref()
  etlInterval.unref()

  return {
    stop() {
      clearInterval(syncInterval)
      clearInterval(refreshInterval)
      clearInterval(restockingInterval)
      clearInterval(etlInterval)
      console.log('[scheduler] Stopped')
    },
  }
}
