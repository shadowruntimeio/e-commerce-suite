import 'dotenv/config'
import path from 'node:path'
import fs from 'node:fs'
import { prisma } from '@ems/db'
import { runClaude, parseTaggedAnswer, prepareImageFile, cleanupTaskDir, type ImageAttachment } from './claude-runner'
import { ensureNotifyTrigger } from './notify-bootstrap'
import { startNotifyListener, type NotifyListener } from './notify-listener'

// Polling is now a safety net (LISTEN handles the hot path). Bumped from 2s
// to 30s — if pg_notify is lost (e.g. listener reconnecting), we still catch
// tasks within 30s.
const POLL_INTERVAL_MS = Number(process.env.AGENT_POLL_INTERVAL_MS ?? 30_000)
const MAX_ATTEMPTS = Number(process.env.AGENT_MAX_ATTEMPTS ?? 3)
const RECENT_CONTEXT_LIMIT = 6

// Load system prompt once at boot. Resolved relative to the compiled file
// (dist/) or the src/ tree under tsx.
const SYSTEM_PROMPT = (() => {
  const candidates = [
    path.join(__dirname, 'prompts/cs-system.md'),
    path.join(__dirname, '..', 'src/prompts/cs-system.md'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8')
  }
  throw new Error('cs-system.md not found in expected locations')
})()

let stopping = false
process.on('SIGINT', () => { stopping = true })
process.on('SIGTERM', () => { stopping = true })

async function main() {
  // First-boot housekeeping: make sure the pg_notify trigger exists. Prod is
  // shaped by `prisma db push` which doesn't run migration SQL, so the
  // trigger has no other source of truth. Safe to run every boot — the SQL
  // is idempotent.
  await ensureNotifyTrigger()

  const listener: NotifyListener = await startNotifyListener('ai_task_new')

  console.log(`[agent-worker] booted; LISTEN on ai_task_new + ${POLL_INTERVAL_MS}ms fallback poll, model=${process.env.AGENT_MODEL ?? 'sonnet'}`)
  while (!stopping) {
    try {
      // Drain the queue under one wakeup — there may be multiple PENDING
      // rows (NOTIFY merges duplicates while the worker is busy).
      while (!stopping && (await processOne())) { /* keep claiming */ }
      if (stopping) break
      // Wait for either a notification or the safety-net poll interval,
      // whichever comes first.
      await Promise.race([sleep(POLL_INTERVAL_MS), listener.wait()])
    } catch (err) {
      console.error('[agent-worker] loop error:', err)
      await sleep(Math.min(POLL_INTERVAL_MS, 5_000))
    }
  }
  console.log('[agent-worker] shutdown requested; exiting')
  await listener.stop()
  await prisma.$disconnect()
}

async function processOne(): Promise<boolean> {
  // Claim atomically: highest-priority PENDING under attempt limit. SKIP
  // LOCKED keeps multiple workers (e.g. dev + prod) from grabbing the same
  // row. Returning aiTask.id forces a second roundtrip but lets us load
  // fresh data after the UPDATE in case the row changed.
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "ai_tasks"
    SET "status" = 'RUNNING',
        "pickedUpAt" = NOW(),
        "attempts" = "attempts" + 1
    WHERE "id" = (
      SELECT "id" FROM "ai_tasks"
      WHERE "status" = 'PENDING'
        AND "attempts" < ${MAX_ATTEMPTS}
      ORDER BY "priority" DESC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id";
  `

  const taskId = claimed[0]?.id
  if (!taskId) return false

  const task = await prisma.aiTask.findUniqueOrThrow({ where: { id: taskId } })
  console.log(`[agent-worker] claimed task ${task.id} type=${task.taskType} attempt=${task.attempts}`)

  try {
    if (task.taskType === 'CHAT_REPLY') {
      await handleChatReply(task as any)
    } else {
      // BUG_TRIAGE is reserved for future use; until the skill drives it the
      // worker should never see one. Mark FAILED so it doesn't loop.
      throw new Error(`Unsupported taskType: ${task.taskType}`)
    }
    return true
  } catch (err) {
    const reason = (err as Error).message
    console.error(`[agent-worker] task ${task.id} failed: ${reason}`)
    // Either give up (terminal FAILED) or release back to PENDING for retry.
    const giveUp = task.attempts >= MAX_ATTEMPTS
    // Strip image bytes on terminal failure so a botched task doesn't leave
    // base64 sitting in the queue. On retry-able failures we keep it so the
    // next attempt has the image.
    const payloadAfterFail = giveUp
      ? ({ ...(task.payload as object), image: null } as any)
      : undefined
    await prisma.aiTask.update({
      where: { id: task.id },
      data: giveUp
        ? { status: 'FAILED', error: reason, completedAt: new Date(), payload: payloadAfterFail }
        : { status: 'PENDING', error: reason },
    })
    if (giveUp && task.taskType === 'CHAT_REPLY') {
      // Surface to the user so the UI doesn't spin forever. The error is
      // generic on purpose — never leak claude internals to merchants.
      const payload = task.payload as { sessionId?: string }
      if (payload?.sessionId) {
        await prisma.chatMessage.create({
          data: {
            sessionId: payload.sessionId,
            role: 'ASSISTANT',
            content: '抱歉，AI 暂时无法回复，请稍后再试。',
            inScope: null,
            suggestBug: null,
            errorReason: reason.slice(0, 200),
            aiTaskId: task.id,
          },
        })
      }
    }
    return true
  }
}

async function handleChatReply(task: {
  id: string
  payload: {
    sessionId: string
    userMessageId: string
    recentMessages?: { role: string; content: string }[]
    image?: ImageAttachment | null
  }
}) {
  const t0 = Date.now()

  // Pull authoritative recent messages (don't trust payload alone since the
  // session may have other messages by now). Build a transcript the model
  // can read at a glance. The last user message is what we'll actually
  // send as the "user" message to claude.
  const recent = await prisma.chatMessage.findMany({
    where: { sessionId: task.payload.sessionId },
    orderBy: { createdAt: 'desc' },
    take: RECENT_CONTEXT_LIMIT,
    select: { role: true, content: true },
  })
  recent.reverse()

  // Find the user message we're answering. The most recent USER row is the
  // one this task corresponds to (we block double-posts at API level).
  const lastUser = [...recent].reverse().find((m) => m.role === 'USER')
  if (!lastUser) throw new Error('no user message found for session')

  // If there's prior turn context, prepend it as a transcript above the
  // current user question. Keeps the model coherent across multi-turn chats
  // without making us run a separate "conversation" mode through the CLI.
  let userInput = lastUser.content
  const priorTurns = recent.slice(0, recent.length - 1)
  if (priorTurns.length > 0) {
    const transcript = priorTurns
      .map((m) => `${m.role === 'USER' ? '用户' : '助手'}：${m.content}`)
      .join('\n')
    userInput = `【对话历史】\n${transcript}\n\n【当前问题】\n${lastUser.content}`
  }

  // Image handling. We decode here and clean up unconditionally in finally —
  // the per-task dir contains only the one image, so leaking it would be
  // small but easy to avoid.
  let preparedTaskDir: string | undefined
  let imagePath: string | undefined
  if (task.payload.image) {
    const prepared = prepareImageFile(task.payload.image, task.id)
    preparedTaskDir = prepared.taskDir
    imagePath = prepared.filePath
    userInput = `${userInput}\n\n[image: ${imagePath}]`
  }

  try {
    const run = await runClaude(SYSTEM_PROMPT, userInput, imagePath ? { imagePath } : {})

    if (run.envelope.is_error || !run.envelope.result) {
      const detail = run.envelope.result ?? run.stderr ?? `exit=${run.exitCode}`
      throw new Error(`claude run failed: ${String(detail).slice(0, 200)}`)
    }

    const parsed = parseTaggedAnswer(run.envelope.result)
    if (!parsed) {
      throw new Error(`could not parse tagged answer: ${run.envelope.result.slice(0, 200)}`)
    }

    const usage = run.envelope.usage ?? {}
    const tokensInput = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
    const tokensOutput = usage.output_tokens ?? 0

    await prisma.$transaction(async (tx) => {
      await tx.chatMessage.create({
        data: {
          sessionId: task.payload.sessionId,
          role: 'ASSISTANT',
          content: parsed.answer,
          inScope: parsed.inScope,
          suggestBug: parsed.suggestBug,
          aiTaskId: task.id,
          tokensInput,
          tokensOutput,
          latencyMs: Date.now() - t0,
        },
      })
      // Strip the image bytes from the payload so the row doesn't keep a
      // copy of the base64 around indefinitely. The metadata on
      // chat_messages is what the UI / quota care about — payload is just
      // queue plumbing.
      await tx.aiTask.update({
        where: { id: task.id },
        data: {
          status: 'DONE',
          result: parsed as unknown as object,
          payload: { ...(task.payload as object), image: null } as any,
          completedAt: new Date(),
        },
      })
      await tx.chatSession.update({
        where: { id: task.payload.sessionId },
        data: { updatedAt: new Date() },
      })
    })

    console.log(`[agent-worker] task ${task.id} done in ${Date.now() - t0}ms (in_scope=${parsed.inScope} bug=${parsed.suggestBug}${imagePath ? ' image=yes' : ''})`)
  } finally {
    if (preparedTaskDir) cleanupTaskDir(preparedTaskDir)
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

main().catch((err) => {
  console.error('[agent-worker] fatal:', err)
  process.exit(1)
})
