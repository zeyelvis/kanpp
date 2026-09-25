#!/bin/bash
# Bulk catalog load on a local mirror of production D1 (see scripts/mirror.ts):
#   npx tsx scripts/mirror.ts pull  ->  ops/mirror-bulk.sh  ->  npx tsx scripts/mirror.ts push
# Fetches each source's full catalog in WORKERS page ranges at once, and resolves pending rows
# alongside (one resolver: it shares TMDB's rate limit) until the fetch is done and nothing is
# pending. The resolver is restartable; the fetch ranges start at FROM.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
DB=file:data/mirror/kanpp.sqlite
LOG=data/mirror/logs
WORKERS=${WORKERS:-3}
FROM=${FROM:-426}
FETCH=${FETCH:-1}
mkdir -p "$LOG"
[ -e data/mirror/checkout.lock ] || { echo "no mirror checked out: npx tsx scripts/mirror.ts pull"; exit 1; }

if [ "$FETCH" = 1 ]; then
  # source:page count when this was written; the last range of each source runs to the real end.
  for entry in modu:4459 ikun:3351 zuida:6171 feifan:4912 wujin:6047 guangsu:5678; do
    s=${entry%%:*}
    total=${entry##*:}
    span=$(( (total - FROM) / WORKERS + 1 ))
    for w in $(seq 0 $((WORKERS - 1))); do
      from=$(( FROM + w * span ))
      pages=$span
      [ "$w" -eq $((WORKERS - 1)) ] && pages=100000
      npx tsx scripts/ingest.ts --db=$DB --sources="$s" --from="$from" --pages="$pages" --fetch-only >> "$LOG/fetch-$s-$w.log" 2>&1 &
    done
  done
  echo "$(date -u +%H:%M:%S) fetch started: $WORKERS ranges x 6 sources"
fi

fetching() { pgrep -f "ingest.ts --db=$DB .*--fetch-only" >/dev/null; }
sleep 30
while true; do
  out=$(npx tsx scripts/ingest.ts --db=$DB --resolve-only --limit=5000 --concurrency=32 2>&1 | tee -a "$LOG/resolve.log" | grep -E "resolve done|catalog:" | tr '\n' ' ')
  echo "$(date -u +%H:%M:%S) $out"
  if echo "$out" | grep -q '"processed":0'; then
    fetching || break
    sleep 60
  fi
done

# Rows that failed on a transient TMDB error get one more pass, then the whole catalog goes
# through the publish gate once.
sqlite3 data/mirror/kanpp.sqlite "UPDATE source_items SET match_status = 'pending' WHERE match_status = 'unmatched' AND match_note LIKE 'error:%'"
npx tsx scripts/ingest.ts --db=$DB --resolve-only --limit=100000 --concurrency=32 >> "$LOG/resolve.log" 2>&1
sqlite3 data/mirror/kanpp.sqlite "UPDATE sync_state SET value = '1', updated_at = datetime('now') WHERE key LIKE 'backfill:%'"
npx tsx scripts/ingest.ts --db=$DB --resolve-only --limit=0 --republish 2>&1 | grep -E "publish gate|catalog:"
echo "=== $(date -u +%H:%M:%S) mirror bulk finished: push with npx tsx scripts/mirror.ts push"
