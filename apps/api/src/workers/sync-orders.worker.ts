import type { Job } from 'bullmq'
import { prisma } from '@ems/db'
import type { OrderStatus } from '@ems/shared'
import { ShopeeAdapter, encryptCredentials } from '../platform/shopee/shopee.adapter'
import { TikTokAdapter, encryptCredentials as encryptTikTokCredentials, decryptCredentials as decryptTikTokCredentials } from '../platform/tiktok/tiktok.adapter'
import type { TikTokCredentials } from '../platform/tiktok/tiktok.adapter'
import { getShopTikTokAppCreds } from '../platform/tiktok/tiktok-app-creds'
import type { PlatformAdapter, PlatformOrder } from '../platform/adapter.interface'
import { recordAudit } from '../lib/audit'
import { releaseStockForOrder } from '../modules/inventory/inventory.service'

interface SyncOrdersJob {
  shopId: string
  tenantId: string
}

const LOOKBACK_SECONDS = 24 * 60 * 60 // 24 hours as first-sync default

// Re-scan this far behind the watermark on every incremental sync. TikTok's
// `orders/search` is eventually consistent: a status change (e.g. a buyer
// cancellation) freezes the order's `update_time` at that instant, but the
// change can take minutes to become visible in update_time-filtered search.
// With a bare `timeFrom = lastSyncAt` watermark, if the change surfaces only
// after the window covering its update_time has already elapsed, every later
// window starts past that update_time and the order is skipped forever —
// stuck on its pre-cancellation status. Overlapping backwards re-scans recent
// history each run so late-indexed changes are still caught. Upsert (and the
// deduction / reservation-release paths) are idempotent, so re-processing the
// same orders is harmless. Must comfortably exceed TikTok's search index lag.
const WATERMARK_OVERLAP_SECONDS = 15 * 60 // 15 minutes

async function getAdapter(shop: { id: string; platform: string }): Promise<PlatformAdapter> {
  switch (shop.platform) {
    case 'SHOPEE': return new ShopeeAdapter()
    case 'TIKTOK': {
      const appCreds = await getShopTikTokAppCreds(shop.id)
      return new TikTokAdapter(appCreds)
    }
    default: throw new Error(`Unsupported platform: ${shop.platform}`)
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

  const adapter = await getAdapter(shop)

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
    ? Math.floor(shop.lastSyncAt.getTime() / 1000) - WATERMARK_OVERLAP_SECONDS
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
  // Advance to the window's actual upper bound (`timeTo`), NOT a fresh
  // `new Date()`. The fetch+upsert loop above can take several seconds, so
  // `new Date()` here would be strictly later than `timeTo` — leaving the
  // interval [timeTo, completionTime) permanently unscanned (next run starts
  // at this stamp). Orders whose `update_time` landed in that blind window are
  // never re-fetched, because once an order reaches a terminal state like
  // CANCELLED its `update_time` freezes and never advances again. (This is
  // exactly how 8 buyer-cancelled orders stayed stuck on AWAITING_SHIPMENT.)
  await prisma.shop.update({
    where: { id: shop.id },
    data: { lastSyncAt: new Date(timeTo * 1000) },
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

  // Compute auto-confirm expiry from the merchant's settings (default 24h).
  const merchant = await prisma.user.findFirst({
    where: { ownedShops: { some: { id: shopId } } },
    select: { settings: true },
  })
  // 0 (or negative) means "never auto-confirm" — leave the deadline null so
  // the scheduler's `lt: now` filter skips it forever.
  const autoConfirmHours = (merchant?.settings as { autoConfirmHours?: number })?.autoConfirmHours ?? 24
  const merchantConfirmExpiresAt = autoConfirmHours > 0
    ? new Date(Date.now() + autoConfirmHours * 60 * 60 * 1000)
    : null

  // Pre-resolve SKU lookups OUTSIDE the transaction. They're reads and don't
  // need transactional isolation, but doing them serially inside an interactive
  // transaction can blow Prisma's 5s default timeout when a batch contains
  // many orders/items — the whole job throws, lastSyncAt never advances, and
  // every retry hits the same wall. (Saw exactly this on 2026-05-29; ~2.5h of
  // orders were silently skipped.)
  const platformSkuIds = Array.from(new Set(platformOrder.items.map((i) => i.platformSkuId).filter(Boolean)))
  const onlineSkus = platformSkuIds.length
    ? await prisma.onlineSku.findMany({
        where: {
          platformSkuId: { in: platformSkuIds },
          onlineProduct: { shopId },
        },
        select: { id: true, platformSkuId: true, systemSkuId: true },
      })
    : []
  const onlineSkuByPlatformId = new Map(onlineSkus.map((o) => [o.platformSkuId, o]))

  const sellerSkusToLookup = Array.from(new Set(
    platformOrder.items
      .filter((i) => i.sellerSku && !onlineSkuByPlatformId.get(i.platformSkuId)?.systemSkuId)
      .map((i) => i.sellerSku as string)
  ))
  const systemSkus = sellerSkusToLookup.length
    ? await prisma.systemSku.findMany({
        where: { skuCode: { in: sellerSkusToLookup }, systemProduct: { tenantId } },
        select: { id: true, skuCode: true },
      })
    : []
  const systemSkuIdByCode = new Map(systemSkus.map((s) => [s.skuCode, s.id]))

  // Resolved per-item mapping used by both the orderItem inserts and the
  // back-patch of OnlineSku.systemSkuId outside the transaction.
  const resolved = platformOrder.items.map((item) => {
    const onlineSku = onlineSkuByPlatformId.get(item.platformSkuId)
    let systemSkuId = onlineSku?.systemSkuId ?? null
    if (!systemSkuId && item.sellerSku) {
      systemSkuId = systemSkuIdByCode.get(item.sellerSku) ?? null
    }
    return { item, onlineSkuId: onlineSku?.id ?? null, systemSkuId, needsBackfill: !!(onlineSku?.id && !onlineSku.systemSkuId && systemSkuId) }
  })

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
        merchantConfirmStatus: 'PENDING_CONFIRM',
        merchantConfirmExpiresAt,
      },
    })

    await tx.orderItem.deleteMany({ where: { orderId: upserted.id } })

    if (resolved.length > 0) {
      await tx.orderItem.createMany({
        data: resolved.map(({ item, onlineSkuId, systemSkuId }) => ({
          orderId: upserted.id,
          platformSkuId: item.platformSkuId,
          sellerSku: item.sellerSku,
          productName: item.productName,
          skuName: item.skuName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          onlineSkuId,
          systemSkuId,
        })),
      })
    }

    return upserted
  })

  // Back-patch OnlineSku.systemSkuId for any rows we just resolved via
  // sellerSku fallback. Done outside the transaction — these are independent
  // updates and we don't want them on the hot path.
  for (const { onlineSkuId, systemSkuId, needsBackfill } of resolved) {
    if (needsBackfill && onlineSkuId && systemSkuId) {
      await prisma.onlineSku.update({ where: { id: onlineSkuId }, data: { systemSkuId } }).catch(() => {})
    }
  }

  // Deduct inventory at courier pickup — the moment the package physically
  // leaves the warehouse. That's the AWAITING_COLLECTION → IN_TRANSIT
  // transition on TikTok. Earlier statuses (AWAITING_SHIPMENT, ON_HOLD…) only
  // mean "label generated / waiting"; the goods haven't moved yet.
  // Idempotent — re-syncs skip when an OUTBOUND event already exists.
  if (shouldDeductForStatus(platformOrder.status)) {
    await deductInventoryForOrder(order.id, tenantId, platformOrder.platformMetadata, 'TIKTOK')
  }

  // Release the merchant-confirm reservation when an order is cancelled.
  // Confirming an order (manual or auto) reserves stock; nothing released it on
  // cancel, so the quantity stayed in quantityReserved and leaked out of the
  // available count forever. TikTok freezes update_time at the cancellation, so
  // this is effectively the last sync that will ever see the order — release
  // here or never. Idempotent: nets RESERVED vs UNRESERVED, no-ops if already
  // released (so periodic re-syncs of the same CANCELLED order are safe).
  if (platformOrder.status === 'CANCELLED') {
    await releaseStockForOrder(order.id, tenantId, null).catch((err) => {
      console.warn(`[sync-orders] releaseStockForOrder (cancel) failed for ${order.id}:`, (err as Error).message)
    })
  }

}

