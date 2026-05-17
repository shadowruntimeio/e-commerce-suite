import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { requireCapabilities } from '../../middleware/authorize'
import { recordAudit, AuditAction } from '../../lib/audit'
import { createInventoryEvent } from '../inventory/inventory.service'
import { TikTokAdapter } from '../../platform/tiktok/tiktok.adapter'
import { getShopTikTokAppCreds } from '../../platform/tiktok/tiktok-app-creds'

// Statuses where the package is in-flight toward the warehouse. We allow
// process() even on later statuses (COMPLETED etc.) because TK occasionally
// refunds before goods arrive physically.
const RECEIVING_STATUSES = new Set(['RECEIVE_PENDING', 'RETURN_OR_REFUND_PROCESSING'])

const rejectSchema = z.object({
  reason: z.string().min(1).max(500),
})

const processSchema = z.object({
  condition: z.enum(['SELLABLE', 'DAMAGED', 'DISPOSED']),
  returnedQty: z.number().int().min(0),
  warehouseSkuId: z.string().optional(),
  notes: z.string().max(2000).optional(),
})

async function loadTicketWithShop(id: string, tenantId: string) {
  return prisma.afterSalesTicket.findFirst({
    where: { id, order: { tenantId } },
    include: {
      order: {
        include: {
          shop: true,
        },
      },
    },
  })
}

async function buildAdapter(shopId: string): Promise<TikTokAdapter> {
  const appCreds = await getShopTikTokAppCreds(shopId)
  return new TikTokAdapter(appCreds)
}

