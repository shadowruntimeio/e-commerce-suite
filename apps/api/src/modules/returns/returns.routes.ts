import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { requireCapabilities } from '../../middleware/authorize'
import { recordAudit, AuditAction } from '../../lib/audit'
import { createInventoryEvent } from '../inventory/inventory.service'

const createReturnSchema = z.object({
  orderId: z.string(),
  type: z.enum(['RETURN', 'REFUND', 'EXCHANGE', 'DISPUTE']).default('RETURN'),
  expectedQty: z.number().int().min(1).optional(),
  notes: z.string().max(2000).optional(),
})

const intakeSchema = z.object({
  arrivedAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
})

const inspectSchema = z.object({
  condition: z.enum(['SELLABLE', 'DAMAGED', 'DISPOSED']),
  returnedQty: z.number().int().min(0),
  warehouseSkuId: z.string().optional(), // required when condition=SELLABLE to know where to restock
  notes: z.string().max(2000).optional(),
})

export async function returnsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /returns — list tickets, scoped by role
  app.get('/', async (request) => {
    const q = request.query as {
      status?: string; condition?: string; ownerUserId?: string
      page?: string; pageSize?: string
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

    const [items, total] = await Promise.all([
      prisma.afterSalesTicket.findMany({
        where,
        include: {
          order: {
            include: {
              shop: { select: { id: true, name: true, ownerUserId: true } },
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

  // POST /returns — merchant creates a return ticket for an order
  app.post('/', async (request, reply) => {
    if (request.user.role !== 'MERCHANT' && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ success: false, error: 'Forbidden' })
    }
    const body = createReturnSchema.parse(request.body)
    const order = await prisma.order.findFirst({
      where: {
        id: body.orderId,
        tenantId: request.user.tenantId,
        ...(request.user.role === 'MERCHANT' ? { shop: { ownerUserId: request.user.userId } } : {}),
      },
    })
    if (!order) return reply.status(404).send({ success: false, error: 'Order not found' })

    const ticket = await prisma.afterSalesTicket.create({
      data: {
        orderId: body.orderId,
        type: body.type,
        status: 'OPEN',
        expectedQty: body.expectedQty,
        notes: body.notes,
        condition: 'PENDING_INSPECTION',
      },
    })

    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: AuditAction.RETURN_CREATE,
      targetType: 'after_sales_ticket',
      targetId: ticket.id,
      payload: { orderId: body.orderId, type: body.type, expectedQty: body.expectedQty },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return reply.status(201).send({ success: true, data: ticket })
  })

  // POST /returns/:id/intake — warehouse marks the package as arrived
  app.post('/:id/intake', { preHandler: requireCapabilities(['RETURN_INTAKE']) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = intakeSchema.parse(request.body)
    const ticket = await prisma.afterSalesTicket.findFirst({
      where: { id, order: { tenantId: request.user.tenantId } },
    })
    if (!ticket) return reply.status(404).send({ success: false, error: 'Ticket not found' })

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

  // POST /returns/:id/inspect — warehouse grades the goods.
  // SELLABLE → restock to merchant's WarehouseSku
  // DAMAGED/DISPOSED → no inventory change but recorded
  app.post('/:id/inspect', { preHandler: requireCapabilities(['RETURN_INTAKE']) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = inspectSchema.parse(request.body)
    const ticket = await prisma.afterSalesTicket.findFirst({
      where: { id, order: { tenantId: request.user.tenantId } },
      include: { order: { include: { shop: true, items: true } } },
    })
    if (!ticket) return reply.status(404).send({ success: false, error: 'Ticket not found' })
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
