import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@ems/db'
import { authenticate } from '../../middleware/authenticate'

/**
 * AI customer support: in-app chat + bug reports.
 *
 * Chat answers are produced by an external `agent-worker` process that polls
 * the `AiTask` table and spawns headless `claude -p` against an EMS-scoped
 * system prompt. The API itself never calls an LLM — it only enqueues tasks
 * and serves the results back to the browser via polling.
 *
 * Bug reports land in `BugReport` with status=OPEN. Triage is manual today:
 * a local `/bug-triage` skill consumes the queue.
 */

const SESSION_TITLE_MAX = 60
const RECENT_MESSAGES_PER_TASK = 6 // worker uses these as context

const newSessionSchema = z.object({
  initialMessage: z.string().min(1).max(2000).optional(),
})

const postMessageSchema = z.object({
  content: z.string().min(1).max(2000),
})

const newBugSchema = z.object({
  summary: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  route: z.string().max(500).optional(),
  consoleErrors: z.unknown().optional(),
  userAgent: z.string().max(500).optional(),
  emsCommitSha: z.string().max(64).optional(),
  shopId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export async function supportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // ─── Chat: sessions ────────────────────────────────────────────────────────

  // GET /support/chat/sessions — list current user's sessions, latest first.
  app.get('/chat/sessions', async (request) => {
    const sessions = await prisma.chatSession.findMany({
      where: { tenantId: request.user.tenantId, userId: request.user.userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    })
    return { success: true, data: sessions }
  })

  // POST /support/chat/sessions — create empty session, optionally with first message.
  app.post('/chat/sessions', async (request, reply) => {
    const parsed = newSessionSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Invalid input' })
    }

    const session = await prisma.chatSession.create({
      data: {
        tenantId: request.user.tenantId,
        userId: request.user.userId,
        title: parsed.data.initialMessage?.slice(0, SESSION_TITLE_MAX) ?? null,
      },
    })

    let userMessageId: string | null = null
    let aiTaskId: string | null = null
    if (parsed.data.initialMessage) {
      const enq = await enqueueUserMessage(session.id, request.user.tenantId, parsed.data.initialMessage)
      userMessageId = enq.userMessageId
      aiTaskId = enq.aiTaskId
    }

    return { success: true, data: { session, userMessageId, aiTaskId } }
  })

  // GET /support/chat/sessions/:id — session + all messages (polled by frontend).
  app.get('/chat/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const session = await prisma.chatSession.findFirst({
      where: { id, tenantId: request.user.tenantId, userId: request.user.userId },
    })
    if (!session) return reply.status(404).send({ success: false, error: 'Session not found' })

    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, role: true, content: true,
        inScope: true, suggestBug: true,
        errorReason: true, latencyMs: true,
        aiTaskId: true, createdAt: true,
      },
    })

    // Surface pending task state so the UI can show a "thinking" indicator
    // without an extra round-trip. We only ever have at most one PENDING /
    // RUNNING task per session at a time (frontend gates input on it).
    const pendingTask = await prisma.aiTask.findFirst({
      where: {
        tenantId: request.user.tenantId,
        status: { in: ['PENDING', 'RUNNING'] },
        // payload->>'sessionId' lookup via JSON path
        payload: { path: ['sessionId'], equals: id },
      },
      select: { id: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })

    return { success: true, data: { session, messages, pendingTask } }
  })

  // DELETE /support/chat/sessions/:id — cascade deletes messages.
  app.delete('/chat/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const deleted = await prisma.chatSession.deleteMany({
      where: { id, tenantId: request.user.tenantId, userId: request.user.userId },
    })
    if (deleted.count === 0) return reply.status(404).send({ success: false, error: 'Session not found' })
    return { success: true, data: { id } }
  })

  // ─── Chat: messages ────────────────────────────────────────────────────────

  // POST /support/chat/sessions/:id/messages — user posts; enqueues AiTask.
  app.post('/chat/sessions/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = postMessageSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Invalid input' })
    }

    const session = await prisma.chatSession.findFirst({
      where: { id, tenantId: request.user.tenantId, userId: request.user.userId },
      select: { id: true, title: true },
    })
    if (!session) return reply.status(404).send({ success: false, error: 'Session not found' })

    // Block double-posting while an answer is still being generated. The
    // frontend disables input on pendingTask too; this is a server-side guard.
    const existingPending = await prisma.aiTask.findFirst({
      where: {
        tenantId: request.user.tenantId,
        status: { in: ['PENDING', 'RUNNING'] },
        payload: { path: ['sessionId'], equals: id },
      },
      select: { id: true },
    })
    if (existingPending) {
      return reply.status(409).send({ success: false, error: 'AI is still answering the previous message' })
    }

    // Backfill title from the first user message if the session was created empty.
    if (!session.title) {
      await prisma.chatSession.update({
        where: { id },
        data: { title: parsed.data.content.slice(0, SESSION_TITLE_MAX) },
      })
    }

    const enq = await enqueueUserMessage(id, request.user.tenantId, parsed.data.content)
    return { success: true, data: enq }
  })

  // ─── Bug reports ───────────────────────────────────────────────────────────

  // POST /support/bugs — user submits a bug. consoleErrors is whatever the
  // ring-buffer captured in the browser; we don't parse it server-side.
  app.post('/bugs', async (request, reply) => {
    const parsed = newBugSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Invalid input' })
    }

    // Guard against tenant cross-talk if shopId was provided
    let shopId: string | null = parsed.data.shopId ?? null
    if (shopId) {
      const shop = await prisma.shop.findFirst({
        where: { id: shopId, tenantId: request.user.tenantId },
        select: { id: true },
      })
      shopId = shop?.id ?? null
    }

    const bug = await prisma.bugReport.create({
      data: {
        tenantId: request.user.tenantId,
        userId: request.user.userId,
        shopId,
        summary: parsed.data.summary,
        description: parsed.data.description ?? null,
        severity: parsed.data.severity ?? 'MEDIUM',
        route: parsed.data.route ?? null,
        consoleErrors: (parsed.data.consoleErrors as any) ?? null,
        userAgent: parsed.data.userAgent ?? null,
        emsCommitSha: parsed.data.emsCommitSha ?? null,
        metadata: (parsed.data.metadata as any) ?? null,
      },
      select: { id: true, status: true, createdAt: true },
    })
    return { success: true, data: bug }
  })

  // GET /support/bugs?mine=1 — let the user see status of their own reports.
  app.get('/bugs', async (request) => {
    const { mine } = request.query as { mine?: string }
    const where: Record<string, unknown> = { tenantId: request.user.tenantId }
    if (mine === '1') where.userId = request.user.userId

    const items = await prisma.bugReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, summary: true, status: true, severity: true,
        route: true, createdAt: true, resolvedAt: true,
        fixCommitSha: true,
      },
    })
    return { success: true, data: items }
  })
}

// Shared by POST /sessions (with initialMessage) and POST /messages: persist a
// USER ChatMessage and queue an AiTask for the worker to pick up.
async function enqueueUserMessage(
  sessionId: string,
  tenantId: string,
  content: string,
): Promise<{ userMessageId: string; aiTaskId: string }> {
  return await prisma.$transaction(async (tx) => {
    const userMsg = await tx.chatMessage.create({
      data: { sessionId, role: 'USER', content },
      select: { id: true },
    })

    // Worker pulls recent context via this payload — keep it small. The
    // worker re-queries chatMessages for accuracy, so payload is mostly a
    // pointer + a copy of the latest user message for trivial lookups.
    const recent = await tx.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: RECENT_MESSAGES_PER_TASK,
      select: { role: true, content: true },
    })

    const task = await tx.aiTask.create({
      data: {
        tenantId,
        taskType: 'CHAT_REPLY',
        priority: 10, // chat outranks BUG_TRIAGE (priority=0)
        payload: {
          sessionId,
          userMessageId: userMsg.id,
          recentMessages: recent.reverse(), // chronological for the model
        } as any,
      },
      select: { id: true },
    })

    await tx.chatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    })

    return { userMessageId: userMsg.id, aiTaskId: task.id }
  })
}