// Deduct only after pickup — the goods have actually left the warehouse.
// PARTIALLY_SHIPPING means at least one package was picked up, so it counts.
// SHIPPED is the legacy bucket value (= IN_TRANSIT/DELIVERED) — kept so old
// rows still trigger if they're seen again.
const DEDUCTION_STATUSES = new Set([
  'PARTIALLY_SHIPPING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED',
  'SHIPPED',
])

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
  const sku = await prisma.systemSku.findFirst({
    where: {
      skuCode,
      systemProduct: { tenantId },
    },
    select: { id: true },
  })
  return sku?.id ?? null
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

  // Release the merchant-confirm reservation BEFORE deducting onHand. Without
  // this the order's quantity stays in `quantityReserved` even though the
  // goods are already gone, double-counting against availability for any
  // subsequent order. releaseStockForOrder is idempotent so re-runs are safe.
  await releaseStockForOrder(orderId, tenantId, null).catch((err) => {
    console.warn(`[sync-orders] releaseStockForOrder failed for ${orderId}:`, (err as Error).message)
  })

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

    try {
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
        // Keep the denormalized WarehouseSku counter in lockstep with the
        // event ledger. This used to only update inventorySnapshot (a legacy
        // table the rest of the system stopped reading) and silently leaked
        // every shipment out of the on-hand counter — causing UI/event drift.
        await tx.warehouseSku.update({
          where: { id: warehouseSku.id },
          data: { quantityOnHand: { decrement: item.quantity } },
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
    } catch (err) {
      // The partial unique index on (warehouseSkuId, referenceId) WHERE
      // eventType='OUTBOUND' AND referenceType='order' makes the second
      // concurrent insert fail fast (P2002). That means another worker
      // already wrote this OUTBOUND in its own transaction — their counter
      // update also happened, so we just skip cleanly.
      if ((err as { code?: string } | null)?.code === 'P2002') {
        console.log(`[sync-orders] race: OUTBOUND for (sku=${warehouseSku.id}, order=${orderId}) already inserted by parallel worker; skipping`)
        continue
      }
      throw err
    }
    try {
      await recordAudit({
        tenantId,
        actorUserId: null,
        action: 'inventory.outbound',
        targetType: 'warehouse_sku',
        targetId: warehouseSku.id,
        payload: { orderId, systemSkuId, sellerSku: item.sellerSku, quantity: item.quantity },
      })
    } catch (err) {
      console.warn(`[sync-orders] failed to record audit for order ${orderId} item ${item.id}:`, err)
    }
    deducted++
  }
  console.log(`[sync-orders] order ${orderId}: deducted ${deducted}/${items.length} items from inventory`)
}
