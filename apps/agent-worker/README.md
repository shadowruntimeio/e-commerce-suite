# @ems/agent-worker

Polls `AiTask` in the EMS database, runs each task through a local headless
`claude -p` invocation, and writes the parsed reply back as a `ChatMessage`.

The AI work uses **the host machine's Claude Code subscription** (OAuth), not
an API key. The worker process therefore must run on a machine where
`claude auth status` reports `loggedIn: true` and the subscription is active.

## Run locally against prod

```bash
# Point at Railway's public DB URL (DATABASE_PUBLIC_URL from the postgres service).
export DATABASE_URL="postgresql://postgres:...@host:5432/railway"

# Critical: drop any ANTHROPIC_API_KEY in your shell — it overrides the
# subscription and will fail with "Credit balance is too low". The worker
# also scrubs the env when spawning claude, but unsetting it here avoids
# surprises when running interactively.
unset ANTHROPIC_API_KEY

pnpm --filter @ems/agent-worker dev
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string (Railway public URL when running locally against prod) |
| `CLAUDE_BIN` | `claude` | Path to the Claude Code CLI binary |
| `AGENT_MODEL` | `sonnet` | Model alias passed to `claude --model` |
| `AGENT_POLL_INTERVAL_MS` | `30000` | Fallback poll interval; the hot path is pg LISTEN, this is the safety net for when the listen connection drops |
| `AGENT_TIMEOUT_MS` | `90000` | Hard kill any single `claude -p` after this |
| `AGENT_MAX_ATTEMPTS` | `3` | Retries before a task is marked FAILED |
| `AGENT_SANDBOX_DIR` | `./.agent-sandbox` | cwd for each `claude -p` (kept free of CLAUDE.md / settings) |

## Operational notes

- **Single machine, single worker** is the supported topology. The claim uses
  `FOR UPDATE SKIP LOCKED` so running two workers is safe, but every running
  worker burns subscription quota in parallel.
- **Latency** is currently ~4–10s per chat answer (verified during design),
  dominated by Claude API time. The UI polls — no streaming yet. Task
  pickup itself is sub-millisecond via pg LISTEN on the `ai_task_new`
  channel; the worker installs the trigger that fires it (see
  `notify-bootstrap.ts`) on every boot, idempotently.
- **Failure → user copy**: after `AGENT_MAX_ATTEMPTS` retries, the worker
  inserts an ASSISTANT message saying "AI 暂时无法回复，请稍后再试" so the
  chat doesn't spin forever. The original error is stored in
  `chat_messages.errorReason` for triage.
- **Scope guardrail**: the system prompt restricts answers to EMS topics
  (orders / inventory / returns / shops / products / manual orders / printing
  / permissions). Off-topic, jailbreak attempts, and prompt-leak attempts
  all return a fixed refusal. The worker double-checks `IN_SCOPE` and
  overwrites the answer with the canned refusal when `IN_SCOPE=no`.
- **Bug-triage** is a different code path: the `/bug-triage` skill (in
  `.claude/commands/`) handles those by querying `BugReport` directly. The
  worker only services `CHAT_REPLY` tasks today.
