import type { Db } from "@/lib/db/types";
import { personPath } from "@/lib/domain/slug";
import { fetchCmsPage } from "@/lib/sources/cms";
import { SOURCES, type CmsSource } from "@/lib/sources/registry";
import type { TmdbClient } from "@/lib/tmdb/client";
import { submitQueued, titlePaths, type RevalidatePayload } from "./notify";
import { refreshPeople } from "./people";
import { refreshTitles, storeCatalogCounts } from "./publish";
import { refreshAiringSeries } from "./refresh";
import { Resolver } from "./resolve";
import { upsertSourceRows } from "./source-rows";

/**
 * What a catalog job needs from where it runs: the database, a log, and how to reach the live
 * site and IndexNow. Scripts pass fetch and the D1 HTTP API; the ingest Worker passes its D1
 * binding and the site's service binding (ingest/worker.ts).
 */
export interface JobContext {
  db: Db;
  log: (...parts: unknown[]) => void;
  notifySite: (payload: RevalidatePayload) => Promise<string>;
  submitIndexNow: (paths: string[]) => Promise<string>;
  /** Fetches a path from the live site (e.g. to pull a new poster into R2). */
  siteFetch: (path: string) => Promise<Response>;
  /** Production: tell the site and search engines what changed. */
  announce: boolean;
}

export interface IngestOptions {
  sources?: string[];
  /** Rows the sources updated in the last N hours. */
  hours?: number;
  /** First N pages (from `from`) of each source's listing. */
  pages?: number;
  from?: number;
  /** Next N pages of each source's full catalog (cursor in sync_state). */
  backfill?: number;
  /** Re-pull TMDB for up to N airing series. */
  refreshSeries?: number;
  /** Pending rows to resolve (0: none). */
  limit: number;
  concurrency: number;
  resolveOnly?: boolean;
  fetchOnly?: boolean;
  /** Re-run the publish gate for the whole catalog. */
  republish?: boolean;
}

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

/**
 * Catalog ingest: CMS sources -> source_items -> matched titles (TMDB) -> publish gate ->
 * people -> the site's caches and IndexNow. Modes combine (see IngestOptions).
 */
export async function runIngest(ctx: JobContext, tmdb: TmdbClient | null, opts: IngestOptions) {
  const { db, log } = ctx;
  const touched = new Set<number>();
  let created = false;
  const selected = opts.sources ? SOURCES.filter((s) => opts.sources!.includes(s.id)) : SOURCES;
  const summary: Record<string, unknown> = {};

  if (!opts.resolveOnly) {
    for (const source of selected) {
      try {
        if (opts.hours || opts.pages) {
          const r = await fetchPages(db, source, opts.from ?? 1, opts.pages ?? Infinity, opts.hours, touched);
          log(`fetch ${source.id}: wrote ${r.written}, skipped ${JSON.stringify(r.skipped)}`);
          summary[`fetch:${source.id}`] = r.written;
        }
        if (opts.backfill) {
          // Walk the full catalog a few pages per run; the cursor lives in D1.
          const key = `backfill:${source.id}`;
          const cursor = Number((await db.first<{ value: string }>("SELECT value FROM sync_state WHERE key = ?", [key]))?.value ?? 1);
          const r = await fetchPages(db, source, cursor, opts.backfill, undefined, touched);
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
        summary[`fetch:${source.id}`] = "failed";
      }
    }
  }

  if ((!opts.fetchOnly && opts.limit > 0) || opts.refreshSeries) {
    if (!tmdb) throw new Error("matching and series refresh need a TMDB key");
  }
  if (tmdb && !opts.fetchOnly && opts.limit > 0) {
    const resolver = new Resolver(db, tmdb);
    const stats = await resolver.resolvePending({
      limit: opts.limit,
      concurrency: opts.concurrency,
      onProgress: (s) => log(`resolve ${s.processed}: matched ${s.matched} (new ${s.created}) review ${s.review} unmatched ${s.unmatched} rejected ${s.rejected}`),
    });
    log(`resolve done: ${JSON.stringify({ ...stats, touchedTitleIds: stats.touchedTitleIds.size })}`);
    stats.touchedTitleIds.forEach((id) => touched.add(id));
    created = stats.created > 0;
    summary.resolved = { processed: stats.processed, matched: stats.matched, created: stats.created };
  }

  if (tmdb && opts.refreshSeries) {
    const r = await refreshAiringSeries(db, tmdb, opts.refreshSeries);
    r.ids.forEach((id) => touched.add(id));
    log(`refresh-series: ${r.refreshed} airing series re-synced from TMDB`);
    summary.refreshedSeries = r.refreshed;
  }

  if (opts.republish) {
    // Re-run the publish gate for the whole catalog (cheap on a local file, slow over HTTP).
    (await db.all<{ id: number }>("SELECT id FROM titles")).forEach((r) => touched.add(r.id));
  }
  const published = await refreshTitles(db, touched);
  log(`publish gate: refreshed ${published.refreshed}, indexable ${published.indexable}`);
  summary.published = { refreshed: published.refreshed, changed: published.changed.length };
  log(`catalog: ${JSON.stringify(await storeCatalogCounts(db))}`);
  const people = await refreshPeople(db);
  log(`people: ${JSON.stringify({ ...people, published: people.published.length })}`);
  // New person slugs may have been cached as 404s, like new titles.
  created ||= people.slugged > 0;

  if (ctx.announce) {
    summary.revalidate = await ctx.notifySite({ titleIds: [...touched], created, catalog: true });
    summary.indexnow = await submitQueued(db, ctx.submitIndexNow, [...people.published.map(personPath), ...(await titlePaths(db, published.changed))]);
    log(`revalidate: ${summary.revalidate}`);
    log(`indexnow: ${summary.indexnow}`);
  }
  return summary;
}
