import type { FastifyInstance } from 'fastify'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'
import { z } from 'zod'

const tagSchema = z.object({ tag: z.string().min(1).max(50) })

export async function csRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /cs/threads
  app.get('/threads', async (request) => {
    const tenantId = request.user.tenantId
    const { shopId, isRead, tag, page = 1, pageSize = 20 } = request.query as {
      shopId?: string
      isRead?: string
      tag?: string
      page?: number
      pageSize?: number
    }

    const where: any = { tenantId, shop: { status: { not: 'INACTIVE' } } }
    if (shopId) where.shopId = shopId
    if (isRead !== undefined) where.isRead = isRead === 'true'
    if (tag) where.tags = { has: tag }

    const [items, total] = await Promise.all([
      prisma.messageThread.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
        include: { shop: { select: { name: true, platform: true } } },
      }),
      prisma.messageThread.count({ where }),
    ])

    return {
      success: true,
      data: {
        items,
        total,
        page: Number(page),
        pageSize: Number(pageSize),
        totalPages: Math.ceil(total / Number(pageSize)),
      },
    }
  })

  // GET /cs/threads/:threadId/messages
  app.get('/threads/:threadId/messages', async (request) => {
    const tenantId = request.user.tenantId
    const { threadId } = request.params as { threadId: string }

    const thread = await prisma.messageThread.findFirst({
      where: { id: threadId, tenantId },
    })

    if (!thread) {
      return { success: false, error: 'Thread not found' }
    }

    const messages = await prisma.shopMessage.findMany({
      where: { tenantId, platformThreadId: thread.platformThreadId, shopId: thread.shopId },
      orderBy: { platformCreatedAt: 'asc' },
    })

    return { success: true, data: messages }
  })

  // POST /cs/threads/:threadId/read
  app.post('/threads/:threadId/read', async (request) => {
    const tenantId = request.user.tenantId
    const { threadId } = request.params as { threadId: string }

    const thread = await prisma.messageThread.findFirst({
      where: { id: threadId, tenantId },
    })

    if (!thread) {
      return { success: false, error: 'Thread not found' }
    }

    await prisma.$transaction([
      prisma.messageThread.update({
        where: { id: threadId },
        data: { isRead: true },
      }),
      prisma.shopMessage.updateMany({
        where: { tenantId, platformThreadId: thread.platformThreadId, shopId: thread.shopId },
        data: { isRead: true },
      }),
    ])

    return { success: true }
  })

  // POST /cs/threads/:threadId/tags
  app.post('/threads/:threadId/tags', async (request) => {
    const tenantId = request.user.tenantId
    const { threadId } = request.params as { threadId: string }
    const { tag } = tagSchema.parse(request.body)

    const thread = await prisma.messageThread.findFirst({
      where: { id: threadId, tenantId },
    })

    if (!thread) {
      return { success: false, error: 'Thread not found' }
    }

    const newTags = Array.from(new Set([...thread.tags, tag]))

    const updated = await prisma.messageThread.update({
      where: { id: threadId },
      data: { tags: newTags },
    })

    return { success: true, data: updated }
  })
}
