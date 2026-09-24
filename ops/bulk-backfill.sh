#!/bin/bash
# One-off bulk load of the full source catalogs into production D1.
# Each round: fetch PAGES pages from every source in parallel (rows land as `pending`),
# then resolve pending rows in chunks until none are left. Cursors live in D1
# (sync_state backfill:*), so the script can be stopped and restarted at any time.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
PAGES=${PAGES:-400}
ROUNDS=${ROUNDS:-15}
SOURCES="modu ikun zuida feifan wujin guangsu"
mkdir -p data/bulk

for round in $(seq 1 "$ROUNDS"); do
  echo "=== round $round/$ROUNDS: fetch $PAGES pages per source ($(date -u +%H:%M:%S))"
  for s in $SOURCES; do
    npx tsx scripts/ingest.ts --db=remote --sources="$s" --backfill="$PAGES" --fetch-only >> "data/bulk/fetch-$s.log" 2>&1 &
  done
  wait
  grep -h "backfill " data/bulk/fetch-*.log | tail -6

  while true; do
    line=$(npx tsx scripts/ingest.ts --db=remote --resolve-only --limit=4000 --concurrency=24 2>&1 | tee -a data/bulk/resolve.log | grep -E "resolve done|catalog:" | tr '\n' ' ')
    echo "  $(date -u +%H:%M:%S) $line"
    echo "$line" | grep -q '"processed":0' && break
    echo "$line" | grep -q 'resolve done' || { echo "  resolve run failed, see data/bulk/resolve.log"; sleep 60; }
  done
done
echo "=== bulk backfill finished $(date -u)"
