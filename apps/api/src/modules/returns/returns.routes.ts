import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { requireCapabilities } from '../../middleware/authorize'
import { recordAudit, AuditAction } from '../../lib/audit'
import { createInventoryEvent } from '../inventory/inventory.service'

const intakeSchema = z.object({
  arrivedAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
})

const inspectSchema = z.object({
  condition: z.enum(['SELLABLE', 'DAMAGED', 'DISPOSED']),
  returnedQty: z.number().int().min(0),
  warehouseSkuId: z.string().optional(), // required when condition=SELLABLE
  notes: z.string().max(2000).optional(),
})

const rejectSchema = z.object({
  reason: z.string().min(1).max(500),
})

export async function returnsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /returns — scoped by role
  // - MERCHANT: sees own (any reviewStatus). Default UI lands on PENDING_REVIEW.
  // - WAREHOUSE/ADMIN: only sees CONFIRMED tickets (where the merchant has
  //   approved the return). PENDING/REJECTED never reach warehouse.
  app.get('/', async (request) => {
    const q = request.query as {
      status?: string
      condition?: string
      reviewStatus?: string
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

    const where: Record<string, unknown> = {
      order: orderFilter,
      ...(q.status ? { status: q.status } : {}),
      ...(q.condition ? { condition: q.condition } : {}),
    }
    if (request.user.role === 'MERCHANT') {
      // merchant: optional explicit filter
      if (q.reviewStatus) where.reviewStatus = q.reviewStatus
    } else {
      // warehouse/admin default: only show what merchant has confirmed
      where.reviewStatus = q.reviewStatus ?? 'CONFIRMED'
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

  // POST /returns/:id/merchant-confirm — merchant approves the platform return
  app.post('/:id/merchant-confirm', async (request, reply) => {
    if (request.user.role !== 'MERCHANT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }
    const { id } = request.params as { id: string }
    const ticket = await prisma.afterSalesTicket.findFirst({
      where: {
        id,
        order: {
          tenantId: request.user.tenantId,
          ...(request.user.role === 'MERCHANT' ? { shop: { ownerUserId: request.user.userId } } : {}),
        },
      },
    })
    if (!ticket) return reply.status(404).send({ success: false, error: 'Ticket not found' })
    if (ticket.reviewStatus !== 'PENDING_REVIEW') {
      return reply.status(400).send({ success: false, error: `Ticket is already ${ticket.reviewStatus}` })
    }

    const updated = await prisma.afterSalesTicket.update({
      where: { id },
      data: {
        reviewStatus: 'CONFIRMED',
        reviewedAt: new Date(),
        reviewedByUserId: request.user.userId,
        status: 'PROCESSING',
      },
    })

    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: 'return.merchant_confirm',
      targetType: 'after_sales_ticket',
      targetId: id,
      payload: {},
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return { success: true, data: updated }
  })

  // POST /returns/:id/merchant-reject — merchant rejects the return claim
  // (e.g. buyer wrong, fraud). Ticket moves to REJECTED and is closed.
  app.post('/:id/merchant-reject', async (request, reply) => {
    if (request.user.role !== 'MERCHANT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }
    const { id } = request.params as { id: string }
    const body = rejectSchema.parse(request.body)
    const ticket = await prisma.afterSalesTicket.findFirst({
      where: {
        id,
        order: {
          tenantId: request.user.tenantId,
          ...(request.user.role === 'MERCHANT' ? { shop: { ownerUserId: request.user.userId } } : {}),
        },
      },
    })
    if (!ticket) return reply.status(404).send({ success: false, error: 'Ticket not found' })
    if (ticket.reviewStatus !== 'PENDING_REVIEW') {
      return reply.status(400).send({ success: false, error: `Ticket is already ${ticket.reviewStatus}` })
    }

    const updated = await prisma.afterSalesTicket.update({
      where: { id },
      data: {
        reviewStatus: 'REJECTED',
        reviewedAt: new Date(),
        reviewedByUserId: request.user.userId,
        rejectReason: body.reason,
        status: 'CLOSED',
        resolvedAt: new Date(),
      },
    })

    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: 'return.merchant_reject',
      targetType: 'after_sales_ticket',
      targetId: id,
      payload: { reason: body.reason },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return { success: true, data: updated }
  })

  // POST /returns/:id/intake — warehouse marks the package as arrived
  app.post('/:id/intake', { preHandler: requireCapabilities(['RETURN_INTAKE']) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = intakeSchema.parse(request.body)
    const ticket = await prisma.afterSalesTicket.findFirst({
      where: { id, order: { tenantId: request.user.tenantId } },
    })
    if (!ticket) return reply.status(404).send({ success: false, error: 'Ticket not found' })
    if (ticket.reviewStatus !== 'CONFIRMED') {
      return reply.status(400).send({ success: false, error: 'Ticket has not been confirmed by the merchant yet' })
    }

    const updated = await prisma.afterSalesTicket.update({
      where: { id },
      data: {
        status: 'PROCESSING',
        arrivedAt: body.arrivedAt ? new Date(body.arrivedAt) : new Date(),
        notes: body.notes ?? ticket.notes,
      },
    })

    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: AuditAction.RETURN_INTAKE,
      targetType: 'after_sales_ticket',
      targetId: id,
      payload: { arrivedAt: updated.arrivedAt },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return { success: true, data: updated }
  })

  // POST /returns/:id/inspect — warehouse grades the goods
  app.post('/:id/inspect', { preHandler: requireCapabilities(['RETURN_INTAKE']) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = inspectSchema.parse(request.body)
    const ticket = await prisma.afterSalesTicket.findFirst({
      where: { id, order: { tenantId: request.user.tenantId } },
      include: { order: { include: { shop: true, items: true } } },
    })
    if (!ticket) return reply.status(404).send({ success: false, error: 'Ticket not found' })
    if (ticket.reviewStatus !== 'CONFIRMED') {
      return reply.status(400).send({ success: false, error: 'Ticket has not been confirmed by the merchant yet' })
    }
    if (!ticket.arrivedAt) return reply.status(400).send({ success: false, error: 'Goods have not been marked as arrived (intake required first)' })

    if (body.condition === 'SELLABLE') {
      if (body.returnedQty <= 0) {
        return reply.status(400).send({ success: false, error: 'returnedQty must be > 0 for SELLABLE returns' })
      }
      if (!body.warehouseSkuId) {
        return reply.status(400).send({ success: false, error: 'warehouseSkuId required for SELLABLE condition' })
      }
      const wsku = await prisma.warehouseSku.findFirst({
        where: {
          id: body.warehouseSkuId,
          ownerUserId: ticket.order.shop.ownerUserId,
          warehouse: { tenantId: request.user.tenantId },
        },
      })
      if (!wsku) {
        return reply.status(400).send({ success: false, error: 'WarehouseSku not found or does not belong to this merchant' })
      }
      await createInventoryEvent({
        tenantId: request.user.tenantId,
        warehouseSkuId: wsku.id,
        warehouseId: wsku.warehouseId,
        eventType: 'RETURN',
        quantityDelta: body.returnedQty,
        referenceType: 'after_sales_ticket',
        referenceId: id,
        notes: `Return inspected: SELLABLE × ${body.returnedQty}. ${body.notes ?? ''}`.trim(),
        createdBy: request.user.userId,
      })
    }

    const updated = await prisma.afterSalesTicket.update({
      where: { id },
      data: {
        condition: body.condition,
        returnedQty: body.returnedQty,
        inspectedAt: new Date(),
        inspectedByUserId: request.user.userId,
        status: 'RESOLVED',
        resolvedAt: new Date(),
      },
    })

    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: AuditAction.RETURN_INSPECT,
      targetType: 'after_sales_ticket',
      targetId: id,
      payload: {
        condition: body.condition,
        returnedQty: body.returnedQty,
        warehouseSkuId: body.warehouseSkuId,
        notes: body.notes,
      },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return { success: true, data: updated }
  })
}
