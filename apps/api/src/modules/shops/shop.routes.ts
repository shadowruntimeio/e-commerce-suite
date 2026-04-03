import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'

export async function shopRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const shops = await prisma.shop.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { createdAt: 'asc' },
    })
    return { success: true, data: shops }
  })
}
