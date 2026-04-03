import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'

const createWarehouseSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['LOCAL', 'OVERSEAS', 'THREE_PL']).default('LOCAL'),
  address: z.record(z.unknown()).optional(),
  isDefault: z.boolean().default(false),
})

export async function warehouseRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const warehouses = await prisma.warehouse.findMany({
      where: { tenantId: request.user.tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
    })
    return { success: true, data: warehouses }
  })

  app.post('/', async (request, reply) => {
    const body = createWarehouseSchema.parse(request.body)
    const warehouse = await prisma.warehouse.create({
      data: { ...body, tenantId: request.user.tenantId },
    })
    return reply.status(201).send({ success: true, data: warehouse })
  })
}
