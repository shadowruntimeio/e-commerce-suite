---
description: Pull a batch of OPEN bug reports from prod and triage / fix them end-to-end.
---

You are operating as the EMS bug triage agent. Goal: walk the queue of user-reported bugs in `BugReport` (status=OPEN), pick the most pressing, reproduce / locate the cause, fix it, and update the report.

## Pulling the queue

Use Railway CLI + Prisma raw queries (the user already has these set up):

```bash
DATABASE_URL=$(railway variables --service Postgres --kv 2>/dev/null \
  | grep '^DATABASE_PUBLIC_URL=' | sed 's/^DATABASE_PUBLIC_URL=//')

export DATABASE_URL
```

Then fetch the top of the queue via a one-off tsx script. Prefer highest severity, oldest first. Example:

```ts
// query.ts (run via: pnpm exec tsx /tmp/query.ts)
import { prisma } from '/Users/eric/Code/ems/packages/db/src/index'
const SEV = ['CRITICAL','HIGH','MEDIUM','LOW']
const rows = await prisma.bugReport.findMany({
  where: { status: 'OPEN' },
  orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
  take: 5,
  select: {
    id: true, summary: true, severity: true, route: true,
    description: true, consoleErrors: true, userAgent: true,
    emsCommitSha: true, metadata: true, createdAt: true,
    user: { select: { email: true, role: true } },
    shop: { select: { name: true, platform: true } },
  },
})
console.log(JSON.stringify(rows, null, 2))
await prisma.$disconnect()
```

## Triage workflow for each bug

1. **Read everything** in the BugReport row. The `consoleErrors` array is the highest-signal field — a real stack trace usually pinpoints the file.
2. **Mark TRIAGING** so other operators don't pick the same one:
   ```sql
   UPDATE bug_reports SET "status"='TRIAGING', "triagedAt"=NOW() WHERE id='<id>';
   ```
3. **Locate the cause**:
   - If consoleErrors point at a specific file/line, start there.
   - If route is given (e.g. `/orders/manual-create`), open the corresponding component and trace from user action down.
   - Check recent git log of the area — many user-reported bugs land within ~1 week of a feature change.
4. **Reproduce locally** when feasible. For UI-only bugs use the `agent-browser` skill against `http://localhost:5173`. For API bugs reproduce with curl against the local API.
5. **Fix**:
   - Follow the project's code conventions (no defensive checks for impossible states, no comments explaining the obvious, no unrelated cleanup — see CLAUDE.md global rules).
   - Make the smallest correct change. Add tests only if there's an existing test suite for that area.
6. **Commit + push** the fix on `main` (or a branch if scope warrants). Commit message must reference the bug:
   ```
   fix(<scope>): <one-line summary>

   Reported as bug_reports.id=<id>; consoleErrors pointed at <file:line>.
   ```
7. **Resolve in DB**:
   ```sql
   UPDATE bug_reports
   SET "status"='FIXED',
       "fixCommitSha"='<sha>',
       "claudeNotes"=$$ <short triage note: cause + fix > $$,
       "resolvedAt"=NOW()
   WHERE id='<id>';
   ```
8. If the bug is **not actionable** (e.g. user confusion, not a real defect, duplicate of an existing report), set status to `WONTFIX` or `DUPLICATE` with a brief `claudeNotes` explanation. Don't leave OPEN.

## What NOT to do

- **Do not** push force, rewrite history, or skip hooks.
- **Do not** edit migrations in place — write a new one if a DB change is needed.
- **Do not** ship "fix attempts" you couldn't reproduce or verify. If you cannot confirm the fix works, write the analysis to `claudeNotes` and leave status at TRIAGING so a human can review.
- **Do not** mass-update reports without reading them. Each row deserves a real look.

## After the batch

Print a summary line per bug you touched: `<id> | <severity> | FIXED/TRIAGING/WONTFIX | <one-line outcome>`. Don't generate a long report — the git log and `claudeNotes` are the durable record.
