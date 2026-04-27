import type { Job } from 'bullmq'
import { prisma } from '@ems/db'
import type { OrderStatus } from '@ems/shared'
import { ShopeeAdapter, encryptCredentials } from '../platform/shopee/shopee.adapter'
import { TikTokAdapter, encryptCredentials as encryptTikTokCredentials, decryptCredentials as decryptTikTokCredentials } from '../platform/tiktok/tiktok.adapter'
import type { TikTokCredentials } from '../platform/tiktok/tiktok.adapter'
import type { PlatformAdapter, PlatformOrder } from '../platform/adapter.interface'

interface SyncOrdersJob {
  shopId: string
  tenantId: string
}

const LOOKBACK_SECONDS = 24 * 60 * 60 // 24 hours as first-sync default

function getAdapter(platform: string): PlatformAdapter {
  switch (platform) {
    case 'SHOPEE': return new ShopeeAdapter()
    case 'TIKTOK': return new TikTokAdapter()
    default: throw new Error(`Unsupported platform: ${platform}`)
  }
}

export async function syncOrdersProcessor(job: Job<SyncOrdersJob>) {
  console.log(`[sync-orders] Job received: shopId=${job.data.shopId} tenantId=${job.data.tenantId}`)
  const { shopId, tenantId } = job.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shop = await prisma.shop.findFirst({ where: { id: shopId, tenantId } }) as any
  if (!shop) throw new Error(`Shop ${shopId} not found`)

  if (!['SHOPEE', 'TIKTOK'].includes(shop.platform)) {
    console.log(`[sync-orders] Unsupported platform ${shop.platform} for shop ${shop.id}`)
    return
  }

  console.log(`[sync-orders] Starting sync for shop ${shop.name} (${shop.platform})`)

  const adapter = getAdapter(shop.platform)

  // ─── Refresh token if expired ────────────────────────────────────────────────
  if (shop.tokenExpiresAt && shop.tokenExpiresAt <= new Date()) {
    console.log(`[sync-orders] Token expired for shop ${shop.id}, refreshing...`)
    try {
      const newTokens = await adapter.refreshAccessToken(shop)
      let credentials: any
      if (shop.platform === 'TIKTOK') {
        // Preserve existing shopCipher when refreshing tokens
        const existingCreds = decryptTikTokCredentials(shop.credentialsEncrypted as TikTokCredentials)
        credentials = encryptTikTokCredentials({
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken,
          shopCipher: existingCreds.shopCipher,
        })
      } else {
        credentials = encryptCredentials({
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken,
        })
      }

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
      Object.assign(shop, refreshed)
    } catch (err) {
      await prisma.shop.update({
        where: { id: shop.id },
        data: { status: 'AUTH_EXPIRED' },
      })
      throw new Error(`Failed to refresh token for shop ${shop.id}: ${(err as Error).message}`)
    }
  }

  // ─── Backfill shop_cipher for TikTok shops where it's missing ───────────────
  if (shop.platform === 'TIKTOK') {
    const creds = decryptTikTokCredentials(shop.credentialsEncrypted as TikTokCredentials)
    if (!creds.shopCipher) {
      console.log(`[sync-orders] shop_cipher missing for shop ${shop.id}, fetching from /authorization/202309/shops`)
      try {
        const cipher = await (adapter as TikTokAdapter).fetchShopCipher(creds.accessToken, shop.externalShopId)
        if (cipher) {
          const updated = encryptTikTokCredentials({
            accessToken: creds.accessToken,
            refreshToken: creds.refreshToken,
            shopCipher: cipher,
          })
          await prisma.shop.update({
            where: { id: shop.id },
            data: { credentialsEncrypted: updated as any },
          })
          const refreshed = await prisma.shop.findUniqueOrThrow({ where: { id: shop.id } })
          Object.assign(shop, refreshed)
          console.log(`[sync-orders] shop_cipher backfilled for shop ${shop.id}`)
        } else {
          console.warn(`[sync-orders] No matching shop found in /authorization/202309/shops for externalShopId=${shop.externalShopId}`)
        }
      } catch (err) {
        console.warn(`[sync-orders] Failed to backfill shop_cipher for shop ${shop.id}: ${(err as Error).message}`)
      }
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
  // Denormalize the first seller_sku onto the order for sort-by-SKU.
  const firstSellerSku = platformOrder.items.find((i) => i.sellerSku)?.sellerSku ?? null

  // Wrap upsert + items rebuild in a transaction with a per-order advisory
  // lock. Without this, two concurrent sync workers (e.g. scheduled + webhook)
  // could each run deleteMany while the other had not yet inserted, then both
  // insert, leading to N× duplicate order_items rows.
  const order = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order:${shopId}:${platformOrder.platformOrderId}`}))`

    const upserted = await tx.order.upsert({
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
        firstSellerSku,
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
        firstSellerSku,
      },
    })

    await tx.orderItem.deleteMany({ where: { orderId: upserted.id } })

    for (const item of platformOrder.items) {
      const onlineSku = await tx.onlineSku.findFirst({
        where: {
          platformSkuId: item.platformSkuId,
          onlineProduct: { shopId },
        },
        select: { id: true, systemSkuId: true },
      })

      // Resolve SystemSku: prefer OnlineSku mapping, fall back to matching the
      // seller-provided sku_code directly (same-merchant-same-SKU convention).
      let systemSkuId = onlineSku?.systemSkuId ?? null
      if (!systemSkuId && item.sellerSku) {
        const sysSku = await tx.systemSku.findUnique({
          where: { skuCode: item.sellerSku },
          select: { id: true, systemProduct: { select: { tenantId: true } } },
        })
        if (sysSku && sysSku.systemProduct.tenantId === tenantId) systemSkuId = sysSku.id
      }

      await tx.orderItem.create({
        data: {
          orderId: upserted.id,
          platformSkuId: item.platformSkuId,
          sellerSku: item.sellerSku,
          productName: item.productName,
          skuName: item.skuName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          onlineSkuId: onlineSku?.id ?? null,
          systemSkuId,
        },
      })

      if (onlineSku?.id && !onlineSku.systemSkuId && systemSkuId) {
        await tx.onlineSku.update({
          where: { id: onlineSku.id },
          data: { systemSkuId },
        })
      }
    }

    return upserted
  })

  // Deduct inventory once the order reaches a "committed" status. PENDING is
  // the first commit point (label / fulfillment arranged), SHIPPED is out the
  // door, COMPLETED is delivered-and-closed. TO_SHIP is not yet committed;
  // UNPAID / CANCELLED / EXCEPTION never deduct. Idempotent — re-syncs are
  // safe because deductInventoryForOrder skips when an OUTBOUND event already
  // exists for this order.
  if (shouldDeductForStatus(platformOrder.status)) {
    await deductInventoryForOrder(order.id, tenantId, platformOrder.platformMetadata, 'TIKTOK')
  }
}

