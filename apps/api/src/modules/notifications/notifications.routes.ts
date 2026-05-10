import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'

/**
 * Lightweight inbox for the current user. Today only MERCHANTs receive
 * notifications (warehouse-driven shipment events) — admins/staff get an
 * empty list. Generic enough to layer more types on later.
 */
export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/', async (request) => {
    const { unreadOnly } = request.query as { unreadOnly?: string }
    const items = await prisma.merchantNotification.findMany({
      where: {
        userId: request.user.userId,
        ...(unreadOnly === 'true' ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    const unreadCount = await prisma.merchantNotification.count({
      where: { userId: request.user.userId, readAt: null },
    })
    return { success: true, data: { items, unreadCount } }
  })

  app.post('/:id/read', async (request, reply) => {
    const { id } = request.params as { id: string }
    const updated = await prisma.merchantNotification.updateMany({
      where: { id, userId: request.user.userId, readAt: null },
      data: { readAt: new Date() },
    })
    if (updated.count === 0) return reply.status(404).send({ success: false, error: 'Notification not found' })
    return { success: true, data: { id } }
  })

  app.post('/read-all', async (request) => {
    const r = await prisma.merchantNotification.updateMany({
      where: { userId: request.user.userId, readAt: null },
      data: { readAt: new Date() },
    })
    return { success: true, data: { updated: r.count } }
  })
}
