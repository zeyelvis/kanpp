/**
 * Catalog ingest: CMS sources -> source_items -> matched titles (TMDB) -> publish gate.
 *
 *   npm run ingest -- --db=local --hours=24              incremental (last 24h) from all sources
 *   npm run ingest -- --db=local --sources=feifan --pages=5   first N pages of one source
 *   npm run ingest -- --db=remote --resolve-only --limit=2000
 */
import { parseArgs } from "node:util";
import { Resolver } from "@/lib/ingest/resolve";
import { refreshTitles } from "@/lib/ingest/publish";
import { upsertSourceRows } from "@/lib/ingest/source-rows";
import { fetchCmsPage } from "@/lib/sources/cms";
import { SOURCES } from "@/lib/sources/registry";
import { TmdbClient } from "@/lib/tmdb/client";
import { loadEnv, openDb } from "./lib/open-db";

loadEnv();

const { values: args } = parseArgs({
  options: {
    db: { type: "string", default: "local" },
    sources: { type: "string" },
    hours: { type: "string" },
    pages: { type: "string" },
    limit: { type: "string", default: "1000" },
    concurrency: { type: "string", default: "4" },
    "resolve-only": { type: "boolean", default: false },
    "fetch-only": { type: "boolean", default: false },
  },
});

const log = (...parts: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...parts);

async function main() {
  const target = args.db === "remote" ? "remote" : "local";
  const db = openDb(target);
  const touched = new Set<number>();
  log(`db=${target}`);

  if (!args["resolve-only"]) {
    const selected = args.sources ? SOURCES.filter((s) => args.sources!.split(",").includes(s.id)) : SOURCES;
    const hours = args.hours ? Number(args.hours) : undefined;
    const maxPages = args.pages ? Number(args.pages) : hours ? Infinity : 1;
    for (const source of selected) {
      let written = 0;
      const skipped: Record<string, number> = {};
      try {
        for (let page = 1, pageCount = 1; page <= Math.min(pageCount, maxPages); page++) {
          const res = await fetchCmsPage(source, page, hours);
          pageCount = res.pageCount;
          const stats = await upsertSourceRows(db, source.id, res.items);
          written += stats.written;
          for (const [k, v] of Object.entries(stats.skipped)) skipped[k] = (skipped[k] ?? 0) + (v ?? 0);
          stats.touchedTitleIds.forEach((id) => touched.add(id));
        }
        log(`fetch ${source.id}: wrote ${written}, skipped ${JSON.stringify(skipped)}`);
      } catch (err) {
        // One flaky source must not stop the others.
        log(`fetch ${source.id} FAILED after ${written} rows: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  if (!args["fetch-only"]) {
    const resolver = new Resolver(db, new TmdbClient(process.env.TMDB_API_KEY ?? ""));
    const stats = await resolver.resolvePending({
      limit: Number(args.limit),
      concurrency: Number(args.concurrency),
      onProgress: (s) => log(`resolve ${s.processed}: matched ${s.matched} (new ${s.created}) review ${s.review} unmatched ${s.unmatched} rejected ${s.rejected}`),
    });
    log(`resolve done: ${JSON.stringify({ ...stats, touchedTitleIds: stats.touchedTitleIds.size })}`);
    stats.touchedTitleIds.forEach((id) => touched.add(id));
  }

  const published = await refreshTitles(db, touched);
  log(`publish gate: refreshed ${published.refreshed}, indexable ${published.indexable}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
