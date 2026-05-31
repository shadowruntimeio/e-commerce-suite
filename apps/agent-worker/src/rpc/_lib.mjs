// Shared helpers for all RPC scripts. RPCs are .mjs (no compile step) so the
// agent can invoke them directly with `node`, and so dev / prod don't need
// different paths.
//
// IMPORTANT: TENANT_ID comes from the spawn env, NEVER from agent args. The
// agent has no syntactic way to inject a different tenant — the Bash pattern
// in --allowedTools only matches the script path, not env overrides.

import { prisma } from '/Users/eric/Code/ems/packages/db/dist/index.js'

export function requireTenantId() {
  const id = process.env.TENANT_ID
  if (!id || typeof id !== 'string') {
    emit({ ok: false, error: 'TENANT_ID missing from env (worker bug)' })
    process.exit(2)
  }
  return id
}

export function emit(obj) {
  // Single JSON line out, no extra prints anywhere else. The agent reads
  // stdout via Bash and parses; extra noise (e.g. Prisma warnings) goes to
  // stderr so it doesn't break parsing.
  process.stdout.write(JSON.stringify(obj) + '\n')
}

export function getArg(name, idx) {
  const v = process.argv[idx]
  if (!v || v.trim().length === 0) {
    emit({ ok: false, error: `missing arg ${name}` })
    process.exit(2)
  }
  return v.trim()
}

export async function closePrismaAnd(exitCode = 0) {
  try { await prisma.$disconnect() } catch { /* best effort */ }
  process.exit(exitCode)
}

export { prisma }