const DEDUCTION_STATUSES = new Set(['PENDING', 'SHIPPED', 'COMPLETED'])

function shouldDeductForStatus(status: string): boolean {
  return DEDUCTION_STATUSES.has(status)
}

// Resolve an EMS Warehouse for an order, trying the precise platform mapping
// first, then falling back to tenant conventions. Returns null when ambiguous.
async function resolveDeductionWarehouse(
  tenantId: string,
  platformMetadata: unknown,
  platform: 'TIKTOK' | 'SHOPEE',
): Promise<{ id: string; name: string } | null> {
  // 1. Precise mapping via Warehouse.platformWarehouseIds (future-proof for multi-warehouse)
  const platformWarehouseId = (platformMetadata as { warehouse_id?: string } | undefined)?.warehouse_id
  if (platformWarehouseId) {
    const mapped = await prisma.warehouse.findFirst({
      where: {
        tenantId,
        isActive: true,
        platformWarehouseIds: { path: [platform], array_contains: platformWarehouseId },
      },
      select: { id: true, name: true },
    })
    if (mapped) return mapped
  }

  // 2. Fallback: if tenant has only one active warehouse, use it.
  const active = await prisma.warehouse.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, name: true, isDefault: true },
  })
  if (active.length === 1) return { id: active[0].id, name: active[0].name }

  // 3. Multiple active warehouses — route to the default one.
  const def = active.find((w) => w.isDefault)
  if (def) return { id: def.id, name: def.name }

  return null
}

