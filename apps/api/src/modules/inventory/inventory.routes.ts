import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { getCurrentStock, createInventoryEvent } from './inventory.service'
import { z } from 'zod'

const adjustmentSchema = z.object({
  warehouseSkuId: z.string(),
  warehouseId: z.string(),
  quantityDelta: z.number().int(),
  notes: z.string().optional(),
})

export async function inventoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/stock/:warehouseSkuId', async (request, reply) => {
    const { warehouseSkuId } = request.params as { warehouseSkuId: string }
    const stock = await getCurrentStock(warehouseSkuId)
    return { success: true, data: stock }
  })

  app.get('/events', async (request) => {
    const { warehouseSkuId, limit = 50 } = request.query as { warehouseSkuId?: string; limit?: number }
    const events = await prisma.inventoryEvent.findMany({
      where: {
        tenantId: request.user.tenantId,
        ...(warehouseSkuId ? { warehouseSkuId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
    })
    return { success: true, data: events }
  })

  app.post('/adjust', async (request) => {
    const body = adjustmentSchema.parse(request.body)
    const event = await createInventoryEvent({
      tenantId: request.user.tenantId,
      warehouseSkuId: body.warehouseSkuId,
      warehouseId: body.warehouseId,
      eventType: 'ADJUSTMENT',
      quantityDelta: body.quantityDelta,
      notes: body.notes,
      createdBy: request.user.userId,
    })
    return { success: true, data: event }
  })
}
