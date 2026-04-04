import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { z } from 'zod'

const createShipmentSchema = z.object({
  warehouseId: z.string(),
  trackingNumber: z.string().optional(),
  carrier: z.string().optional(),
  shipmentType: z.enum(['SEA', 'AIR', 'RAIL']).default('SEA'),
  originWarehouse: z.string().optional(),
  destination: z.string().optional(),
  estimatedArrival: z.string().datetime().optional(),
  weightKg: z.number().positive().optional(),
  volumeCbm: z.number().positive().optional(),
  cost: z.number().nonnegative().optional(),
  currency: z.string().default('USD'),
  notes: z.string().optional(),
})

const updateShipmentSchema = z.object({
  trackingNumber: z.string().optional(),
  carrier: z.string().optional(),
  status: z.enum(['PENDING', 'IN_TRANSIT', 'ARRIVED', 'CLEARED']).optional(),
  estimatedArrival: z.string().datetime().optional(),
  departedAt: z.string().datetime().optional(),
  cost: z.number().nonnegative().optional(),
  currency: z.string().optional(),
  notes: z.string().optional(),
})

export async function logisticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /logistics/shipments
  app.get('/shipments', async (request) => {
    const tenantId = request.user.tenantId
    const { status, warehouseId, page = 1, pageSize = 20 } = request.query as {
      status?: string
      warehouseId?: string
      page?: number
      pageSize?: number
    }

    const where: any = { tenantId }
    if (status) where.status = status
    if (warehouseId) where.warehouseId = warehouseId

    const [items, total] = await Promise.all([
      prisma.firstLegShipment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
        include: { warehouse: { select: { name: true } } },
      }),
      prisma.firstLegShipment.count({ where }),
    ])

    return {
      success: true,
      data: {
        items,
        total,
        page: Number(page),
        pageSize: Number(pageSize),
        totalPages: Math.ceil(total / Number(pageSize)),
      },
    }
  })

  // POST /logistics/shipments
  app.post('/shipments', async (request, reply) => {
    const tenantId = request.user.tenantId
    const body = createShipmentSchema.parse(request.body)

    const shipment = await prisma.firstLegShipment.create({
      data: {
        tenantId,
        warehouseId: body.warehouseId,
        trackingNumber: body.trackingNumber,
        carrier: body.carrier,
        shipmentType: body.shipmentType,
        originWarehouse: body.originWarehouse,
        destination: body.destination,
        estimatedArrival: body.estimatedArrival ? new Date(body.estimatedArrival) : undefined,
        weightKg: body.weightKg,
        volumeCbm: body.volumeCbm,
        cost: body.cost,
        currency: body.currency,
        notes: body.notes,
      },
      include: { warehouse: { select: { name: true } } },
    })

    return reply.status(201).send({ success: true, data: shipment })
  })

  // PATCH /logistics/shipments/:id
  app.patch('/shipments/:id', async (request, reply) => {
    const tenantId = request.user.tenantId
    const { id } = request.params as { id: string }
    const body = updateShipmentSchema.parse(request.body)

    const existing = await prisma.firstLegShipment.findFirst({
      where: { id, tenantId },
    })

    if (!existing) {
      return reply.status(404).send({ success: false, error: 'Shipment not found' })
    }

    const updated = await prisma.firstLegShipment.update({
      where: { id },
      data: {
        ...(body.trackingNumber !== undefined ? { trackingNumber: body.trackingNumber } : {}),
        ...(body.carrier !== undefined ? { carrier: body.carrier } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.estimatedArrival !== undefined ? { estimatedArrival: new Date(body.estimatedArrival) } : {}),
        ...(body.departedAt !== undefined ? { departedAt: new Date(body.departedAt) } : {}),
        ...(body.cost !== undefined ? { cost: body.cost } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      },
      include: { warehouse: { select: { name: true } } },
    })

    return { success: true, data: updated }
  })

  // DELETE /logistics/shipments/:id — soft delete (set status to CANCELLED)
  app.delete('/shipments/:id', async (request, reply) => {
    const tenantId = request.user.tenantId
    const { id } = request.params as { id: string }

    const existing = await prisma.firstLegShipment.findFirst({
      where: { id, tenantId },
    })

    if (!existing) {
      return reply.status(404).send({ success: false, error: 'Shipment not found' })
    }

    await prisma.firstLegShipment.update({
      where: { id },
      data: { status: 'CANCELLED' },
    })

    return { success: true }
  })
}
