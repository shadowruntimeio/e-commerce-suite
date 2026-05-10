import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { requireRoles } from '../../middleware/authorize'

export async function auditRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)
  // Admin only
  app.addHook('preHandler', requireRoles([]))

  app.get('/', async (request) => {
    const q = request.query as {
      page?: string
      pageSize?: string
      action?: string
      actorUserId?: string
      targetType?: string
      targetId?: string
    }
    const page = Math.max(1, Number(q.page ?? 1))
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 50)))

    const where: Record<string, unknown> = { tenantId: request.user.tenantId }
    if (q.action) where.action = q.action
    if (q.actorUserId) where.actorUserId = q.actorUserId
    if (q.targetType) where.targetType = q.targetType
    if (q.targetId) where.targetId = q.targetId

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
    ])

    return {
      success: true,
      data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    }
  })
}
