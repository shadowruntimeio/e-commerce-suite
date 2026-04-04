import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { runRulesForOrder } from './rules-engine'

export async function orderRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const { status, shopId, page = 1, pageSize = 20, search } = request.query as {
      status?: string; shopId?: string; page?: number; pageSize?: number; search?: string
    }
    const where = {
      tenantId: request.user.tenantId,
      ...(status ? { status: status as any } : {}),
      ...(shopId ? { shopId } : {}),
      ...(search ? {
        OR: [
          { platformOrderId: { contains: search } },
          { buyerName: { contains: search, mode: 'insensitive' as const } },
        ],
      } : {}),
    }
    const [items, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { shop: { select: { name: true, platform: true } }, items: true },
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.count({ where }),
    ])
    return { success: true, data: { items, total, page: Number(page), pageSize: Number(pageSize), totalPages: Math.ceil(total / Number(pageSize)) } }
  })

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const order = await prisma.order.findFirst({
      where: { id, tenantId: request.user.tenantId },
      include: { shop: true, items: { include: { systemSku: { include: { systemProduct: true } } } }, afterSalesTickets: true },
    })
    if (!order) return reply.status(404).send({ success: false, error: 'Order not found' })
    return { success: true, data: order }
  })

  app.patch('/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { status } = request.body as { status: string }
    const order = await prisma.order.findFirst({ where: { id, tenantId: request.user.tenantId } })
    if (!order) return reply.status(404).send({ success: false, error: 'Order not found' })
    const updated = await prisma.order.update({ where: { id }, data: { status: status as any } })
    return { success: true, data: updated }
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
