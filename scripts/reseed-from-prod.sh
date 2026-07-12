#!/usr/bin/env bash
# Cutover re-seed: pull a fresh, consistent snapshot of the live production
# SQLite DB off Railway and load it into the target Postgres (truncating first).
#
# Run this immediately BEFORE merging the Postgres code to main, so the Postgres
# data is as current as possible when the new deploy switches over.
#
# Prereqs:
#   - railway CLI logged in + linked to lovely-nurturing / production / 10s-court-monitor
#   - DATABASE_URL in .env points at the target Postgres (public proxy URL for
#     running this from your laptop)
#
# Usage:  ./scripts/reseed-from-prod.sh
set -euo pipefail

cd "$(dirname "$0")/.."

TMP="$(mktemp -d)"
SNAP="$TMP/prod-snapshot.db"
REMOTE_DB="/app/data/tennis.db"

echo "==> [1/3] Taking a consistent .backup of prod SQLite (folds in the WAL)…"
railway ssh "sqlite3 $REMOTE_DB \".backup '/tmp/reseed.db'\" && sqlite3 /tmp/reseed.db 'PRAGMA integrity_check;'"

echo "==> [2/3] Downloading snapshot…"
railway ssh "base64 /tmp/reseed.db" \
  | python3 -c "import base64,sys; open('$SNAP','wb').write(base64.b64decode(sys.stdin.read()))"
railway ssh "rm -f /tmp/reseed.db" >/dev/null
ls -la "$SNAP"

echo "==> [3/3] Truncating + re-seeding Postgres from the fresh snapshot…"
npm run db:migrate-data -- --truncate "$SNAP"

rm -rf "$TMP"
echo "==> Done. Postgres now mirrors production as of this run."
echo "    Next: merge the Postgres branch to main so Railway deploys the new code."
