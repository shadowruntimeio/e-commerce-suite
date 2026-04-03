import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'

const createPoSchema = z.object({
  supplierId: z.string(),
  warehouseId: z.string(),
  currency: z.string().default('USD'),
  eta: z.string().datetime().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    systemSkuId: z.string(),
    quantityOrdered: z.number().int().positive(),
    unitCost: z.number().positive(),
  })).min(1),
})

export async function purchaseRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/orders', async (request) => {
    const { status, page = 1, pageSize = 20 } = request.query as { status?: string; page?: number; pageSize?: number }
    const where = {
      tenantId: request.user.tenantId,
      ...(status ? { status: status as any } : {}),
    }
    const [items, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: { supplier: true, warehouse: true, items: { include: { systemSku: true } } },
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.purchaseOrder.count({ where }),
    ])
    return { success: true, data: { items, total, page: Number(page), pageSize: Number(pageSize), totalPages: Math.ceil(total / Number(pageSize)) } }
  })

  app.post('/orders', async (request, reply) => {
    const body = createPoSchema.parse(request.body)
    const totalAmount = body.items.reduce((sum, i) => sum + i.quantityOrdered * i.unitCost, 0)
    const po = await prisma.purchaseOrder.create({
      data: {
        tenantId: request.user.tenantId,
        supplierId: body.supplierId,
        warehouseId: body.warehouseId,
        currency: body.currency,
        eta: body.eta ? new Date(body.eta) : undefined,
        notes: body.notes,
        totalAmount,
        createdBy: request.user.userId,
        items: {
          create: body.items.map((item) => ({
            systemSkuId: item.systemSkuId,
            quantityOrdered: item.quantityOrdered,
            unitCost: item.unitCost,
          })),
        },
      },
      include: { items: true, supplier: true },
    })
    return reply.status(201).send({ success: true, data: po })
  })
}
