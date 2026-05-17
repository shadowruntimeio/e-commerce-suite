#!/usr/bin/env bash
# Make sure Redis is reachable on localhost:6379 before `pnpm dev` starts.
# - If something is already listening on 6379, exit (assume it's a usable Redis).
# - Otherwise try to (re)start a Docker container named ems-redis.
# - Print an actionable hint if Docker itself isn't running.
set -euo pipefail

PORT=6379
HOST=127.0.0.1
CONTAINER=ems-redis
IMAGE=redis:8

port_open() {
  # /dev/tcp is a bash builtin — no nc/redis-cli dependency.
  (echo > /dev/tcp/$HOST/$PORT) >/dev/null 2>&1
}

if port_open; then
  echo "[dev] redis: already up on $HOST:$PORT — skipping"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[dev] redis: not running and docker is not installed."
  echo "       install Docker Desktop or run redis another way, then retry."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "[dev] redis: not running and Docker daemon is not responding."
  echo "       open Docker Desktop, wait for it to be ready, then retry."
  exit 1
fi

# Reuse existing container if present, otherwise create one.
if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "[dev] redis: starting existing container $CONTAINER"
  docker start "$CONTAINER" >/dev/null
else
  echo "[dev] redis: creating container $CONTAINER ($IMAGE)"
  docker run -d --name "$CONTAINER" -p $PORT:$PORT --restart unless-stopped "$IMAGE" >/dev/null
fi

# Wait for the port to actually accept connections (typically <1s).
for _ in $(seq 1 30); do
  if port_open; then
    echo "[dev] redis: ready on $HOST:$PORT"
    exit 0
  fi
  sleep 0.2
done

echo "[dev] redis: container started but port $PORT never opened — check 'docker logs $CONTAINER'"
exit 1