export async function returnsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /returns
  // - MERCHANT: own shops' returns, filterable by platformReturnStatus.
  // - WAREHOUSE/ADMIN:
  //     view=actionable (default): platformReturnStatus IN RECEIVING_STATUSES
  //       AND arrivedAt IS NULL — packages they need to process.
  //     view=done: arrivedAt IS NOT NULL within last 7d — review their work.
  app.get('/', async (request) => {
    const q = request.query as {
      platformReturnStatus?: string
      view?: 'actionable' | 'done'
      ownerUserId?: string
      page?: string
      pageSize?: string
    }
    const page = Math.max(1, Number(q.page ?? 1))
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 50)))

    const orderFilter: Record<string, unknown> = { tenantId: request.user.tenantId }
    if (request.user.role === 'MERCHANT') {
      orderFilter.shop = { ownerUserId: request.user.userId }
    } else if (q.ownerUserId) {
      orderFilter.shop = { ownerUserId: q.ownerUserId }
    }

    const where: Record<string, unknown> = { order: orderFilter }

    if (request.user.role === 'MERCHANT') {
      if (q.platformReturnStatus) where.platformReturnStatus = q.platformReturnStatus
    } else {
      const view = q.view ?? 'actionable'
      if (view === 'done') {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        where.arrivedAt = { gte: sevenDaysAgo, not: null }
      } else {
        where.arrivedAt = null
        where.platformReturnStatus = { in: Array.from(RECEIVING_STATUSES) }
      }
      if (q.platformReturnStatus) {
        // explicit filter overrides the default IN-clause
        where.platformReturnStatus = q.platformReturnStatus
      }
    }

    const [items, total] = await Promise.all([
      prisma.afterSalesTicket.findMany({
        where,
        include: {
          order: {
            include: {
              shop: {
                select: {
                  id: true, name: true, ownerUserId: true,
                  owner: { select: { id: true, name: true, email: true } },
                },
              },
              items: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.afterSalesTicket.count({ where }),
    ])
    return { success: true, data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } }
  })

  // POST /returns/:id/approve — merchant/admin approves the return on TikTok
  app.post('/:id/approve', async (request, reply) => {
    if (request.user.role !== 'MERCHANT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }
    const { id } = request.params as { id: string }
    const ticket = await loadTicketWithShop(id, request.user.tenantId)
    if (!ticket) return reply.status(404).send({ success: false, error: 'Ticket not found' })
    if (request.user.role === 'MERCHANT' && ticket.order.shop?.ownerUserId !== request.user.userId) {
      return reply.status(404).send({ success: false, error: 'Ticket not found' })
    }
    if (!ticket.platformReturnId || !ticket.order.shop) {
      return reply.status(400).send({ success: false, error: 'Ticket missing platform linkage' })
    }

    const adapter = await buildAdapter(ticket.order.shop.id)
    try {
      await adapter.approveReturn(ticket.order.shop, ticket.platformReturnId)
      const fresh = await adapter.getReturn(ticket.order.shop, ticket.platformReturnId)
      const updated = await prisma.afterSalesTicket.update({
        where: { id },
        data: {
          platformReturnStatus: fresh.return_status,
          platformPayload: fresh as any,
        },
      })

      await recordAudit({
        tenantId: request.user.tenantId,
        actorUserId: request.user.userId,
        action: AuditAction.RETURN_MERCHANT_APPROVE,
        targetType: 'after_sales_ticket',
        targetId: id,
        payload: {
          platformReturnId: ticket.platformReturnId,
          newStatus: fresh.return_status,
        },
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? undefined,
      })

      return { success: true, data: updated }
    } catch (err) {
      const msg = (err as Error).message
      console.error(`[returns] approve ${id} failed:`, msg)
      return reply.status(502).send({ success: false, error: `TikTok approve failed: ${msg}` })
    }
  })

  // POST /returns/:id/reject — merchant/admin rejects the return on TikTok
  app.post('/:id/reject', async (request, reply) => {
    if (request.user.role !== 'MERCHANT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }
    const { id } = request.params as { id: string }
    const body = rejectSchema.parse(request.body)
    const ticket = await loadTicketWithShop(id, request.user.tenantId)
    if (!ticket) return reply.status(404).send({ success: false, error: 'Ticket not found' })
    if (request.user.role === 'MERCHANT' && ticket.order.shop?.ownerUserId !== request.user.userId) {
      return reply.status(404).send({ success: false, error: 'Ticket not found' })
    }
    if (!ticket.platformReturnId || !ticket.order.shop) {
      return reply.status(400).send({ success: false, error: 'Ticket missing platform linkage' })
    }

    const adapter = await buildAdapter(ticket.order.shop.id)
    try {
      await adapter.rejectReturn(ticket.order.shop, ticket.platformReturnId, body.reason)
      const fresh = await adapter.getReturn(ticket.order.shop, ticket.platformReturnId)
      const updated = await prisma.afterSalesTicket.update({
        where: { id },
        data: {
          platformReturnStatus: fresh.return_status,
          platformPayload: fresh as any,
        },
      })

      await recordAudit({
        tenantId: request.user.tenantId,
        actorUserId: request.user.userId,
        action: AuditAction.RETURN_MERCHANT_REJECT,
        targetType: 'after_sales_ticket',
        targetId: id,
        payload: {
          platformReturnId: ticket.platformReturnId,
          newStatus: fresh.return_status,
          reason: body.reason,
        },
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? undefined,
      })

      return { success: true, data: updated }
    } catch (err) {
      const msg = (err as Error).message
      console.error(`[returns] reject ${id} failed:`, msg)
      return reply.status(502).send({ success: false, error: `TikTok reject failed: ${msg}` })
    }
  })

  // POST /returns/:id/process — warehouse intake + inspect in one atomic write
  app.post('/:id/process', { preHandler: requireCapabilities(['RETURN_INTAKE']) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = processSchema.parse(request.body)
    const ticket = await loadTicketWithShop(id, request.user.tenantId)
    if (!ticket) return reply.status(404).send({ success: false, error: 'Ticket not found' })

    if (ticket.arrivedAt) {
      return reply.status(400).send({ success: false, error: 'Return already processed' })
    }

    if (body.condition === 'SELLABLE') {
      if (body.returnedQty <= 0) {
        return reply.status(400).send({ success: false, error: 'returnedQty must be > 0 for SELLABLE returns' })
      }
      if (!body.warehouseSkuId) {
        return reply.status(400).send({ success: false, error: 'warehouseSkuId required for SELLABLE condition' })
      }
    }

    let warehouseSku: { id: string; warehouseId: string } | null = null
    if (body.condition === 'SELLABLE' && body.warehouseSkuId) {
      warehouseSku = await prisma.warehouseSku.findFirst({
        where: {
          id: body.warehouseSkuId,
          ownerUserId: ticket.order.shop?.ownerUserId ?? '',
          warehouse: { tenantId: request.user.tenantId },
        },
        select: { id: true, warehouseId: true },
      })
      if (!warehouseSku) {
        return reply.status(400).send({ success: false, error: 'WarehouseSku not found or does not belong to this merchant' })
      }
    }

    const now = new Date()
    const updated = await prisma.afterSalesTicket.update({
      where: { id },
      data: {
        arrivedAt: now,
        inspectedAt: now,
        inspectedByUserId: request.user.userId,
        condition: body.condition,
        returnedQty: body.returnedQty,
        warehouseSkuId: body.condition === 'SELLABLE' ? body.warehouseSkuId : null,
        notes: body.notes ?? ticket.notes,
        restockedAt: body.condition === 'SELLABLE' ? now : ticket.restockedAt,
      },
    })

    if (body.condition === 'SELLABLE' && warehouseSku) {
      await createInventoryEvent({
        tenantId: request.user.tenantId,
        warehouseSkuId: warehouseSku.id,
        warehouseId: warehouseSku.warehouseId,
        eventType: 'RETURN',
        quantityDelta: body.returnedQty,
        referenceType: 'after_sales_ticket',
        referenceId: id,
        notes: `Return processed: SELLABLE × ${body.returnedQty}. ${body.notes ?? ''}`.trim(),
        createdBy: request.user.userId,
      })
    }

    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: AuditAction.RETURN_PROCESS,
      targetType: 'after_sales_ticket',
      targetId: id,
      payload: {
        condition: body.condition,
        returnedQty: body.returnedQty,
        warehouseSkuId: body.condition === 'SELLABLE' ? body.warehouseSkuId : null,
        notes: body.notes,
      },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return { success: true, data: updated }
  })
}
