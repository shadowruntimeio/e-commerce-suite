import type { Job } from 'bullmq'
import { prisma } from '@ems/db'
import type { OrderStatus } from '@ems/shared'
import { ShopeeAdapter, encryptCredentials } from '../platform/shopee/shopee.adapter'
import type { PlatformOrder } from '../platform/adapter.interface'

interface SyncOrdersJob {
  shopId: string
  tenantId: string
}

const LOOKBACK_SECONDS = 24 * 60 * 60 // 24 hours as first-sync default

export async function syncOrdersProcessor(job: Job<SyncOrdersJob>) {
  const { shopId, tenantId } = job.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shop = await prisma.shop.findFirst({ where: { id: shopId, tenantId } }) as any
  if (!shop) throw new Error(`Shop ${shopId} not found`)
  if (shop.platform !== 'SHOPEE') {
    console.log(`[sync-orders] Unsupported platform ${shop.platform} for shop ${shop.id}`)
    return
  }

  console.log(`[sync-orders] Starting sync for shop ${shop.name} (${shop.platform})`)

  let adapter = new ShopeeAdapter()

  // ─── Refresh token if expired ────────────────────────────────────────────────
  if (shop.tokenExpiresAt && shop.tokenExpiresAt <= new Date()) {
    console.log(`[sync-orders] Token expired for shop ${shop.id}, refreshing...`)
    try {
      const newTokens = await adapter.refreshAccessToken(shop)
      const credentials = encryptCredentials({
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
      })
      await prisma.shop.update({
        where: { id: shop.id },
        data: {
          credentialsEncrypted: credentials as any,
          tokenExpiresAt: newTokens.expiresAt,
          status: 'ACTIVE',
        },
      })
      // Reload the shop with fresh credentials
      const refreshed = await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } })
      adapter = new ShopeeAdapter()
      // Reassign shop reference so subsequent calls use updated credentials
      Object.assign(shop, refreshed)
    } catch (err) {
      await prisma.shop.update({
        where: { id: shop.id },
        data: { status: 'AUTH_EXPIRED' },
      })
      throw new Error(`Failed to refresh token for shop ${shop.id}: ${(err as Error).message}`)
    }
  }

  // ─── Determine sync window ───────────────────────────────────────────────────
  const timeTo = Math.floor(Date.now() / 1000)
  const timeFrom = shop.lastSyncAt
    ? Math.floor(shop.lastSyncAt.getTime() / 1000)
    : timeTo - LOOKBACK_SECONDS

  console.log(
    `[sync-orders] Fetching orders for shop ${shop.id} from ${new Date(timeFrom * 1000).toISOString()} to ${new Date(timeTo * 1000).toISOString()}`
  )

  // ─── Fetch orders ────────────────────────────────────────────────────────────
  let platformOrders: PlatformOrder[]
  try {
    platformOrders = await adapter.syncOrders(shop, {
      timeRangeField: 'update_time',
      timeFrom,
      timeTo,
      pageSize: 50,
    })
  } catch (err) {
    const retryable = (err as { retryable?: boolean }).retryable
    if (retryable) {
      console.warn(`[sync-orders] Rate limited for shop ${shop.id}, will retry`)
    }
    throw err
  }

  console.log(`[sync-orders] Fetched ${platformOrders.length} orders for shop ${shop.id}`)

  // ─── Upsert orders ───────────────────────────────────────────────────────────
  for (const platformOrder of platformOrders) {
    await upsertOrder(shop.id, tenantId, platformOrder)
  }

  // ─── Update lastSyncAt atomically ────────────────────────────────────────────
  await prisma.shop.update({
    where: { id: shop.id },
    data: { lastSyncAt: new Date() },
  })

  console.log(`[sync-orders] Completed sync for shop ${shop.id}: ${platformOrders.length} orders processed`)
}

async function upsertOrder(
  shopId: string,
  tenantId: string,
  platformOrder: PlatformOrder
): Promise<void> {
  // Upsert the order
  const order = await prisma.order.upsert({
    where: {
      shopId_platformOrderId: {
        shopId,
        platformOrderId: platformOrder.platformOrderId,
      },
    },
    update: {
      status: platformOrder.status as OrderStatus,
      buyerName: platformOrder.buyerName,
      buyerPhone: platformOrder.buyerPhone,
      shippingAddress: platformOrder.shippingAddress as any,
      currency: platformOrder.currency,
      subtotal: platformOrder.subtotal,
      platformDiscount: platformOrder.platformDiscount,
      sellerDiscount: platformOrder.sellerDiscount,
      shippingFeeBuyer: platformOrder.shippingFeeBuyer,
      shippingFeeSeller: platformOrder.shippingFeeSeller,
      platformCommission: platformOrder.platformCommission,
      totalRevenue: platformOrder.totalRevenue,
      platformMetadata: platformOrder.platformMetadata as any,
      platformCreatedAt: platformOrder.platformCreatedAt,
    },
    create: {
      shopId,
      tenantId,
      platformOrderId: platformOrder.platformOrderId,
      status: platformOrder.status as OrderStatus,
      buyerName: platformOrder.buyerName,
      buyerPhone: platformOrder.buyerPhone,
      shippingAddress: platformOrder.shippingAddress as any,
      currency: platformOrder.currency,
      subtotal: platformOrder.subtotal,
      platformDiscount: platformOrder.platformDiscount,
      sellerDiscount: platformOrder.sellerDiscount,
      shippingFeeBuyer: platformOrder.shippingFeeBuyer,
      shippingFeeSeller: platformOrder.shippingFeeSeller,
      platformCommission: platformOrder.platformCommission,
      totalRevenue: platformOrder.totalRevenue,
      platformMetadata: platformOrder.platformMetadata as any,
      platformCreatedAt: platformOrder.platformCreatedAt,
    },
  })

  // Delete old items and re-insert (simpler than full upsert on compound key)
  await prisma.orderItem.deleteMany({ where: { orderId: order.id } })

  for (const item of platformOrder.items) {
    // Try to match platformSkuId to an OnlineSku in this shop
    const onlineSku = await prisma.onlineSku.findFirst({
      where: {
        platformSkuId: item.platformSkuId,
        onlineProduct: { shopId },
      },
      select: { id: true, systemSkuId: true },
    })

    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        platformSkuId: item.platformSkuId,
        productName: item.productName,
        skuName: item.skuName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        onlineSkuId: onlineSku?.id ?? null,
        systemSkuId: onlineSku?.systemSkuId ?? null,
      },
    })
  }
}
