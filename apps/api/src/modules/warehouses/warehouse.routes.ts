import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { requireRoles } from '../../middleware/authorize'
import { recordAudit, AuditAction } from '../../lib/audit'

const createWarehouseSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['LOCAL', 'OVERSEAS', 'THREE_PL']).default('LOCAL'),
  address: z.record(z.unknown()).optional(),
  isDefault: z.boolean().default(false),
})

const updateWarehouseSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['LOCAL', 'OVERSEAS', 'THREE_PL']).optional(),
  address: z.record(z.unknown()).optional(),
  isDefault: z.boolean().optional(),
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

  app.post('/', { preHandler: requireRoles(['ADMIN']) }, async (request, reply) => {
    const body = createWarehouseSchema.parse(request.body)
    const warehouse = await prisma.warehouse.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { ...body, tenantId: request.user.tenantId } as any,
    })
    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: AuditAction.WAREHOUSE_CREATE,
      targetType: 'warehouse',
      targetId: warehouse.id,
      payload: { name: warehouse.name, type: warehouse.type, isDefault: warehouse.isDefault },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })
    return reply.status(201).send({ success: true, data: warehouse })
  })

  app.patch('/:id', { preHandler: requireRoles(['ADMIN']) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = updateWarehouseSchema.parse(request.body)
    const existing = await prisma.warehouse.findFirst({
      where: { id, tenantId: request.user.tenantId },
    })
    if (!existing) return reply.status(404).send({ success: false, error: 'Warehouse not found' })
    const updated = await prisma.warehouse.update({
      where: { id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: body as any,
    })
    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: AuditAction.WAREHOUSE_UPDATE,
      targetType: 'warehouse',
      targetId: id,
      payload: { name: updated.name, changes: Object.keys(body) },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })
    return { success: true, data: updated }
  })
}
