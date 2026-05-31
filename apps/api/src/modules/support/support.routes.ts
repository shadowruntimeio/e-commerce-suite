import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import multipart from '@fastify/multipart'
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

// Image upload constraints. 2MB / image, 20 images per user per 24h rolling
// window. Bytes are never persisted to the DB long-term — they live inside
// AiTask.payload only until the worker consumes them.
const IMAGE_MAX_BYTES = 2 * 1024 * 1024
const IMAGE_DAILY_QUOTA = 20
const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

// Bug-report image constraints. Tighter than chat (1MB) since these are
// persisted, and capped at 2 per report (matches the "screenshot of the
// issue + one of the console" common case).
const BUG_IMAGE_MAX_BYTES = 1 * 1024 * 1024
const BUG_IMAGES_PER_REPORT = 2

// A task that's still PENDING/RUNNING after this much time is almost
// certainly stuck — the worker is either offline or its host crashed
// mid-task. Worker max-attempt budget is 3 × 90s = 4.5min, so 5min gives
// a healthy margin before we declare the task dead. When that happens we
// mark it FAILED and write a user-facing error message so the chat UI
// stops showing "AI 正在思考" forever.
const STALE_TASK_MS = 5 * 60_000

// Off-topic abuse — the worker actually applies bans (in the same
// transaction that writes the inScope=false ASSISTANT message). The API
// here just READS the state to enforce on POST and to expose to the UI.
// Keep these constants in lockstep with apps/agent-worker/src/abuse-guard.ts.
const OFF_TOPIC_THRESHOLD = 3

interface ChatAbuseState {
  offTopicCount: number
  lastOffTopicAt: string | null
  bannedUntil: string | null
  banTier: number
}

function readAbuseFromSettings(settings: unknown): ChatAbuseState {
  const empty: ChatAbuseState = { offTopicCount: 0, lastOffTopicAt: null, bannedUntil: null, banTier: 0 }
  if (!settings || typeof settings !== 'object') return empty
  const v = (settings as { chatAbuse?: Partial<ChatAbuseState> }).chatAbuse
  if (!v || typeof v !== 'object') return empty
  return {
    offTopicCount: typeof v.offTopicCount === 'number' ? v.offTopicCount : 0,
    lastOffTopicAt: typeof v.lastOffTopicAt === 'string' ? v.lastOffTopicAt : null,
    bannedUntil: typeof v.bannedUntil === 'string' ? v.bannedUntil : null,
    banTier: typeof v.banTier === 'number' ? v.banTier : 0,
  }
}

function summarizeAbuse(state: ChatAbuseState) {
  const banActive = !!state.bannedUntil && Date.parse(state.bannedUntil) > Date.now()
  return {
    offTopicCount: state.offTopicCount,
    threshold: OFF_TOPIC_THRESHOLD,
    banTier: state.banTier,
    bannedUntil: banActive ? state.bannedUntil : null,
  }
}

