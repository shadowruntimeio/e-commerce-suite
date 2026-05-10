import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma, type Capability } from '@ems/db'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt'
import { authenticate } from '../../middleware/authenticate'
import { recordAudit, AuditAction } from '../../lib/audit'

function buildJwtPayload(user: {
  id: string
  tenantId: string
  role: string
  capabilities: string[]
  warehouseScope: string[]
}) {
  return {
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role as 'ADMIN' | 'WAREHOUSE_STAFF' | 'MERCHANT',
    capabilities: user.capabilities as Capability[],
    warehouseScope: user.warehouseScope,
  }
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  tenantName: z.string().min(1),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

export async function authRoutes(app: FastifyInstance) {
  app.post('/register', async (request, reply) => {
    const body = registerSchema.parse(request.body)
    const passwordHash = await bcrypt.hash(body.password, 12)

    const existing = await prisma.user.findFirst({
      where: { email: body.email },
    })
    if (existing) {
      return reply.status(409).send({ success: false, error: 'Email already registered' })
    }

    const tenant = await prisma.tenant.create({ data: { name: body.tenantName } })
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: body.email,
        passwordHash,
        name: body.name,
        role: 'ADMIN',
      },
    })

    const payload = buildJwtPayload(user)
    const accessToken = signAccessToken(payload)
    const refreshToken = signRefreshToken(payload)

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })

    await recordAudit({
      tenantId: tenant.id,
      actorUserId: user.id,
      action: AuditAction.USER_CREATE,
      targetType: 'user',
      targetId: user.id,
      payload: { role: user.role, viaRegister: true },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    })

    return reply.status(201).send({
      success: true,
      data: { accessToken, refreshToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } },
    })
  })

  app.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body)
    const user = await prisma.user.findFirst({
      where: { email: body.email, isActive: true },
    })

    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.status(401).send({ success: false, error: 'Invalid credentials' })
    }

    const payload = buildJwtPayload(user)
    const accessToken = signAccessToken(payload)
    const refreshToken = signRefreshToken(payload)

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })

    await recordAudit({
      tenantId: user.tenantId,
      actorUserId: user.id,
      action: AuditAction.USER_LOGIN,
      targetType: 'user',
      targetId: user.id,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    }).catch(() => { /* don't fail login on audit error */ })

    return {
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          capabilities: user.capabilities,
          warehouseScope: user.warehouseScope,
        },
      },
    }
  })

  app.post('/refresh', async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string }
    if (!refreshToken) return reply.status(400).send({ success: false, error: 'Refresh token required' })

    try {
      const payload = verifyRefreshToken(refreshToken)
      const stored = await prisma.refreshToken.findFirst({
        where: { token: refreshToken, expiresAt: { gt: new Date() } },
      })
      if (!stored) return reply.status(401).send({ success: false, error: 'Invalid refresh token' })

      await prisma.refreshToken.delete({ where: { id: stored.id } })

      const fresh = await prisma.user.findUnique({ where: { id: payload.userId } })
      if (!fresh || !fresh.isActive) {
        return reply.status(401).send({ success: false, error: 'User inactive' })
      }
      const newPayload = buildJwtPayload(fresh)
      const newAccessToken = signAccessToken(newPayload)
      const newRefreshToken = signRefreshToken(newPayload)

      await prisma.refreshToken.create({
        data: {
          userId: payload.userId,
          token: newRefreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      return { success: true, data: { accessToken: newAccessToken, refreshToken: newRefreshToken } }
    } catch {
      return reply.status(401).send({ success: false, error: 'Invalid refresh token' })
    }
  })

  app.get('/me', { preHandler: authenticate }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        capabilities: true,
        warehouseScope: true,
        settings: true,
      },
    })
    return { success: true, data: user }
  })
}