// Look up a SystemSku by its code, scoped to the tenant (SystemProduct carries
// the tenant). Returns the SystemSku id or null.
async function resolveSystemSkuByCode(skuCode: string, tenantId: string): Promise<string | null> {
  const sku = await prisma.systemSku.findUnique({
    where: { skuCode },
    select: { id: true, systemProduct: { select: { tenantId: true } } },
  })
  if (!sku || sku.systemProduct.tenantId !== tenantId) return null
  return sku.id
}

async function deductInventoryForOrder(
  orderId: string,
  tenantId: string,
  platformMetadata: unknown,
  platform: 'TIKTOK' | 'SHOPEE',
): Promise<void> {
  // Idempotency: skip if we've already written an OUTBOUND event for this order.
  const existing = await prisma.inventoryEvent.findFirst({
    where: { referenceType: 'order', referenceId: orderId, eventType: 'OUTBOUND' },
    select: { id: true },
  })
  if (existing) return

  const warehouse = await resolveDeductionWarehouse(tenantId, platformMetadata, platform)
  if (!warehouse) {
    const platformWarehouseId = (platformMetadata as { warehouse_id?: string } | undefined)?.warehouse_id
    console.warn(`[sync-orders] order ${orderId}: cannot resolve deduction warehouse (platform wh=${platformWarehouseId ?? 'none'}, no single/default fallback) — skipping`)
    return
  }

  const items = await prisma.orderItem.findMany({
    where: { orderId },
    select: { id: true, systemSkuId: true, sellerSku: true, quantity: true, productName: true, platformSkuId: true },
  })

  let deducted = 0
  for (const item of items) {
    // Self-heal: historical OrderItems may lack systemSkuId because the catalog
    // was empty at sync time. Try text-matching sellerSku → SystemSku.skuCode
    // now, and patch the row so later runs don't have to repeat the lookup.
    let systemSkuId = item.systemSkuId
    if (!systemSkuId && item.sellerSku) {
      systemSkuId = await resolveSystemSkuByCode(item.sellerSku, tenantId)
      if (systemSkuId) {
        await prisma.orderItem.update({ where: { id: item.id }, data: { systemSkuId } })
      }
    }

    if (!systemSkuId) {
      console.warn(`[sync-orders] order ${orderId} item "${item.productName}" (sellerSku=${item.sellerSku ?? '-'} / ${item.platformSkuId}) has no matching SystemSku — inventory not deducted`)
      continue
    }
    const warehouseSku = await prisma.warehouseSku.findUnique({
      where: { systemSkuId_warehouseId: { systemSkuId, warehouseId: warehouse.id } },
      select: { id: true },
    })
    if (!warehouseSku) {
      console.warn(`[sync-orders] no warehouseSku for systemSku ${systemSkuId} in warehouse ${warehouse.id} — inventory not deducted`)
      continue
    }

    await prisma.$transaction(async (tx: any) => {
      await tx.inventoryEvent.create({
        data: {
          tenantId,
          warehouseSkuId: warehouseSku.id,
          warehouseId: warehouse.id,
          eventType: 'OUTBOUND',
          quantityDelta: -item.quantity,
          referenceType: 'order',
          referenceId: orderId,
        },
      })
      const snapshot = await tx.inventorySnapshot.findFirst({
        where: { warehouseSkuId: warehouseSku.id },
        orderBy: { snapshotAt: 'desc' },
      })
      if (snapshot) {
        await tx.inventorySnapshot.update({
          where: { id: snapshot.id },
          data: {
            quantityOnHand: { decrement: item.quantity },
            quantityAvailable: { decrement: item.quantity },
          },
        })
      }
    })
    deducted++
  }
  console.log(`[sync-orders] order ${orderId}: deducted ${deducted}/${items.length} items from inventory`)
}
