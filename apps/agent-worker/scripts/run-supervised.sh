#!/usr/bin/env bash
# Foreground supervisor for the agent-worker. Designed to be invoked by a
# launchd LaunchAgent (see ~/Library/LaunchAgents/com.ems.agent-worker.plist)
# but works fine from a terminal too.
#
# What it does:
#   1. Resolves prod DATABASE_URL via the user-local Railway CLI auth.
#   2. Unsets ANTHROPIC_API_KEY so claude.ai subscription OAuth wins.
#   3. Wraps the worker in `caffeinate -ism` so the Mac stays awake (display
#      can still sleep) on AC power.
#   4. execs in the foreground — when the worker exits, this script exits,
#      and launchd's KeepAlive policy decides whether to restart.

set -u

REPO_ROOT="/Users/eric/Code/ems"

# launchd starts us with a minimal PATH; pnpm / node / railway all live in
# homebrew (/opt/homebrew on Apple Silicon, /usr/local on Intel). Add both
# so the script works on either machine.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

cd "$REPO_ROOT" || { echo "[run-supervised] repo not found at $REPO_ROOT"; exit 1; }

# Resolve prod DATABASE_URL fresh on each boot — the Railway proxy port can
# rotate. Fail loud if we can't reach Railway so launchd doesn't restart-loop
# silently against a stale URL.
DB_URL=$(railway variables --service Postgres --kv 2>/dev/null \
  | grep '^DATABASE_PUBLIC_URL=' \
  | sed 's/^DATABASE_PUBLIC_URL=//')

if [ -z "$DB_URL" ]; then
  echo "[run-supervised] $(date '+%F %T')  ERROR: failed to fetch DATABASE_PUBLIC_URL from Railway CLI."
  echo "[run-supervised] Is the railway CLI authed? Run \`railway whoami\` to check."
  exit 1
fi

echo "[run-supervised] $(date '+%F %T')  starting agent-worker (db host: $(echo "$DB_URL" | sed -E 's|.*@([^:/]+).*|\1|'))"

# Final exec: scrub ANTHROPIC_API_KEY, set DATABASE_URL, caffeinate, run worker.
# -i = no idle sleep, -s = no system sleep (AC only), -m = no disk sleep.
# Display sleep stays allowed (no -d).
exec env -u ANTHROPIC_API_KEY DATABASE_URL="$DB_URL" \
  caffeinate -ism pnpm --filter @ems/agent-worker start
