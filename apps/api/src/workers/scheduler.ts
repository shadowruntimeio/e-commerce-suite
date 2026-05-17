import { prisma } from '@ems/db'
import { syncOrdersQueue, syncProductsQueue, refreshTokensQueue, restockingQueue, etlQueue, syncReturnsQueue } from '../lib/queues'
import { recordAudit, AuditAction } from '../lib/audit'

const SYNC_INTERVAL_MS = 60 * 1000              // 1 minute
const REFRESH_INTERVAL_MS = 30 * 60 * 1000     // 30 minutes
const RESTOCKING_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours
const ETL_INTERVAL_MS = 24 * 60 * 60 * 1000    // 24 hours
const AUTO_CONFIRM_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const RETURNS_SYNC_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

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

async function scheduleReturnSyncs() {
  try {
    const activeShops = await prisma.shop.findMany({
      where: { status: 'ACTIVE', platform: 'TIKTOK' },
      select: { id: true, tenantId: true, name: true },
    })
    if (activeShops.length === 0) return
    console.log(`[scheduler] Scheduling sync-returns for ${activeShops.length} active TikTok shops`)
    for (const shop of activeShops) {
      await syncReturnsQueue.add(
        'sync-returns',
        { shopId: shop.id, tenantId: shop.tenantId },
        { jobId: `scheduled-returns-${shop.id}-${Math.floor(Date.now() / (5 * 60 * 1000))}` },
      )
    }
  } catch (err) {
    console.error('[scheduler] Failed to schedule return syncs:', err)
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

// Auto-confirm orders whose merchantConfirmExpiresAt has passed.
async function autoConfirmExpiredOrders() {
  try {
    const expired = await prisma.order.findMany({
      where: {
        merchantConfirmStatus: 'PENDING_CONFIRM',
        merchantConfirmExpiresAt: { lt: new Date() },
      },
      select: { id: true, tenantId: true, shop: { select: { ownerUserId: true } } },
      take: 200,
    })
    if (expired.length === 0) return
    console.log(`[scheduler] auto-confirming ${expired.length} expired orders`)
    for (const o of expired) {
      try {
        await prisma.order.update({
          where: { id: o.id },
          data: {
            merchantConfirmStatus: 'AUTO_CONFIRMED',
            merchantConfirmedAt: new Date(),
          },
        })
        await recordAudit({
          tenantId: o.tenantId,
          actorUserId: null,
          action: AuditAction.ORDER_AUTO_CONFIRM,
          targetType: 'order',
          targetId: o.id,
          payload: { ownerUserId: o.shop?.ownerUserId ?? null, system: true },
        })
      } catch (err) {
        console.warn(`[scheduler] failed to auto-confirm order ${o.id}:`, (err as Error).message)
      }
    }
  } catch (err) {
    console.error('[scheduler] auto-confirm sweep failed:', err)
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
  console.log('[scheduler] Starting — sync interval: 1m, refresh interval: 30m, restocking interval: 24h, etl interval: 24h, auto-confirm: 5m')

  // Run immediately on startup, then on interval
  void scheduleOrderSyncs()
  void scheduleReturnSyncs()
  void scheduleTokenRefreshes()
  void scheduleRestocking()
  void scheduleEtl()
  void autoConfirmExpiredOrders()

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

  const autoConfirmInterval = setInterval(() => {
    void autoConfirmExpiredOrders()
  }, AUTO_CONFIRM_INTERVAL_MS)

  const returnsSyncInterval = setInterval(() => {
    void scheduleReturnSyncs()
  }, RETURNS_SYNC_INTERVAL_MS)

  // Allow the process to exit cleanly (unref intervals)
  syncInterval.unref()
  refreshInterval.unref()
  restockingInterval.unref()
  etlInterval.unref()
  autoConfirmInterval.unref()
  returnsSyncInterval.unref()

  return {
    stop() {
      clearInterval(syncInterval)
      clearInterval(refreshInterval)
      clearInterval(restockingInterval)
      clearInterval(etlInterval)
      clearInterval(autoConfirmInterval)
      clearInterval(returnsSyncInterval)
      console.log('[scheduler] Stopped')
    },
  }
}
