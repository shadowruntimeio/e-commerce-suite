import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { requireRoles } from '../../middleware/authorize'

const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
})

export async function categoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const categories = await prisma.productCategory.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { name: 'asc' },
    })
    return { success: true, data: categories }
  })

  app.post('/', { preHandler: requireRoles(['ADMIN', 'WAREHOUSE_STAFF']) }, async (request, reply) => {
    const body = createCategorySchema.parse(request.body)
    const existing = await prisma.productCategory.findUnique({
      where: { tenantId_name: { tenantId: request.user.tenantId, name: body.name } },
    })
    if (existing) return { success: true, data: existing }

    const category = await prisma.productCategory.create({
      data: { tenantId: request.user.tenantId, name: body.name },
    })
    return reply.status(201).send({ success: true, data: category })
  })
}
