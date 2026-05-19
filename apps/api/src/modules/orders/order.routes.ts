import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { requireCapabilities } from '../../middleware/authorize'
import { runRulesForOrder } from './rules-engine'
import { TikTokAdapter } from '../../platform/tiktok/tiktok.adapter'
import { getShopTikTokAppCreds } from '../../platform/tiktok/tiktok-app-creds'
import { recordAudit, AuditAction } from '../../lib/audit'
import { reserveStockForOrder, releaseStockForOrder } from '../inventory/inventory.service'

// Render SystemSku.attributes (e.g. { color: 'red', size: 'XL' }) into the
// human-readable variant string we store on OrderItem.skuName.
function formatAttributes(attrs: Record<string, unknown> | null | undefined): string | null {
  if (!attrs || typeof attrs !== 'object') return null
  const parts = Object.values(attrs).filter((v) => typeof v === 'string' && v.length > 0)
  return parts.length > 0 ? parts.join(' / ') : null
}

export async function orderRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // POST /manual — create a manual order (merchant / admin only)
  app.post('/manual', async (request, reply) => {
    if (request.user.role !== 'MERCHANT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }
    const { items, buyerName, buyerPhone, shippingAddress, notes } = (request.body ?? {}) as {
      items?: Array<{ sku: string; quantity: number; productName?: string }>
      buyerName?: string
      buyerPhone?: string
      shippingAddress?: string
      notes?: string
    }
    if (!items?.length) return reply.status(400).send({ success: false, error: 'items required' })
    if (!buyerPhone?.trim()) return reply.status(400).send({ success: false, error: 'buyerPhone required' })
    if (!shippingAddress?.trim()) return reply.status(400).send({ success: false, error: 'shippingAddress required' })

    const platformOrderId = `MANUAL-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`

    const order = await prisma.order.create({
      data: {
        tenantId: request.user.tenantId,
        platformOrderId,
        status: 'TO_SHIP',
        buyerName: buyerName?.trim() || null,
        buyerPhone: buyerPhone.trim(),
        shippingAddress: shippingAddress ? { address: shippingAddress } : undefined,
        platformMetadata: notes ? { notes } : {},
        merchantConfirmStatus: 'CONFIRMED',
        merchantConfirmedAt: new Date(),
        isManual: true,
        manualStatus: 'PENDING',
        createdByUserId: request.user.userId,
        firstSellerSku: items[0]?.sku ?? null,
        items: {
          create: items.map((item) => ({
            platformSkuId: item.sku,
            sellerSku: item.sku,
            productName: item.productName?.trim() || item.sku,
            quantity: item.quantity,
            unitPrice: 0,
          })),
        },
      },
      include: { items: true },
    })

    // Notify all active warehouse staff in the tenant
    const warehouseUsers = await prisma.user.findMany({
      where: { tenantId: request.user.tenantId, role: 'WAREHOUSE_STAFF', isActive: true },
      select: { id: true },
    })
    if (warehouseUsers.length > 0) {
      const itemSummary = items.map((i) => `${i.sku}×${i.quantity}`).join(', ')
      await prisma.merchantNotification.createMany({
        data: warehouseUsers.map((wu) => ({
          tenantId: request.user.tenantId,
          userId: wu.id,
          type: 'MANUAL_ORDER_CREATED' as const,
          title: '新手工单',
          body: `${buyerName?.trim() || buyerPhone} — ${itemSummary}`,
          payload: { orderId: order.id },
        })),
      })
    }

    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: 'order.manual_create',
      targetType: 'order',
      targetId: order.id,
      payload: { platformOrderId, items },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return { success: true, data: order }
  })

  // POST /:id/manual-ship — warehouse marks a manual order as shipped
  app.post('/:id/manual-ship', async (request, reply) => {
    if (request.user.role === 'MERCHANT') {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }
    const { id } = request.params as { id: string }
    const order = await prisma.order.findFirst({
      where: { id, tenantId: request.user.tenantId, isManual: true },
    })
    if (!order) return reply.status(404).send({ success: false, error: 'Manual order not found' })
    if (order.manualStatus !== 'PENDING') {
      return reply.status(400).send({ success: false, error: 'Order already shipped' })
    }

    const updated = await prisma.order.update({
      where: { id },
      data: { manualStatus: 'SHIPPED', status: 'COMPLETED' },
    })

    // Notify the merchant who created the order
    if (order.createdByUserId) {
      await prisma.merchantNotification.create({
        data: {
          tenantId: request.user.tenantId,
          userId: order.createdByUserId,
          type: 'MANUAL_ORDER_SHIPPED' as const,
          title: '手工单已发货',
          body: `订单 ${order.platformOrderId} 已由仓库确认发货`,
          payload: { orderId: order.id },
        },
      })
    }

    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: 'order.manual_ship',
      targetType: 'order',
      targetId: id,
      payload: {},
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return { success: true, data: updated }
  })

  // DELETE /:id — hard-delete a manual order (merchant/admin only)
  app.delete('/:id', async (request, reply) => {
    if (request.user.role !== 'MERCHANT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }
    const { id } = request.params as { id: string }
    const order = await prisma.order.findFirst({
      where: { id, tenantId: request.user.tenantId, isManual: true },
    })
    if (!order) return reply.status(404).send({ success: false, error: 'Manual order not found' })
    if (request.user.role === 'MERCHANT' && order.createdByUserId !== request.user.userId) {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }

    await prisma.order.delete({ where: { id } })

    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: 'order.manual_delete',
      targetType: 'order',
      targetId: id,
      payload: { platformOrderId: order.platformOrderId },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return { success: true }
  })

  app.get('/', async (request) => {
    const {
      status, shopId, ownerUserId, merchantConfirm, page = 1, pageSize = 20, search, sku,
      sortBy = 'sku', sortOrder = 'desc', isManual,
    } = request.query as {
      status?: string; shopId?: string; ownerUserId?: string; merchantConfirm?: string
      page?: number; pageSize?: number; search?: string; sku?: string
      sortBy?: 'sku' | 'date'; sortOrder?: 'asc' | 'desc'; isManual?: string
    }
    const statusList = (status ?? '').split(',').map((s) => s.trim()).filter(Boolean)

    // Manual orders tab: separate query path — no shop relation, no confirm gate
    if (isManual === 'true') {
      const manualWhere: Record<string, unknown> = {
        tenantId: request.user.tenantId,
        isManual: true,
        ...(request.user.role === 'MERCHANT' ? { createdByUserId: request.user.userId } : {}),
        ...(search ? {
          OR: [
            { platformOrderId: { contains: search } },
            { buyerName: { contains: search, mode: 'insensitive' as const } },
          ],
        } : {}),
        ...(sku ? { items: { some: { sellerSku: { contains: sku, mode: 'insensitive' as const } } } } : {}),
      }
      const [items, total, itemAgg] = await Promise.all([
        prisma.order.findMany({
          where: manualWhere,
          include: { items: true },
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
          orderBy: [{ createdAt: 'desc' }],
        }),
        prisma.order.count({ where: manualWhere }),
        prisma.orderItem.aggregate({ where: { order: manualWhere }, _sum: { quantity: true } }),
      ])
      return { success: true, data: { items, total, totalItems: itemAgg._sum.quantity ?? 0, page: Number(page), pageSize: Number(pageSize), totalPages: Math.ceil(total / Number(pageSize)) } }
    }

    // Role-based scope:
    // - MERCHANT: only own shops, sees ALL merchantConfirmStatus by default
    // - WAREHOUSE_STAFF / ADMIN: only orders past merchant gate by default
    const shopFilter: Record<string, unknown> = { status: { not: 'INACTIVE' as const } }
    if (request.user.role === 'MERCHANT') {
      shopFilter.ownerUserId = request.user.userId
    } else if (ownerUserId) {
      shopFilter.ownerUserId = ownerUserId
    }

    let merchantConfirmFilter: Record<string, unknown> | undefined
    if (request.user.role === 'MERCHANT') {
      // optional explicit filter
      if (merchantConfirm) merchantConfirmFilter = { merchantConfirmStatus: merchantConfirm }
    } else {
      // warehouse default: only confirmed (incl. auto)
      merchantConfirmFilter = merchantConfirm
        ? { merchantConfirmStatus: merchantConfirm }
        : { merchantConfirmStatus: { in: ['CONFIRMED', 'AUTO_CONFIRMED'] as const } }
    }

    const statusFilter = statusList.length === 1
      ? { status: statusList[0] as any }
      : statusList.length > 1
        ? { status: { in: statusList as any[] } }
        : {}

    // Manual orders (no shop, always CONFIRMED) are included in the regular list
    // so they appear in "待发货" alongside platform orders.
    const manualBranch: Record<string, unknown> = {
      isManual: true,
      ...(request.user.role === 'MERCHANT' ? { createdByUserId: request.user.userId } : {}),
      ...statusFilter,
    }
    const platformBranch: Record<string, unknown> = {
      isManual: false,
      shop: shopFilter,
      ...(merchantConfirmFilter ?? {}),
      ...statusFilter,
      ...(shopId ? { shopId } : {}),
    }

    const where: Record<string, unknown> = {
      tenantId: request.user.tenantId,
      OR: [platformBranch, manualBranch],
      ...(search ? {
        OR: [
          { platformOrderId: { contains: search } },
          { buyerName: { contains: search, mode: 'insensitive' as const } },
        ],
      } : {}),
      // Match any order item by sellerSku (case-insensitive, substring). Uses
      // `items.some` rather than the denormalized firstSellerSku so multi-item
      // orders are still found when the SKU is on a non-first line.
      ...(sku ? {
        items: { some: { sellerSku: { contains: sku, mode: 'insensitive' as const } } },
      } : {}),
    }
    const dir = sortOrder === 'asc' ? 'asc' : 'desc'
    const orderBy = sortBy === 'date'
      ? [{ platformCreatedAt: dir as any }, { createdAt: dir as any }]
      // Sort by SKU first, then by creation date as a secondary key so rows
      // with the same SKU appear newest-first.
      : [{ firstSellerSku: { sort: dir as any, nulls: 'last' as const } }, { platformCreatedAt: 'desc' as const }]
    const [items, total, itemAgg] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          shop: {
            select: {
              name: true,
              platform: true,
              ownerUserId: true,
              owner: { select: { id: true, name: true, email: true } },
            },
          },
          items: true,
        },
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
        orderBy,
      }),
      prisma.order.count({ where }),
      // Sum of order item quantities across the entire filtered set (not just
      // the current page) — drives the footer count alongside `total`.
      prisma.orderItem.aggregate({
        where: { order: where },
        _sum: { quantity: true },
      }),
    ])
    const totalItems = itemAgg._sum.quantity ?? 0
    return { success: true, data: { items, total, totalItems, page: Number(page), pageSize: Number(pageSize), totalPages: Math.ceil(total / Number(pageSize)) } }
  })

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const where: Record<string, unknown> = { id, tenantId: request.user.tenantId }
    if (request.user.role === 'MERCHANT') {
      where.shop = { ownerUserId: request.user.userId }
    }
    const order = await prisma.order.findFirst({
      where,
      include: {
        shop: { include: { owner: { select: { id: true, name: true, email: true } } } },
        items: { include: { systemSku: { include: { systemProduct: true } } } },
        afterSalesTickets: true,
      },
    })
    if (!order) return reply.status(404).send({ success: false, error: 'Order not found' })
    return { success: true, data: order }
  })

  app.patch('/:id/status', { preHandler: requireCapabilities(['ORDER_PROCESS']) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { status } = request.body as { status: string }
    const order = await prisma.order.findFirst({ where: { id, tenantId: request.user.tenantId } })
    if (!order) return reply.status(404).send({ success: false, error: 'Order not found' })
    const updated = await prisma.order.update({ where: { id }, data: { status: status as any } })
    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: AuditAction.ORDER_STATUS_UPDATE,
      targetType: 'order',
      targetId: id,
      payload: { from: order.status, to: status },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })
    return { success: true, data: updated }
  })

  // POST /:id/merchant-confirm — merchant confirms an order; warehouse becomes
  // visible. Reserves inventory.
  app.post('/:id/merchant-confirm', async (request, reply) => {
    if (request.user.role !== 'MERCHANT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }
    const { id } = request.params as { id: string }
    const order = await prisma.order.findFirst({
      where: {
        id,
        tenantId: request.user.tenantId,
        ...(request.user.role === 'MERCHANT' ? { shop: { ownerUserId: request.user.userId } } : {}),
      },
      include: { shop: true, items: true },
    })
    if (!order) return reply.status(404).send({ success: false, error: 'Order not found' })
    if (order.merchantConfirmStatus !== 'PENDING_CONFIRM') {
      return reply.status(400).send({ success: false, error: `Order is already ${order.merchantConfirmStatus}` })
    }

    const updated = await prisma.order.update({
      where: { id },
      data: {
        merchantConfirmStatus: 'CONFIRMED',
        merchantConfirmedAt: new Date(),
      },
    })

    // Try to reserve inventory (best effort — warehouse will see the order regardless)
    await reserveStockForOrder(id, request.user.tenantId, request.user.userId).catch((err) => {
      console.warn(`[orders] reserveStockForOrder failed for ${id}:`, (err as Error).message)
    })

    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: AuditAction.ORDER_MERCHANT_CONFIRM,
      targetType: 'order',
      targetId: id,
      payload: { ownerUserId: order.shop?.ownerUserId ?? null },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return { success: true, data: updated }
  })

  // POST /:id/merchant-cancel — merchant cancels the order. For TikTok orders
  // this calls the platform cancel API first; if TK refuses (already shipped,
  // etc.) we bail without touching local state. For manual orders it's purely
  // a local flag. Either way, releases any inventory reservation.
  app.post('/:id/merchant-cancel', async (request, reply) => {
    if (request.user.role !== 'MERCHANT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }
    const { id } = request.params as { id: string }
    const { reason, reasonKey } = (request.body ?? {}) as { reason?: string; reasonKey?: string }
    const order = await prisma.order.findFirst({
      where: {
        id,
        tenantId: request.user.tenantId,
        ...(request.user.role === 'MERCHANT' ? { shop: { ownerUserId: request.user.userId } } : {}),
      },
      include: { shop: true },
    })
    if (!order) return reply.status(404).send({ success: false, error: 'Order not found' })

    if (order.shop?.platform === 'TIKTOK' && !order.isManual) {
      try {
        const appCreds = await getShopTikTokAppCreds(order.shop.id)
        const adapter = new TikTokAdapter(appCreds)
        await adapter.cancelOrder(order.shop, order.platformOrderId, reasonKey ?? 'SELLER_OUT_OF_STOCK')
      } catch (err) {
        const msg = (err as Error).message
        console.error(`[orders] cancelOrder ${id} failed on TK:`, msg)
        return reply.status(502).send({ success: false, error: `TikTok refused cancel: ${msg}` })
      }
    }

    const wasConfirmed = order.merchantConfirmStatus === 'CONFIRMED' || order.merchantConfirmStatus === 'AUTO_CONFIRMED'

    const updated = await prisma.order.update({
      where: { id },
      data: {
        merchantConfirmStatus: 'CANCELLED_BY_MERCHANT',
        status: 'CANCELLED',
      },
    })

    if (wasConfirmed) {
      await releaseStockForOrder(id, request.user.tenantId, request.user.userId).catch((err) => {
        console.warn(`[orders] releaseStockForOrder failed for ${id}:`, (err as Error).message)
      })
    }

    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: AuditAction.ORDER_MERCHANT_CANCEL,
      targetType: 'order',
      targetId: id,
      payload: { reason: reason ?? null, reasonKey: reasonKey ?? null, wasConfirmed },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return { success: true, data: updated }
  })

  // POST /:id/items/:itemId/replace-sku — merchant swaps an out-of-stock item
  // for a different SystemSku. Snapshots the original SKU on first replacement
  // so the warehouse can render an old→new diff (and the shipping label can be
  // stamped). If the order is already CONFIRMED/AUTO_CONFIRMED, releases the
  // old SKU's reservation and reserves the new one. Quantity is preserved.
  // Allowed only while the order is still in a TO_SHIP-like status.
  app.post('/:id/items/:itemId/replace-sku', async (request, reply) => {
    if (request.user.role !== 'MERCHANT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }
    const { id, itemId } = request.params as { id: string; itemId: string }
    const { newSystemSkuId } = (request.body ?? {}) as { newSystemSkuId?: string }
    if (!newSystemSkuId) return reply.status(400).send({ success: false, error: 'newSystemSkuId required' })

    const order = await prisma.order.findFirst({
      where: {
        id,
        tenantId: request.user.tenantId,
        ...(request.user.role === 'MERCHANT' ? { shop: { ownerUserId: request.user.userId } } : {}),
      },
      include: { shop: { select: { ownerUserId: true } }, items: { where: { id: itemId } } },
    })
    if (!order) return reply.status(404).send({ success: false, error: 'Order not found' })
    const item = order.items[0]
    if (!item) return reply.status(404).send({ success: false, error: 'Order item not found' })

    // SKU swap only makes sense pre-shipment. TO_SHIP-family statuses are the
    // window where the warehouse hasn't picked yet (or hasn't shipped yet).
    const ALLOWED_STATUSES = ['ON_HOLD', 'AWAITING_SHIPMENT', 'AWAITING_COLLECTION', 'PARTIALLY_SHIPPING', 'TO_SHIP', 'PENDING'] as const
    if (!(ALLOWED_STATUSES as readonly string[]).includes(order.status)) {
      return reply.status(400).send({ success: false, error: `Cannot replace SKU when order status is ${order.status}` })
    }
    const ALLOWED_CONFIRM = ['PENDING_CONFIRM', 'CONFIRMED', 'AUTO_CONFIRMED'] as const
    if (!(ALLOWED_CONFIRM as readonly string[]).includes(order.merchantConfirmStatus)) {
      return reply.status(400).send({ success: false, error: `Cannot replace SKU when order is ${order.merchantConfirmStatus}` })
    }

    // Resolve target SystemSku — must belong to this merchant's catalog.
    const newSku = await prisma.systemSku.findFirst({
      where: {
        id: newSystemSkuId,
        systemProduct: {
          tenantId: request.user.tenantId,
          ...(request.user.role === 'MERCHANT' ? { ownerUserId: request.user.userId } : {}),
        },
      },
      include: { systemProduct: { select: { name: true, ownerUserId: true } } },
    })
    if (!newSku) return reply.status(400).send({ success: false, error: 'Invalid replacement SKU' })

    if (item.systemSkuId === newSku.id) {
      return reply.status(400).send({ success: false, error: 'New SKU is identical to current SKU' })
    }

    // Reservation accounting — only meaningful once the order is past the
    // merchant gate. PENDING_CONFIRM never reserved anything, so there's no
    // movement to do.
    const wasReserved = order.merchantConfirmStatus === 'CONFIRMED' || order.merchantConfirmStatus === 'AUTO_CONFIRMED'

    // Capture original snapshot only on the FIRST replacement so re-edits
    // don't clobber the buyer-facing values with intermediate state.
    const isFirstReplacement = !item.replacedAt

    // Compute the new sellerSku. Prefer skuCode (the merchant's internal code)
    // as the human-readable seller SKU shown to the warehouse — this is the
    // pattern used elsewhere in the system.
    const newSellerSku = newSku.skuCode
    const newSkuVariantName = formatAttributes(newSku.attributes as Record<string, unknown> | null)

    await prisma.$transaction(async (tx) => {
      // 1) Release old reservation (best-effort, by warehouseSku lookup).
      if (wasReserved && item.systemSkuId) {
        const oldWsku = await tx.warehouseSku.findFirst({
          where: {
            systemSkuId: item.systemSkuId,
            ...(order.shop?.ownerUserId ? { ownerUserId: order.shop.ownerUserId } : {}),
          },
          select: { id: true, warehouseId: true },
        })
        if (oldWsku) {
          await tx.inventoryEvent.create({
            data: {
              tenantId: request.user.tenantId,
              warehouseSkuId: oldWsku.id,
              warehouseId: oldWsku.warehouseId,
              eventType: 'UNRESERVED',
              quantityDelta: item.quantity,
              referenceType: 'order',
              referenceId: id,
              createdBy: request.user.userId,
            },
          })
          await tx.warehouseSku.update({
            where: { id: oldWsku.id },
            data: { quantityReserved: { increment: -item.quantity } },
          })
        }
      }

      // 2) Reserve against new SKU (best-effort — if not in the merchant's
      // warehouse catalog, warehouse staff will resolve when picking).
      if (wasReserved) {
        const newWsku = await tx.warehouseSku.findFirst({
          where: {
            systemSkuId: newSku.id,
            ...(order.shop?.ownerUserId ? { ownerUserId: order.shop.ownerUserId } : {}),
          },
          select: { id: true, warehouseId: true },
        })
        if (newWsku) {
          await tx.inventoryEvent.create({
            data: {
              tenantId: request.user.tenantId,
              warehouseSkuId: newWsku.id,
              warehouseId: newWsku.warehouseId,
              eventType: 'RESERVED',
              quantityDelta: -item.quantity,
              referenceType: 'order',
              referenceId: id,
              createdBy: request.user.userId,
            },
          })
          await tx.warehouseSku.update({
            where: { id: newWsku.id },
            data: { quantityReserved: { increment: item.quantity } },
          })
        }
      }

      // 3) Update the order item itself.
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          systemSkuId: newSku.id,
          sellerSku: newSellerSku,
          productName: newSku.systemProduct.name,
          skuName: newSkuVariantName,
          replacedAt: new Date(),
          replacedByUserId: request.user.userId,
          ...(isFirstReplacement
            ? {
                originalSellerSku: item.sellerSku,
                originalSystemSkuId: item.systemSkuId,
                originalSkuName: item.skuName,
                originalProductName: item.productName,
              }
            : {}),
        },
      })

      // 4) Refresh denormalized firstSellerSku on the order if this item
      // was the first one (or the only one with a sellerSku set).
      const firstItem = await tx.orderItem.findFirst({
        where: { orderId: id },
        orderBy: { id: 'asc' },
        select: { sellerSku: true },
      })
      if (firstItem) {
        await tx.order.update({
          where: { id },
          data: { firstSellerSku: firstItem.sellerSku ?? null },
        })
      }
    })

    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: AuditAction.ORDER_ITEM_REPLACE_SKU,
      targetType: 'order_item',
      targetId: itemId,
      payload: {
        orderId: id,
        from: { systemSkuId: item.systemSkuId, sellerSku: item.sellerSku, productName: item.productName, skuName: item.skuName },
        to:   { systemSkuId: newSku.id,        sellerSku: newSellerSku,    productName: newSku.systemProduct.name, skuName: newSkuVariantName },
        quantity: item.quantity,
        wasReserved,
      },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return { success: true }
  })

  // GET /:id/shipping-label — fetch shipping label from platform
  // Query params: type, size, packageId (optional — pass to target a specific
  // package for orders split across multiple packages).
  app.get('/:id/shipping-label', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { type = 'SHIPPING_LABEL_AND_PACKING_SLIP', size = 'A6', packageId } = request.query as {
      type?: string; size?: string; packageId?: string
    }

    const order = await prisma.order.findFirst({
      where: { id, tenantId: request.user.tenantId },
      include: { shop: true },
    })
    if (!order) return reply.status(404).send({ success: false, error: 'Order not found' })
    if (!order.shop) return reply.status(400).send({ success: false, error: 'Shipping labels not supported for manual orders' })

    if (order.shop.platform === 'TIKTOK') {
      const appCreds = await getShopTikTokAppCreds(order.shop.id)
      const adapter = new TikTokAdapter(appCreds)
      // Prefer explicit packageId from caller; else fall back to the first
      // package_id on the stored line_items.
      const meta = (order.platformMetadata ?? {}) as { line_items?: Array<{ package_id?: string }> }
      const packageIdHint = packageId ?? meta.line_items?.find((li) => li.package_id)?.package_id
      try {
        const { docUrl } = await adapter.getShippingLabel(
          order.shop as any,
          order.platformOrderId,
          type as any,
          size as 'A5' | 'A6',
          packageIdHint,
        )
        return { success: true, data: { docUrl, platform: 'TIKTOK' } }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[orders] Shipping label error for order ${id}:`, msg)
        return reply.status(400).send({ success: false, error: msg })
      }
    }

    return reply.status(400).send({ success: false, error: `Shipping labels not supported for ${order.shop.platform}` })
  })

  // GET /label-proxy?url=... — fetch a signed TikTok label PDF on behalf of the
  // browser, which can't hit open-fs-sg.tiktokshop.com directly due to CORS.
  // Used by bulk print to merge multiple PDFs client-side.
  app.get('/label-proxy', async (request, reply) => {
    const { url } = request.query as { url?: string }
    if (!url) return reply.status(400).send({ success: false, error: 'url query param required' })
    let parsed: URL
    try { parsed = new URL(url) } catch { return reply.status(400).send({ success: false, error: 'invalid url' }) }
    if (!parsed.hostname.endsWith('.tiktokshop.com')) {
      return reply.status(400).send({ success: false, error: 'only tiktokshop.com URLs allowed' })
    }
    const upstream = await fetch(url)
    if (!upstream.ok) {
      return reply.status(502).send({ success: false, error: `upstream returned ${upstream.status}` })
    }
    const buf = Buffer.from(await upstream.arrayBuffer())
    reply.header('content-type', upstream.headers.get('content-type') ?? 'application/pdf')
    reply.header('cache-control', 'private, max-age=60')
    return reply.send(buf)
  })

  // POST /:id/run-rules — manually run all rules against a specific order
  app.post('/:id/run-rules', async (request, reply) => {
    const { id } = request.params as { id: string }
    const order = await prisma.order.findFirst({ where: { id, tenantId: request.user.tenantId } })
    if (!order) return reply.status(404).send({ success: false, error: 'Order not found' })
    await runRulesForOrder(id, request.user.tenantId)
    const updated = await prisma.order.findUnique({ where: { id } })
    return { success: true, data: updated }
  })
}
