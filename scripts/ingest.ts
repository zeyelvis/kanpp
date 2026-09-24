/**
 * Catalog ingest: CMS sources -> source_items -> matched titles (TMDB) -> publish gate.
 *
 *   npm run ingest -- --db=remote --hours=4                 incremental (rows updated in the last 4h)
 *   npm run ingest -- --db=remote --backfill=5              next 5 pages of each source's full catalog
 *   npm run ingest -- --db=remote --refresh-series=300      re-pull TMDB for airing series
 *   npm run ingest -- --db=local --sources=modu --pages=2   first N pages of one source
 *   npm run ingest -- --db=remote --resolve-only --limit=2000
 *
 * Modes combine; every run ends with the publish gate for the titles it touched.
 */
import { parseArgs } from "node:util";
import type { Db } from "@/lib/db/types";
import { refreshTitles, storeCatalogCounts } from "@/lib/ingest/publish";
import { refreshAiringSeries } from "@/lib/ingest/refresh";
import { Resolver } from "@/lib/ingest/resolve";
import { upsertSourceRows } from "@/lib/ingest/source-rows";
import { fetchCmsPage } from "@/lib/sources/cms";
import { SOURCES, type CmsSource } from "@/lib/sources/registry";
import { TmdbClient } from "@/lib/tmdb/client";
import { loadEnv, openDb } from "./lib/open-db";
import { notifySite } from "./lib/revalidate";

loadEnv();

const { values: args } = parseArgs({
  options: {
    db: { type: "string", default: "local" },
    sources: { type: "string" },
    hours: { type: "string" },
    pages: { type: "string" },
    backfill: { type: "string" },
    "refresh-series": { type: "string" },
    limit: { type: "string", default: "1000" },
    concurrency: { type: "string", default: "4" },
    "resolve-only": { type: "boolean", default: false },
    "fetch-only": { type: "boolean", default: false },
  },
});

const log = (...parts: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...parts);

async function fetchPages(db: Db, source: CmsSource, from: number, count: number, hours: number | undefined, touched: Set<number>) {
  let written = 0;
  let pageCount = from;
  const skipped: Record<string, number> = {};
  let page = from;
  for (; page < from + count && page <= pageCount; page++) {
    const res = await fetchCmsPage(source, page, hours);
    pageCount = res.pageCount;
    const stats = await upsertSourceRows(db, source.id, res.items);
    written += stats.written;
    for (const [k, v] of Object.entries(stats.skipped)) skipped[k] = (skipped[k] ?? 0) + (v ?? 0);
    stats.touchedTitleIds.forEach((id) => touched.add(id));
  }
  return { written, skipped, nextPage: page, pageCount };
}

async function main() {
  const target = args.db === "remote" ? "remote" : "local";
  const db = openDb(target);
  const tmdb = new TmdbClient(process.env.TMDB_API_KEY ?? "");
  const touched = new Set<number>();
  let created = false;
  const selected = args.sources ? SOURCES.filter((s) => args.sources!.split(",").includes(s.id)) : SOURCES;
  log(`db=${target} sources=${selected.map((s) => s.id).join(",")}`);

  if (!args["resolve-only"]) {
    for (const source of selected) {
      try {
        if (args.hours || args.pages) {
          const hours = args.hours ? Number(args.hours) : undefined;
          const r = await fetchPages(db, source, 1, args.pages ? Number(args.pages) : Infinity, hours, touched);
          log(`fetch ${source.id}: wrote ${r.written}, skipped ${JSON.stringify(r.skipped)}`);
        }
        if (args.backfill) {
          // Walk the full catalog a few pages per run; the cursor lives in D1.
          const key = `backfill:${source.id}`;
          const cursor = Number((await db.first<{ value: string }>("SELECT value FROM sync_state WHERE key = ?", [key]))?.value ?? 1);
          const r = await fetchPages(db, source, cursor, Number(args.backfill), undefined, touched);
          const next = r.nextPage > r.pageCount ? 1 : r.nextPage; // wrap around when done
          await db.run(
            "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
            [key, String(next)],
          );
          log(`backfill ${source.id}: pages ${cursor}-${r.nextPage - 1} of ${r.pageCount}, wrote ${r.written}, skipped ${JSON.stringify(r.skipped)}`);
        }
      } catch (err) {
        // One flaky source must not stop the others.
        log(`fetch ${source.id} FAILED: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  if (!args["fetch-only"]) {
    const resolver = new Resolver(db, tmdb);
    const stats = await resolver.resolvePending({
      limit: Number(args.limit),
      concurrency: Number(args.concurrency),
      onProgress: (s) => log(`resolve ${s.processed}: matched ${s.matched} (new ${s.created}) review ${s.review} unmatched ${s.unmatched} rejected ${s.rejected}`),
    });
    log(`resolve done: ${JSON.stringify({ ...stats, touchedTitleIds: stats.touchedTitleIds.size })}`);
    stats.touchedTitleIds.forEach((id) => touched.add(id));
    created = stats.created > 0;
  }

  if (args["refresh-series"]) {
    const r = await refreshAiringSeries(db, tmdb, Number(args["refresh-series"]));
    r.ids.forEach((id) => touched.add(id));
    log(`refresh-series: ${r.refreshed} airing series re-synced from TMDB`);
  }

  const published = await refreshTitles(db, touched);
  log(`publish gate: refreshed ${published.refreshed}, indexable ${published.indexable}`);
  log(`catalog: ${JSON.stringify(await storeCatalogCounts(db))}`);

  if (target === "remote") {
    log(`revalidate: ${await notifySite({ titleIds: [...touched], created, catalog: true })}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
