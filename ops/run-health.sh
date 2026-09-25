#!/bin/bash
# Daily health report (launchd, 09:10 local). Uses this Mac's wrangler login like run-ingest.sh.
# Report files: data/health/{date}.json and latest.json; alerts also raise a notification.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
echo "=== $(date -u +%FT%TZ) health report"
caffeinate -i npx tsx scripts/health.ts --notify
echo "=== $(date -u +%FT%TZ) end (exit $?)"
