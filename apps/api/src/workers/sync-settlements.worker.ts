import type { Job } from 'bullmq'
import { prisma } from '@ems/db'
import { TikTokAdapter } from '../platform/tiktok/tiktok.adapter'
import { getShopTikTokAppCreds } from '../platform/tiktok/tiktok-app-creds'

interface SyncSettlementsJob {
  shopId: string
  tenantId: string
}

// Only settle-able orders carry a statement. TikTok settles an order some days
// after delivery, so we look at delivered/completed orders. Refund adjustments
// can append transactions weeks later, so we re-pull rows synced more than this
// long ago to keep the net settlement current.
const SETTLE_STATUSES = ['COMPLETED', 'DELIVERED'] as const
const RESYNC_AFTER_MS = 7 * 24 * 60 * 60 * 1000
// Bound the per-run API calls — this endpoint is one request per order.
const BATCH_SIZE = 80

export async function syncSettlementsProcessor(job: Job<SyncSettlementsJob>) {
  const { shopId, tenantId } = job.data
  console.log(`[sync-settlements] Job received: shopId=${shopId} tenantId=${tenantId}`)

  const shop = await prisma.shop.findFirst({ where: { id: shopId, tenantId } })
  if (!shop) throw new Error(`Shop ${shopId} not found`)
  if (shop.platform !== 'TIKTOK') {
    console.log(`[sync-settlements] Skipping non-TikTok shop ${shop.id} (${shop.platform})`)
    return
  }
  if (shop.status !== 'ACTIVE') {
    console.log(`[sync-settlements] Skipping inactive shop ${shop.id} (status=${shop.status})`)
    return
  }

  // Candidates: settle-able orders with no settlement yet, or a stale one.
  const staleCutoff = new Date(Date.now() - RESYNC_AFTER_MS)
  const orders = await prisma.order.findMany({
    where: {
      shopId: shop.id,
      tenantId,
      isManual: false,
      status: { in: SETTLE_STATUSES as unknown as never[] },
      OR: [
        { settlement: null },
        { settlement: { syncedAt: { lt: staleCutoff } } },
      ],
    },
    select: { id: true, platformOrderId: true },
    // Oldest-first: older delivered orders are the ones already settled, so a
    // backfill walks forward through history and actually lands settlement data
    // instead of repeatedly re-checking the newest (not-yet-settled) orders.
    orderBy: { platformCreatedAt: 'asc' },
    take: BATCH_SIZE,
  })

  if (orders.length === 0) {
    console.log(`[sync-settlements] No settle-able orders pending for shop ${shop.id}`)
    return
  }

  const appCreds = await getShopTikTokAppCreds(shop.id)
  const adapter = new TikTokAdapter(appCreds)

  let synced = 0
  let notSettled = 0
  for (const order of orders) {
    try {
      const s = await adapter.getOrderSettlement(shop, order.platformOrderId)
      if (!s) { notSettled++; continue }
      const data = {
        tenantId,
        currency: s.currency,
        settlementAmount: s.settlementAmount,
        revenueAmount: s.revenueAmount,
        feeAmount: s.feeAmount,
        adjustmentAmount: s.adjustmentAmount,
        grossSalesAmount: s.grossSalesAmount,
        afterDiscountSubtotal: s.afterDiscountSubtotal,
        sellerDiscountAmount: s.sellerDiscountAmount,
        platformDiscountAmount: s.platformDiscountAmount,
        customerPaymentAmount: s.customerPaymentAmount,
        customerPaidShippingFee: s.customerPaidShippingFee,
        platformCommissionAmount: s.platformCommissionAmount,
        referralFeeAmount: s.referralFeeAmount,
        transactionFeeAmount: s.transactionFeeAmount,
        affiliateCommission: s.affiliateCommission,
        affiliateCommissionBeforePit: s.affiliateCommissionBeforePit,
        affiliatePartnerCommission: s.affiliatePartnerCommission,
        refundAdminFeeAmount: s.refundAdminFeeAmount,
        shippingFeeAmount: s.shippingFeeAmount,
        salesTaxAmount: s.salesTaxAmount,
        statementId: s.statementId ?? null,
        statementTime: s.statementTime ?? null,
        raw: s.raw as object,
        syncedAt: new Date(),
      }
      await prisma.orderSettlement.upsert({
        where: { orderId: order.id },
        create: { orderId: order.id, ...data },
        update: data,
      })
      synced++
    } catch (err) {
      console.warn(`[sync-settlements] failed for order ${order.platformOrderId}:`, (err as Error).message)
    }
  }

  console.log(`[sync-settlements] Shop ${shop.id}: ${synced} settled, ${notSettled} not-yet-settled, ${orders.length} checked`)
}
