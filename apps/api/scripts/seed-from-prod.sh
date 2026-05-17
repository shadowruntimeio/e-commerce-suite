#!/usr/bin/env bash
# Mirror config-only tables from Railway prod Postgres into the local dev
# Postgres so you can boot the app with real tenants/users/shops without
# manually re-creating them. Transactional/derived data (orders, snapshots,
# audit logs, etc.) is intentionally NOT synced — let the TikTok sync
# workers re-populate it after seeding.
#
# Run from anywhere: `pnpm --filter @ems/api db:seed-from-prod`
# Prerequisites:
#   - `railway login` and project linked to vibrant-quietude
#   - local `ems-postgres` container running (start via `pnpm dev` once)
set -euo pipefail

# Tables to copy. Truncating these with CASCADE also wipes everything that
# references them (orders, etc.) which is what we want.
CONFIG_TABLES=(
  tenants
  users
  shops
  warehouses
  product_categories
  system_products
  system_skus
  warehouse_skus
  order_rules
  suppliers
)

LOCAL_CONTAINER=ems-postgres
LOCAL_PG_USER=postgres
LOCAL_PG_DB=ems_dev

# Resolve repo root to load the same .env the API uses.
ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
ROOT_ENV="$ROOT_DIR/.env"
if [ ! -f "$ROOT_ENV" ]; then
  echo "[seed] $ROOT_ENV not found — can't read DATABASE_URL." && exit 1
fi
set -a; source "$ROOT_ENV"; set +a

# Refuse to seed anything other than a localhost target. Belt-and-suspenders
# since this script TRUNCATEs before restoring.
case "${DATABASE_URL:-}" in
  *@localhost:*|*@127.0.0.1:*) ;;
  *)
    echo "[seed] refusing to seed: local DATABASE_URL doesn't point to localhost."
    echo "       got: ${DATABASE_URL:-<unset>}"
    exit 1
    ;;
esac

if ! command -v railway >/dev/null 2>&1; then
  echo "[seed] Railway CLI not found. Install: brew install railway" && exit 1
fi
if ! railway whoami >/dev/null 2>&1; then
  echo "[seed] not logged into Railway. Run: railway login" && exit 1
fi

PROD_URL=$(railway variables --service Postgres --kv 2>/dev/null \
  | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)
if [ -z "$PROD_URL" ]; then
  echo "[seed] couldn't read DATABASE_PUBLIC_URL from Railway Postgres service."
  echo "       make sure 'railway status' shows project vibrant-quietude."
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$LOCAL_CONTAINER"; then
  echo "[seed] local container '$LOCAL_CONTAINER' isn't running."
  echo "       start it via 'pnpm dev' once (predev hook will create it), then re-run."
  exit 1
fi

# Warn loudly if encryption keys differ — shop tokens won't decrypt locally.
LOCAL_KEY="${ENCRYPTION_KEY:-}"
PROD_KEY=$(railway variables --service "@ems/api" --kv 2>/dev/null \
  | grep '^ENCRYPTION_KEY=' | cut -d= -f2- || true)
if [ -n "$LOCAL_KEY" ] && [ -n "$PROD_KEY" ] && [ "$LOCAL_KEY" != "$PROD_KEY" ]; then
  echo
  echo "[seed] ⚠ local ENCRYPTION_KEY ≠ prod ENCRYPTION_KEY"
  echo "       shop credentials are AES-encrypted with the prod key; they"
  echo "       won't decrypt locally and TikTok sync workers will throw."
  echo "       to use the seeded creds: copy ENCRYPTION_KEY from Railway"
  echo "       (Service @ems/api → Variables) into $ROOT_ENV, then restart"
  echo "       'pnpm dev'."
  echo
  printf "       continue anyway? [y/N] "
  read -r confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || exit 0
fi

# Build --table flags. CONFIG_TABLES values are hard-coded above so no
# shell-injection concern from interpolating them.
TBL_FLAGS=""
for t in "${CONFIG_TABLES[@]}"; do
  TBL_FLAGS+=" --table=public.$t"
done

echo "[seed] truncating local config tables (CASCADE wipes transactional too)…"
TRUNCATE_LIST=$(IFS=, ; echo "${CONFIG_TABLES[*]}")
docker exec -i "$LOCAL_CONTAINER" \
  psql -U "$LOCAL_PG_USER" -d "$LOCAL_PG_DB" -v ON_ERROR_STOP=on \
  -c "TRUNCATE TABLE $TRUNCATE_LIST RESTART IDENTITY CASCADE;" >/dev/null

echo "[seed] dumping from prod and restoring into local…"
# Run pg_dump and psql inside the local postgres container — it already has
# both binaries and outbound network access for the prod proxy URL.
docker exec -i "$LOCAL_CONTAINER" bash -c "
  set -euo pipefail
  pg_dump '$PROD_URL' --data-only --no-owner --no-privileges --no-comments$TBL_FLAGS \
    | psql -U '$LOCAL_PG_USER' -d '$LOCAL_PG_DB' -v ON_ERROR_STOP=on --quiet
"

# Quick row-count summary so you can spot empty tables at a glance.
echo "[seed] row counts:"
COUNT_SQL=""
for t in "${CONFIG_TABLES[@]}"; do
  COUNT_SQL+="SELECT '$t' AS tbl, COUNT(*) FROM $t UNION ALL "
done
COUNT_SQL="${COUNT_SQL% UNION ALL } ORDER BY tbl;"
docker exec -i "$LOCAL_CONTAINER" \
  psql -U "$LOCAL_PG_USER" -d "$LOCAL_PG_DB" -t -A -F $'\t' -c "$COUNT_SQL" \
  | awk -F'\t' '{ printf "  %-25s %s\n", $1, $2 }'

echo
echo "[seed] done. Next: restart 'pnpm dev' (or just keep it running) and"
echo "       let the TikTok sync workers backfill orders."
