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

## Run as a macOS LaunchAgent (24/7, restarts on login)

For an always-on setup that survives reboots, register a per-user
LaunchAgent that runs `scripts/run-supervised.sh`. The wrapper script
re-fetches `DATABASE_URL` from the Railway CLI on every launch (proxy
port can rotate), scrubs `ANTHROPIC_API_KEY`, and wraps the worker in
`caffeinate -ism` so the Mac stays awake on AC power while still
allowing the display to sleep.

Install once:

```bash
# 1. Make sure the wrapper is executable (it ships +x but git can lose it).
chmod +x apps/agent-worker/scripts/run-supervised.sh

# 2. Drop the plist into ~/Library/LaunchAgents/ — use absolute paths
#    matching your repo location.
cat > ~/Library/LaunchAgents/com.ems.agent-worker.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>            <string>com.ems.agent-worker</string>
  <key>ProgramArguments</key> <array><string>/PATH/TO/ems/apps/agent-worker/scripts/run-supervised.sh</string></array>
  <key>WorkingDirectory</key> <string>/PATH/TO/ems</string>
  <key>RunAtLoad</key>        <true/>
  <key>KeepAlive</key>        <dict><key>SuccessfulExit</key><false/><key>Crashed</key><true/></dict>
  <key>ThrottleInterval</key> <integer>30</integer>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/Users/YOURUSER/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StandardOutPath</key>  <string>/Users/YOURUSER/agent-worker.log</string>
  <key>StandardErrorPath</key><string>/Users/YOURUSER/agent-worker.log</string>
  <key>ProcessType</key>      <string>Interactive</string>
</dict>
</plist>
PLIST

# 3. Register it (the -w flag persists across reboots).
launchctl load -w ~/Library/LaunchAgents/com.ems.agent-worker.plist
```

Daily ops:

```bash
launchctl list | grep com.ems.agent-worker          # status (PID, last exit)
tail -f ~/agent-worker.log                           # logs
launchctl kickstart -k gui/$(id -u)/com.ems.agent-worker  # restart (e.g. after code change)
launchctl unload ~/Library/LaunchAgents/com.ems.agent-worker.plist     # stop
```

Caveats:

- The wrapper depends on `railway` being authed in the user session
  (`railway whoami` must succeed). If the CLI's session expires, the agent
  will restart-loop and the log will show the auth failure.
- `caffeinate -s` (system-sleep prevention) only works on AC power. On
  battery, idle sleep can still kick in.
- Lid-closed sleep is not overridden by caffeinate. For "always on" with
  the lid closed: AC + external monitor + external keyboard/mouse
  (macOS clamshell mode), or use Amphetamine.
- macOS system updates may reboot the host. The LaunchAgent will come
  back on next login. Disable auto-install in *System Settings → General
  → Software Update* if you want manual control.

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
