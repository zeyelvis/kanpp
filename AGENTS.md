<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 看片片 (kanpp.tv)

Chinese-language film/TV site. Next.js 16 on Cloudflare Workers (OpenNext), Cloudflare D1 as the
single source of truth. Fully independent from ikanpp.com: never share its KV/D1/R2, secrets,
workflows or copy, and do not link the two sites.

## Architecture

- `migrations/` D1 schema. `lib/db/` one `Db` interface over the D1 binding (web), the D1 HTTP API
  (scripts, `--db=remote`) and node:sqlite (tests, `--db=local` = the wrangler dev database).
- `lib/domain/` pure rules: normalization, seasons, slugs, content policy, match scoring.
- `lib/sources/` CMS (苹果CMS) sources; `lib/tmdb/` TMDB client; `lib/ingest/` the pipeline
  `source_items -> resolve (douban id > exact local alias > TMDB) -> titles -> publish gate`.
- The web runtime reads D1 only. It never calls TMDB or CMS sources while rendering.
- Brand and domain live only in `lib/config/site.ts`.

## Invariants (backed by schema triggers or tests; keep it that way)

- Title ids are AUTOINCREMENT and never reused; titles are never deleted (status changes only).
- A slug always points at the same title. URLs resolve slug -> title via the `slugs` table, never by
  parsing an id out of the URL. New canonical slug = insert a row; old slugs 308 to it.
- One title per TMDB entity and per douban/imdb id (unique indexes).
- Matching requires an exact normalized-name alias match. No substring/fuzzy name matching; a
  movie never matches a series.
- Published (`indexable = 1`) only with: clean Chinese name (`isPublishableName`), poster,
  synopsis, and at least one directly playable HLS line.
- Anything a page shows must come from data. No invented ratings, years, quality or "free" claims.

## Playback

- Direct play from the source CDN. No proxying or m3u8 rewriting. On failure, switch to the next
  source line; never try to rescue a dead line through a proxy.
- Never nudge `currentTime` to recover from a stall; show a spinner and let hls.js buffer.

## SEO

- Every indexable page sets its own `title`, `description` and self-referencing canonical.
- Title/season routes must not have `loading.tsx` or a Suspense boundary above the slug
  lookup: `permanentRedirect`/`notFound` only produce real 308/404 before streaming starts.
- `/watch/*` and `/search` are `noindex`. Only indexable titles go into sitemaps.
- No Google Indexing API. IndexNow only for URLs whose content actually changed.
- No mass AI-written copy, no hidden text, no doorway pages.

## Commands

- `npm test` (vitest), `npm run typecheck`, `npm run lint`
- `npm run db:migrate:local` / `npm run db:migrate:remote`
- `npm run ingest -- --db=local --hours=24` (see `scripts/ingest.ts` for flags)
- `npm run dev` (uses the local D1), `npm run preview` (Workers runtime), `npm run deploy`