const newSessionSchema = z.object({
  initialMessage: z.string().min(1).max(2000).optional(),
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
  // Per-route multipart so the image-upload size cap is scoped to this
  // module and doesn't bleed into other routes (inventory has its own 5MB
  // limit for xlsx). Limits here are the LOOSEST any support endpoint
  // needs (chat = 1 image × 2MB; bug = 2 images × 1MB); each route then
  // enforces its own tighter constraints in handler code.
  await app.register(multipart, {
    limits: { fileSize: IMAGE_MAX_BYTES, files: BUG_IMAGES_PER_REPORT, fields: 8 },
  })
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

    // Reap any task that's been PENDING/RUNNING past the stale window for
    // this session before we fetch messages, so the response reflects the
    // post-reap state. This is what stops the "AI 正在思考" spinner from
    // showing forever after a worker outage (user reloads, sees an error
    // bubble and a clean composer instead of a phantom in-flight task).
    await reapStaleTasksForSession(id, request.user.tenantId)

    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, role: true, content: true,
        inScope: true, suggestBug: true,
        errorReason: true, latencyMs: true,
        aiTaskId: true, createdAt: true,
        attachmentMimeType: true, attachmentSizeBytes: true,
      },
    })

    // Surface pending task state so the UI can show a "thinking" indicator
    // without an extra round-trip. We only ever have at most one PENDING /
    // RUNNING task per session at a time (frontend gates input on it).
    // The createdAt floor is belt-and-suspenders: the reaper above should
    // already have moved stale rows to FAILED, but this also covers the
    // edge case where a row is borderline-stale and the reaper hasn't run
    // yet.
    const pendingTask = await prisma.aiTask.findFirst({
      where: {
        tenantId: request.user.tenantId,
        status: { in: ['PENDING', 'RUNNING'] },
        // payload->>'sessionId' lookup via JSON path
        payload: { path: ['sessionId'], equals: id },
        createdAt: { gte: new Date(Date.now() - STALE_TASK_MS) },
      },
      select: { id: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })

    // Surface abuse state too — the UI uses this for the warning bar +
    // ban dialog without needing a second roundtrip.
    const u = await prisma.user.findUniqueOrThrow({
      where: { id: request.user.userId },
      select: { settings: true },
    })
    const abuse = summarizeAbuse(readAbuseFromSettings(u.settings))

    return { success: true, data: { session, messages, pendingTask, abuse } }
  })

  // GET /support/chat/abuse-status — small standalone endpoint the UI polls
  // on tab open / before the user starts typing to render the warning bar.
  app.get('/chat/abuse-status', async (request) => {
    const u = await prisma.user.findUniqueOrThrow({
      where: { id: request.user.userId },
      select: { settings: true },
    })
    return { success: true, data: summarizeAbuse(readAbuseFromSettings(u.settings)) }
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
  // Accepts multipart/form-data (content + optional image) OR application/json
  // (content only) for backwards compat with text-only callers.
  app.post('/chat/sessions/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string }

    // Branch on content-type. Multipart is the new path; JSON still works
    // for clients that don't need to upload an image.
    let content: string | undefined
    let image: { mimeType: string; bytes: Buffer } | null = null
    if (request.isMultipart()) {
      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            if (part.fieldname !== 'image') continue
            if (!ALLOWED_IMAGE_MIMES.has(part.mimetype)) {
              return reply.status(415).send({ success: false, error: 'Unsupported image type' })
            }
            const bytes = await part.toBuffer()
            if (bytes.length > IMAGE_MAX_BYTES) {
              return reply.status(413).send({ success: false, error: 'Image too large (max 2MB)' })
            }
            image = { mimeType: part.mimetype, bytes }
          } else if (part.fieldname === 'content') {
            content = String(part.value ?? '').trim()
          }
        }
      } catch (err) {
        // @fastify/multipart throws if the per-route fileSize limit is breached
        // mid-stream — treat as 413 rather than a generic 500.
        const msg = (err as { code?: string; message?: string })?.code === 'FST_REQ_FILE_TOO_LARGE'
          ? 'Image too large (max 2MB)'
          : `Upload failed: ${(err as Error).message}`
        return reply.status(413).send({ success: false, error: msg })
      }
    } else {
      const body = request.body as { content?: string }
      content = body?.content?.trim()
    }

    if (!content || content.length === 0 || content.length > 2000) {
      return reply.status(400).send({ success: false, error: 'Invalid content' })
    }

    const session = await prisma.chatSession.findFirst({
      where: { id, tenantId: request.user.tenantId, userId: request.user.userId },
      select: { id: true, title: true },
    })
    if (!session) return reply.status(404).send({ success: false, error: 'Session not found' })

    // Ban gate. Worker writes the ban state; we just enforce here. We
    // re-read the user row each time so a still-running long-tail task
    // that JUST tripped the threshold can lock out the next send.
    const userRow = await prisma.user.findUniqueOrThrow({
      where: { id: request.user.userId },
      select: { settings: true },
    })
    const abuse = readAbuseFromSettings(userRow.settings)
    if (abuse.bannedUntil && Date.parse(abuse.bannedUntil) > Date.now()) {
      return reply.status(403).send({
        success: false,
        error: 'CHAT_BANNED',
        data: {
          bannedUntil: abuse.bannedUntil,
          tier: abuse.banTier,
          reason: 'repeated_off_topic',
        },
      })
    }

    // Quota check happens BEFORE we acknowledge the message so the user can
    // re-craft without an image if they're capped. Rolling 24h window — we
    // avoid TZ ambiguity (merchants are in multiple timezones) and the
    // boundary is the moment they hit "send", which matches user intuition.
    if (image) {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const usedToday = await prisma.chatMessage.count({
        where: {
          session: { userId: request.user.userId, tenantId: request.user.tenantId },
          attachmentMimeType: { not: null },
          createdAt: { gte: dayAgo },
        },
      })
      if (usedToday >= IMAGE_DAILY_QUOTA) {
        return reply.status(429).send({
          success: false,
          error: 'IMAGE_QUOTA_EXCEEDED',
          data: { limit: IMAGE_DAILY_QUOTA, used: usedToday },
        })
      }
    }

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
        data: { title: content.slice(0, SESSION_TITLE_MAX) },
      })
    }

    const enq = await enqueueUserMessage(id, request.user.tenantId, content, image)
    return { success: true, data: enq }
  })

  // GET /support/chat/quota/image — daily image upload counter, for the UI
  // to enable/disable the upload button and surface the remaining count.
  app.get('/chat/quota/image', async (request) => {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const used = await prisma.chatMessage.count({
      where: {
        session: { userId: request.user.userId, tenantId: request.user.tenantId },
        attachmentMimeType: { not: null },
        createdAt: { gte: dayAgo },
      },
    })
    return { success: true, data: { used, limit: IMAGE_DAILY_QUOTA, maxBytes: IMAGE_MAX_BYTES } }
  })

  // ─── Bug reports ───────────────────────────────────────────────────────────

  // POST /support/bugs — multipart. Up to 2 images (≤1MB each) + the usual
  // bug fields. JSON-only requests still work for backwards compat (no
  // images attached).
  app.post('/bugs', async (request, reply) => {
    let parsedFields: Record<string, unknown> = {}
    const images: { mimeType: string; bytes: Buffer }[] = []

    if (request.isMultipart()) {
      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            if (part.fieldname !== 'image') continue
            if (images.length >= BUG_IMAGES_PER_REPORT) {
              return reply.status(400).send({
                success: false,
                error: `Too many images (max ${BUG_IMAGES_PER_REPORT})`,
              })
            }
            if (!ALLOWED_IMAGE_MIMES.has(part.mimetype)) {
              return reply.status(415).send({ success: false, error: 'Unsupported image type' })
            }
            const bytes = await part.toBuffer()
            if (bytes.length > BUG_IMAGE_MAX_BYTES) {
              return reply.status(413).send({ success: false, error: 'Image too large (max 1MB)' })
            }
            images.push({ mimeType: part.mimetype, bytes })
          } else {
            // Multipart non-file fields come in as strings; consoleErrors +
            // metadata are JSON-encoded by the client.
            const raw = String(part.value ?? '')
            if (part.fieldname === 'consoleErrors' || part.fieldname === 'metadata') {
              try { parsedFields[part.fieldname] = JSON.parse(raw) } catch { /* ignore */ }
            } else {
              parsedFields[part.fieldname] = raw
            }
          }
        }
      } catch (err) {
        const code = (err as { code?: string })?.code
        if (code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.status(413).send({ success: false, error: 'Image too large (max 1MB)' })
        }
        if (code === 'FST_FILES_LIMIT') {
          return reply.status(400).send({ success: false, error: `Too many images (max ${BUG_IMAGES_PER_REPORT})` })
        }
        return reply.status(400).send({ success: false, error: `Upload failed: ${(err as Error).message}` })
      }
    } else {
      parsedFields = (request.body ?? {}) as Record<string, unknown>
    }

    const parsed = newBugSchema.safeParse(parsedFields)
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

    // Insert bug + images in one transaction so a partial write can't leave
    // an orphaned bug with no attachments.
    const bug = await prisma.$transaction(async (tx) => {
      const created = await tx.bugReport.create({
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
      if (images.length > 0) {
        await tx.bugReportImage.createMany({
          data: images.map((img) => ({
            bugReportId: created.id,
            mimeType: img.mimeType,
            sizeBytes: img.bytes.length,
            // Buffer.from gives us a Buffer<ArrayBuffer> the Prisma generated
            // type wants (multipart returns Buffer<ArrayBufferLike> from a
            // pooled allocator, which doesn't unify with the strict type).
            data: Buffer.from(img.bytes),
          })),
        })
      }
      return { ...created, imageCount: images.length }
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
        _count: { select: { images: true } },
      },
    })
    return {
      success: true,
      data: items.map((i) => {
        const { _count, ...rest } = i
        return { ...rest, imageCount: _count.images }
      }),
    }
  })

  // GET /support/bugs/:id/images/:idx — serve image bytes. Tenant-scoped:
  // any user in the same tenant can view the images. (Admin staff want to
  // see them when triaging via the audit log / future admin UI.)
  app.get('/bugs/:id/images/:idx', async (request, reply) => {
    const { id, idx } = request.params as { id: string; idx: string }
    const i = Number(idx)
    if (!Number.isInteger(i) || i < 0 || i >= BUG_IMAGES_PER_REPORT) {
      return reply.status(400).send({ success: false, error: 'Invalid image index' })
    }
    // Confirm the bug belongs to this tenant and load the i-th image by
    // creation order. Cheaper than a self-join — just ORDER + OFFSET.
    const bug = await prisma.bugReport.findFirst({
      where: { id, tenantId: request.user.tenantId },
      select: { id: true },
    })
    if (!bug) return reply.status(404).send({ success: false, error: 'Bug not found' })

    const img = await prisma.bugReportImage.findFirst({
      where: { bugReportId: id },
      orderBy: { createdAt: 'asc' },
      skip: i,
      select: { mimeType: true, data: true },
    })
    if (!img) return reply.status(404).send({ success: false, error: 'Image not found' })

    reply.header('Content-Type', img.mimeType)
    reply.header('Cache-Control', 'private, max-age=86400, immutable')
    return reply.send(img.data)
  })
}

