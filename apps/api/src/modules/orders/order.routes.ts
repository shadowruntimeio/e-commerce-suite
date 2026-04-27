import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { requireCapabilities } from '../../middleware/authorize'
import { runRulesForOrder } from './rules-engine'
import { TikTokAdapter } from '../../platform/tiktok/tiktok.adapter'
import { recordAudit, AuditAction } from '../../lib/audit'
import { reserveStockForOrder, releaseStockForOrder } from '../inventory/inventory.service'

export async function orderRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const {
      status, shopId, ownerUserId, merchantConfirm, page = 1, pageSize = 20, search,
      sortBy = 'sku', sortOrder = 'desc',
    } = request.query as {
      status?: string; shopId?: string; ownerUserId?: string; merchantConfirm?: string
      page?: number; pageSize?: number; search?: string
      sortBy?: 'sku' | 'date'; sortOrder?: 'asc' | 'desc'
    }
    const statusList = (status ?? '').split(',').map((s) => s.trim()).filter(Boolean)

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

    const where = {
      tenantId: request.user.tenantId,
      shop: shopFilter,
      ...(merchantConfirmFilter ?? {}),
      ...(statusList.length === 1
        ? { status: statusList[0] as any }
        : statusList.length > 1
          ? { status: { in: statusList as any[] } }
          : {}),
      ...(shopId ? { shopId } : {}),
      ...(search ? {
        OR: [
          { platformOrderId: { contains: search } },
          { buyerName: { contains: search, mode: 'insensitive' as const } },
        ],
      } : {}),
    }
    const dir = sortOrder === 'asc' ? 'asc' : 'desc'
    const orderBy = sortBy === 'date'
      ? [{ platformCreatedAt: dir as any }, { createdAt: dir as any }]
      // Sort by SKU first, then by creation date as a secondary key so rows
      // with the same SKU appear newest-first.
      : [{ firstSellerSku: { sort: dir as any, nulls: 'last' as const } }, { platformCreatedAt: 'desc' as const }]
    const [items, total] = await Promise.all([
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
    ])
    return { success: true, data: { items, total, page: Number(page), pageSize: Number(pageSize), totalPages: Math.ceil(total / Number(pageSize)) } }
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
      payload: { ownerUserId: order.shop.ownerUserId },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return { success: true, data: updated }
  })

  // POST /:id/merchant-cancel — merchant cancels (e.g. out of stock). Updates status
  // to CANCELLED and notes which side cancelled. Releases any reservations.
  app.post('/:id/merchant-cancel', async (request, reply) => {
    if (request.user.role !== 'MERCHANT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }
    const { id } = request.params as { id: string }
    const { reason } = (request.body ?? {}) as { reason?: string }
    const order = await prisma.order.findFirst({
      where: {
        id,
        tenantId: request.user.tenantId,
        ...(request.user.role === 'MERCHANT' ? { shop: { ownerUserId: request.user.userId } } : {}),
      },
    })
    if (!order) return reply.status(404).send({ success: false, error: 'Order not found' })

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
      payload: { reason: reason ?? null, wasConfirmed },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return { success: true, data: updated }
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

    if (order.shop.platform === 'TIKTOK') {
      const adapter = new TikTokAdapter()
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
