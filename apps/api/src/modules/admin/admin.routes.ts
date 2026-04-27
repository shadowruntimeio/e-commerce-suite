import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma, type Capability } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { requireRoles } from '../../middleware/authorize'
import { recordAudit, AuditAction } from '../../lib/audit'

const ALL_CAPABILITIES = [
  'ORDER_VIEW',
  'ORDER_PROCESS',
  'ORDER_CANCEL',
  'INVENTORY_VIEW',
  'INVENTORY_ADJUST',
  'PO_APPROVE',
  'RETURN_INTAKE',
] as const

const createUserSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('WAREHOUSE_STAFF'),
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
    capabilities: z.array(z.enum(ALL_CAPABILITIES)).min(1, 'At least one capability is required'),
    warehouseScope: z.array(z.string()).default([]),
  }),
  z.object({
    role: z.literal('MERCHANT'),
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
    settings: z.object({
      autoConfirmHours: z.number().int().min(1).max(168).default(24),
    }).default({ autoConfirmHours: 24 }),
  }),
])

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  capabilities: z.array(z.enum(ALL_CAPABILITIES)).optional(),
  warehouseScope: z.array(z.string()).optional(),
  settings: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
})

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)
  // Only ADMIN may manage users
  app.addHook('preHandler', requireRoles([]))

  // GET /admin/users — list all sub-accounts in this tenant
  app.get('/users', async (request) => {
    const q = request.query as { role?: string }
    const where: Record<string, unknown> = { tenantId: request.user.tenantId }
    if (q.role) where.role = q.role
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        capabilities: true,
        warehouseScope: true,
        settings: true,
        isActive: true,
        createdByUserId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    return { success: true, data: users }
  })

  // POST /admin/users — create warehouse staff or merchant
  app.post('/users', async (request, reply) => {
    const body = createUserSchema.parse(request.body)

    const existing = await prisma.user.findFirst({
      where: { tenantId: request.user.tenantId, email: body.email },
    })
    if (existing) return reply.status(409).send({ success: false, error: 'Email already exists in this tenant' })

    const passwordHash = await bcrypt.hash(body.password, 12)

    const data: Record<string, unknown> = {
      tenantId: request.user.tenantId,
      email: body.email,
      passwordHash,
      name: body.name,
      role: body.role,
      createdByUserId: request.user.userId,
    }

    if (body.role === 'WAREHOUSE_STAFF') {
      data.capabilities = body.capabilities as Capability[]
      data.warehouseScope = body.warehouseScope
    } else {
      data.settings = body.settings
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await prisma.user.create({ data: data as any })

    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action: AuditAction.USER_CREATE,
      targetType: 'user',
      targetId: user.id,
      payload: {
        role: user.role,
        capabilities: user.capabilities,
        warehouseScope: user.warehouseScope,
      },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return reply.status(201).send({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        capabilities: user.capabilities,
        warehouseScope: user.warehouseScope,
        settings: user.settings,
        isActive: user.isActive,
      },
    })
  })

  // PATCH /admin/users/:id — update capabilities, scope, settings, or active state
  app.patch('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = updateUserSchema.parse(request.body)

    const target = await prisma.user.findFirst({
      where: { id, tenantId: request.user.tenantId },
    })
    if (!target) return reply.status(404).send({ success: false, error: 'User not found' })
    if (target.role === 'ADMIN' && id !== request.user.userId) {
      return reply.status(403).send({ success: false, error: 'Cannot modify another admin' })
    }

    if (target.role === 'WAREHOUSE_STAFF' && body.capabilities && body.capabilities.length === 0) {
      return reply.status(400).send({ success: false, error: 'WAREHOUSE_STAFF must keep at least one capability' })
    }

    const before = {
      capabilities: target.capabilities,
      warehouseScope: target.warehouseScope,
      settings: target.settings,
      isActive: target.isActive,
      name: target.name,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {}
    if (body.name !== undefined) updateData.name = body.name
    if (body.capabilities !== undefined) updateData.capabilities = body.capabilities
    if (body.warehouseScope !== undefined) updateData.warehouseScope = body.warehouseScope
    if (body.settings !== undefined) updateData.settings = body.settings
    if (body.isActive !== undefined) updateData.isActive = body.isActive

    const updated = await prisma.user.update({ where: { id }, data: updateData })

    const action = body.isActive === false
      ? AuditAction.USER_DEACTIVATE
      : body.isActive === true
        ? AuditAction.USER_REACTIVATE
        : AuditAction.USER_UPDATE

    await recordAudit({
      tenantId: request.user.tenantId,
      actorUserId: request.user.userId,
      action,
      targetType: 'user',
      targetId: id,
      payload: { before, after: updateData },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return {
      success: true,
      data: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        capabilities: updated.capabilities,
        warehouseScope: updated.warehouseScope,
        settings: updated.settings,
        isActive: updated.isActive,
      },
    }
  })
}