// Shared by POST /sessions (with initialMessage) and POST /messages: persist a
// USER ChatMessage and queue an AiTask for the worker to pick up.
//
// When an image is attached, the bytes ride along in AiTask.payload.image as
// base64. The worker writes them to a disposable sandbox dir, references the
// path in the prompt, and on DONE clears payload.image so the row doesn't
// keep MB of base64 around forever. The ChatMessage only stores metadata
// (mime + size) — enough for the daily-quota count and the UI hint that the
// message "had an image".
async function enqueueUserMessage(
  sessionId: string,
  tenantId: string,
  content: string,
  image: { mimeType: string; bytes: Buffer } | null = null,
): Promise<{ userMessageId: string; aiTaskId: string }> {
  return await prisma.$transaction(async (tx) => {
    const userMsg = await tx.chatMessage.create({
      data: {
        sessionId,
        role: 'USER',
        content,
        attachmentMimeType: image?.mimeType ?? null,
        attachmentSizeBytes: image?.bytes.length ?? null,
      },
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
          image: image
            ? { mimeType: image.mimeType, base64: image.bytes.toString('base64') }
            : null,
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

/**
 * Mark any task on `sessionId` that's been PENDING/RUNNING past STALE_TASK_MS
 * as FAILED, and post a user-visible assistant error row tied to it. Called
 * from GET /chat/sessions/:id so the UI naturally self-heals when the user
 * refreshes after a worker outage.
 *
 * Concurrency-safe: the conditional UPDATE only flips a row if it's still
 * PENDING/RUNNING; ChatMessage.aiTaskId is UNIQUE, so a race with a
 * just-completed worker write throws P2002 and we swallow it.
 */
async function reapStaleTasksForSession(sessionId: string, tenantId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_TASK_MS)
  const stale = await prisma.aiTask.findMany({
    where: {
      tenantId,
      status: { in: ['PENDING', 'RUNNING'] },
      payload: { path: ['sessionId'], equals: sessionId },
      createdAt: { lt: cutoff },
    },
    select: { id: true },
  })
  if (stale.length === 0) return

  for (const t of stale) {
    try {
      await prisma.$transaction(async (tx) => {
        // Conditional flip — bail out cleanly if the worker beat us to it.
        const flipped = await tx.aiTask.updateMany({
          where: { id: t.id, status: { in: ['PENDING', 'RUNNING'] } },
          data: {
            status: 'FAILED',
            error: 'reaped: stale (worker offline or stuck)',
            completedAt: new Date(),
          },
        })
        if (flipped.count === 0) return

        // The aiTaskId unique constraint means only one ASSISTANT row can
        // ever be tied to a given task. If a parallel worker insert wins
        // the race, this create throws P2002 — we treat that as "answered
        // already" and stop here.
        try {
          await tx.chatMessage.create({
            data: {
              sessionId,
              role: 'ASSISTANT',
              content: '抱歉，AI 暂时无法回复，请稍后再试。',
              errorReason: 'task reaped (stale)',
              aiTaskId: t.id,
            },
          })
        } catch (err) {
          if ((err as { code?: string }).code !== 'P2002') throw err
        }
      })
    } catch (err) {
      // Don't let one botched reap break the GET response — log and move on.
      console.warn(`[support] reapStaleTasksForSession ${t.id} failed:`, (err as Error).message)
    }
  }
}
