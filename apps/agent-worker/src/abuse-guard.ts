import type { Prisma, PrismaClient } from '@ems/db'

/**
 * Off-topic / abuse tracking for the support chat.
 *
 * State lives on User.settings.chatAbuse — a JSON sub-object so we don't
 * need a schema change. The worker is the source of truth: every
 * inScope=false ASSISTANT message triggers an increment in the same
 * transaction that writes the message. Once the counter crosses
 * OFF_TOPIC_THRESHOLD a ban is applied via the escalating ladder and an
 * AuditLog row is written so the admin (Eric) sees it in 操作日志.
 *
 * The counter resets after CLEAN_RESET_DAYS of no off-topic activity so a
 * user who slipped up months ago isn't permanently one strike away from a
 * ban.
 */

export const OFF_TOPIC_THRESHOLD = 3
export const CLEAN_RESET_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// Ban tiers — escalates every time the threshold is crossed; capped at the
// last entry. banTier on the user record is the index of the LAST applied
// tier; the NEXT ban duration is BAN_LADDER_MS[min(banTier, last)+1 - 1].
export const BAN_LADDER_MS: number[] = [
  1 * 60 * 60 * 1000,         // tier 1: 1 hour
  4 * 60 * 60 * 1000,         // tier 2: 4 hours
  24 * 60 * 60 * 1000,        // tier 3: 1 day
  7 * 24 * 60 * 60 * 1000,    // tier 4: 7 days
  30 * 24 * 60 * 60 * 1000,   // tier 5+: 30 days (cap)
]

export interface ChatAbuseState {
  offTopicCount: number
  lastOffTopicAt: string | null
  bannedUntil: string | null
  banTier: number
}

const EMPTY: ChatAbuseState = {
  offTopicCount: 0,
  lastOffTopicAt: null,
  bannedUntil: null,
  banTier: 0,
}

export function readAbuse(settings: unknown): ChatAbuseState {
  if (!settings || typeof settings !== 'object') return { ...EMPTY }
  const v = (settings as { chatAbuse?: Partial<ChatAbuseState> }).chatAbuse
  if (!v || typeof v !== 'object') return { ...EMPTY }
  return {
    offTopicCount: typeof v.offTopicCount === 'number' ? v.offTopicCount : 0,
    lastOffTopicAt: typeof v.lastOffTopicAt === 'string' ? v.lastOffTopicAt : null,
    bannedUntil: typeof v.bannedUntil === 'string' ? v.bannedUntil : null,
    banTier: typeof v.banTier === 'number' ? v.banTier : 0,
  }
}

function nextBanDuration(currentTier: number): { newTier: number; durationMs: number } {
  const newTier = currentTier + 1
  const idx = Math.min(newTier, BAN_LADDER_MS.length) - 1
  return { newTier, durationMs: BAN_LADDER_MS[idx] }
}

export interface AbuseUpdateResult {
  appliedBan: boolean
  newState: ChatAbuseState
}

/**
 * Update the user's abuse state inside an existing transaction.
 * Caller must pass the transaction client so the update is atomic with the
 * underlying ASSISTANT message write.
 */
export async function recordOffTopic(
  tx: Prisma.TransactionClient | PrismaClient,
  userId: string,
  tenantId: string,
): Promise<AbuseUpdateResult> {
  // Re-read the user inside the transaction — outside reads can race with
  // concurrent worker instances (unlikely today, but cheap insurance).
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { settings: true },
  })

  const cur = readAbuse(user.settings)
  const now = new Date()

  // Decay: a clean run of CLEAN_RESET_MS wipes the in-progress counter so
  // the user isn't one strike away from a ban forever. Ban tier itself is
  // sticky — repeat abusers earn longer bans.
  const lastAt = cur.lastOffTopicAt ? Date.parse(cur.lastOffTopicAt) : 0
  const decayed = lastAt > 0 && now.getTime() - lastAt > CLEAN_RESET_MS

  const nextCount = (decayed ? 0 : cur.offTopicCount) + 1

  let appliedBan = false
  let bannedUntil: string | null = cur.bannedUntil
  let banTier = cur.banTier
  let countAfter = nextCount

  if (nextCount >= OFF_TOPIC_THRESHOLD) {
    const { newTier, durationMs } = nextBanDuration(cur.banTier)
    bannedUntil = new Date(now.getTime() + durationMs).toISOString()
    banTier = newTier
    appliedBan = true
    countAfter = 0 // reset after applying ban; user starts fresh on unban
  }

  const next: ChatAbuseState = {
    offTopicCount: countAfter,
    lastOffTopicAt: now.toISOString(),
    bannedUntil,
    banTier,
  }

  // Merge into existing settings object; don't clobber other keys (e.g.
  // autoConfirmHours).
  const settings = (user.settings && typeof user.settings === 'object'
    ? { ...user.settings }
    : {}) as Record<string, unknown>
  settings.chatAbuse = next

  await tx.user.update({
    where: { id: userId },
    data: { settings: settings as Prisma.InputJsonValue },
  })

  if (appliedBan) {
    // Audit row so the admin sees this in 操作日志. action prefix matches
    // the audit.ts convention ('support.chat.*') even though this writer
    // doesn't import the AuditAction enum from apps/api (separate workspace).
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: userId,
        action: 'support.chat.banned',
        targetType: 'user',
        targetId: userId,
        payload: {
          tier: banTier,
          durationMs: BAN_LADDER_MS[Math.min(banTier, BAN_LADDER_MS.length) - 1],
          bannedUntil,
          threshold: OFF_TOPIC_THRESHOLD,
          reason: 'repeated off-topic chat questions',
        },
      },
    })
  }

  return { appliedBan, newState: next }
}
