#!/bin/bash
# Stores the ingest Worker's secrets in Cloudflare, read from .env.local and never printed:
# TMDB_API_KEY (matching), REVALIDATE_SECRET (telling the site what changed, and manual runs),
# VAPID_PRIVATE_KEY (update reminders). Run once after the first `npm run ingest:deploy`:
#
#   bash ops/set-ingest-secrets.sh
set -euo pipefail
cd "$(dirname "$0")/.."
for name in TMDB_API_KEY REVALIDATE_SECRET VAPID_PRIVATE_KEY; do
  value=$(grep -E "^${name}=" .env.local | head -1 | cut -d= -f2-)
  if [ -z "$value" ]; then
    echo "$name is missing in .env.local"
    exit 1
  fi
  printf '%s' "$value" | (cd ingest && npx --prefix .. wrangler secret put "$name" >/dev/null)
  echo "$name stored"
done
