// Usage: node recent-errors.mjs [windowMinutes]
// Fetches recent prod API logs and filters to lines that mention any shopId
// owned by the current tenant. Returns up to 30 most recent matches.
//
// Scoping strategy: server logs are global, so we extract the tenant's
// shopIds from the DB first, then grep the log stream for those literals.
// A merchant can never see lines pertaining to another tenant's shops.
// If the tenant has zero shops, we return early — no logs to scope to.
//
// Requires railway CLI installed + authed on the worker host. If unavailable
// we emit a structured "ok: false, unavailable" so the agent can degrade
// gracefully instead of stalling.
import { spawnSync } from 'node:child_process'
import { prisma, requireTenantId, emit, closePrismaAnd } from './_lib.mjs'

const tenantId = requireTenantId()
const windowMinutes = Math.max(1, Math.min(60, Number(process.argv[2] ?? 15)))
const MAX_RETURNED = 30
const MAX_LINES_FETCHED = 1000   // upper bound on what we ask Railway for

try {
  const shops = await prisma.shop.findMany({
    where: { tenantId },
    select: { id: true, name: true, externalShopId: true },
  })
  if (shops.length === 0) {
    emit({ ok: true, available: true, scoped: 'no_shops', matches: [] })
    await closePrismaAnd(0)
  }

  // Try `railway logs --json` (each line a JSON object with message+ts+severity).
  // The CLI is on Eric's host but might not be on every operator's machine;
  // bail out with available=false if it's missing or unauthed.
  const proc = spawnSync(
    'railway',
    [
      'logs',
      '--service', '@ems/api',
      '--since', `${windowMinutes}m`,
      '--lines', String(MAX_LINES_FETCHED),
      '--json',
    ],
    { encoding: 'utf8', timeout: 20_000, env: process.env },
  )
  if (proc.error || proc.status !== 0) {
    emit({
      ok: true,
      available: false,
      reason: proc.error?.message ?? proc.stderr?.slice(0, 200) ?? `exit=${proc.status}`,
    })
    await closePrismaAnd(0)
  }

  // Parse stdout line-by-line; railway --json emits one obj per line.
  const ids = new Set(shops.flatMap((s) => [s.id, s.externalShopId].filter(Boolean)))
  const matches = []
  for (const raw of proc.stdout.split('\n')) {
    if (!raw) continue
    let obj
    try { obj = JSON.parse(raw) } catch { continue }
    const message = typeof obj.message === 'string' ? obj.message : ''
    if (!message) continue
    // shopId match → in scope. Use literal includes() rather than regex to
    // avoid accidental false positives on ID substrings.
    let matchedShopId = null
    for (const id of ids) {
      if (message.includes(id)) { matchedShopId = id; break }
    }
    if (!matchedShopId) continue
    matches.push({
      ts: obj.timestamp ?? obj.ts ?? null,
      severity: obj.severity ?? obj.level ?? null,
      message: message.slice(0, 600),                // clip long lines
      matchedShopId,
    })
  }

  // Newest first; the agent usually cares about the latest 5-10.
  matches.reverse()

  emit({
    ok: true,
    available: true,
    windowMinutes,
    scoped: 'shop_ids',
    shopIdCount: ids.size,
    totalMatches: matches.length,
    matches: matches.slice(0, MAX_RETURNED),
  })
  await closePrismaAnd(0)
} catch (err) {
  emit({ ok: false, error: String(err.message ?? err) })
  await closePrismaAnd(1)
}
