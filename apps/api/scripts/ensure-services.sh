#!/usr/bin/env bash
# Make sure local Redis + Postgres are reachable before `pnpm dev` starts.
# Each step:
# - if the port is already open, no-op
# - else, if docker isn't installed or daemon isn't running, fail with a hint
# - else, reuse (docker start) or create (docker run) a named container, then
#   poll the port until it's ready
#
# After Postgres is up, push the Prisma schema so the API doesn't crash on
# the first query against a fresh DB. `prisma db push` is idempotent — when
# the schema already matches, it exits quickly with no migrations applied.
set -euo pipefail

REDIS_PORT=6379
REDIS_CONTAINER=ems-redis
REDIS_IMAGE=redis:8

PG_PORT=5432
PG_CONTAINER=ems-postgres
PG_IMAGE=postgres:18
PG_USER=postgres
PG_PASSWORD=postgres
PG_DB=ems_dev

HOST=127.0.0.1

port_open() {
  # /dev/tcp is a bash builtin — no nc/redis-cli/pg_isready dependency.
  (echo > /dev/tcp/$HOST/$1) >/dev/null 2>&1
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "[dev] $1: not running and docker is not installed."
    echo "       install Docker Desktop or run $1 another way, then retry."
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "[dev] $1: not running and Docker daemon is not responding."
    echo "       open Docker Desktop, wait for it to be ready, then retry."
    exit 1
  fi
}

ensure_container() {
  # ensure_container <label> <port> <name> <image> [extra docker run args...]
  local label=$1 port=$2 name=$3 image=$4
  shift 4
  if port_open "$port"; then
    echo "[dev] $label: already up on $HOST:$port — skipping"
    return 0
  fi
  ensure_docker "$label"
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    echo "[dev] $label: starting existing container $name"
    docker start "$name" >/dev/null
  else
    echo "[dev] $label: creating container $name ($image)"
    docker run -d --name "$name" -p "$port:$port" --restart unless-stopped "$@" "$image" >/dev/null
  fi
  for _ in $(seq 1 60); do
    if port_open "$port"; then
      echo "[dev] $label: ready on $HOST:$port"
      return 0
    fi
    sleep 0.25
  done
  echo "[dev] $label: container started but port $port never opened — check 'docker logs $name'"
  exit 1
}

ensure_container redis    "$REDIS_PORT" "$REDIS_CONTAINER" "$REDIS_IMAGE"

ensure_container postgres "$PG_PORT"    "$PG_CONTAINER"    "$PG_IMAGE" \
  -e POSTGRES_USER="$PG_USER" \
  -e POSTGRES_PASSWORD="$PG_PASSWORD" \
  -e POSTGRES_DB="$PG_DB"

# Postgres accepting TCP doesn't mean it's ready to serve queries — on first
# boot it still initializes the cluster after the port opens. Wait until a
# pg_isready check inside the container succeeds.
echo "[dev] postgres: waiting for query readiness"
for _ in $(seq 1 60); do
  if docker exec "$PG_CONTAINER" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# Sync Prisma schema so a fresh DB has the right tables when the API boots.
# `db push --skip-generate` is idempotent and quick when nothing changed.
# Source the repo-root .env first so prisma sees DATABASE_URL — the API does
# the same at runtime (see apps/api/src/index.ts).
ROOT_ENV="$(cd "$(dirname "$0")/../../.." && pwd)/.env"
if [ -f "$ROOT_ENV" ]; then
  set -a; source "$ROOT_ENV"; set +a
fi
echo "[dev] postgres: syncing prisma schema"
prisma db push \
  --schema=../../packages/db/prisma/schema.prisma \
  --skip-generate \
  --accept-data-loss >/dev/null
echo "[dev] postgres: schema in sync"
