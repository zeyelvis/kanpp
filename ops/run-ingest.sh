#!/bin/bash
# Local fallback for the Ingest workflow (use only while GitHub-hosted runners are unavailable).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# Any authenticated wrangler call refreshes the OAuth token that scripts reuse for remote D1.
npx wrangler whoami >/dev/null 2>&1
npx tsx scripts/ingest.ts --db=remote --hours=5 --backfill=5 --refresh-series=300 --limit=2000 --concurrency=8
