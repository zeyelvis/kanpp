#!/bin/bash
# Local scheduler for the Ingest job (launchd, every 4h). Same work as .github/workflows/ingest.yml,
# but authenticated with this Mac's wrangler login, so no API token has to be stored anywhere.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# Skip if a previous run (or the bulk backfill) is still going.
LOCK=/tmp/kanpp-ingest.lock
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date -u +%FT%TZ) previous run still active, skipping"
  exit 0
fi
trap 'rmdir "$LOCK"' EXIT
if pgrep -f "ops/bulk-backfill.sh" >/dev/null; then
  echo "$(date -u +%FT%TZ) bulk backfill running, skipping"
  exit 0
fi
# A checked-out mirror (scripts/mirror.ts) needs remote D1 untouched until it is pushed back.
if [ -e data/mirror/checkout.lock ]; then
  echo "$(date -u +%FT%TZ) mirror checked out, skipping"
  exit 0
fi

echo "=== $(date -u +%FT%TZ) ingest start"
caffeinate -i npx tsx scripts/ingest.ts --db=remote --hours=5 --backfill=5 --refresh-series=300 --limit=2000 --concurrency=8
echo "=== $(date -u +%FT%TZ) ingest end (exit $?)"
# Chinese animation / variety that TMDB lacks: titles from the sources' own metadata (this
# script already holds the ingest lock, hence --no-lock).
caffeinate -i npx tsx scripts/source-titles.ts --db=remote --no-lock
echo "=== $(date -u +%FT%TZ) source titles end (exit $?)"
# Update reminders for followed titles that just got new episodes (scripts/push-updates.ts).
caffeinate -i npx tsx scripts/push-updates.ts
echo "=== $(date -u +%FT%TZ) push reminders end (exit $?)"
