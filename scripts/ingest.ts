/**
 * Catalog ingest from this machine (the scheduled runs happen in the ingest Worker,
 * ingest/worker.ts; the pipeline itself is lib/ingest/pipeline.ts).
 *
 *   npm run ingest -- --db=remote --hours=4                 incremental (rows updated in the last 4h)
 *   npm run ingest -- --db=remote --backfill=5              next 5 pages of each source's full catalog
 *   npm run ingest -- --db=remote --refresh-series=300      re-pull TMDB for airing series
 *   npm run ingest -- --db=local --sources=modu --pages=2   first N pages of one source
 *   npm run ingest -- --db=file:data/mirror/kanpp.sqlite --sources=modu --from=500 --pages=1000 --fetch-only
 *   npm run ingest -- --db=remote --resolve-only --limit=2000
 *
 *   npm run ingest -- --db=file:data/mirror/kanpp.sqlite --resolve-only --limit=0 --republish
 *
 * Modes combine; every run ends with the publish gate for the titles it touched (--republish: all).
 * Against production the run takes the same lease as the Worker's jobs (lib/ingest/lease.ts).
 */
import { parseArgs } from "node:util";
import { site } from "@/lib/config/site";
import { withLease } from "@/lib/ingest/lease";
import { runIngest, type JobContext } from "@/lib/ingest/pipeline";
import { submitIndexNow } from "@/lib/seo/indexnow";
import { TmdbClient } from "@/lib/tmdb/client";
import { loadEnv, openDb, parseDbTarget } from "./lib/open-db";
import { notifySite } from "./lib/revalidate";

loadEnv();

const { values: args } = parseArgs({
  options: {
    db: { type: "string", default: "local" },
    sources: { type: "string" },
    hours: { type: "string" },
    pages: { type: "string" },
    from: { type: "string" },
    backfill: { type: "string" },
    "refresh-series": { type: "string" },
    limit: { type: "string", default: "1000" },
    concurrency: { type: "string", default: "4" },
    "resolve-only": { type: "boolean", default: false },
    "fetch-only": { type: "boolean", default: false },
    republish: { type: "boolean", default: false },
  },
});

const log = (...parts: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const num = (v: string | undefined) => (v == null ? undefined : Number(v));

async function main() {
  const target = parseDbTarget(args.db);
  const db = openDb(target);
  // TMDB allows roughly 40-50 requests/s per IP; 429s are retried with Retry-After.
  const tmdb = new TmdbClient(process.env.TMDB_API_KEY ?? "", Number(process.env.TMDB_CONCURRENCY ?? 16));
  const ctx: JobContext = {
    db,
    log,
    notifySite,
    submitIndexNow,
    siteFetch: (path) => fetch(`${site.url}${path}`),
    announce: target === "remote",
  };
  log(`db=${target}`);
  const job = () =>
    runIngest(ctx, tmdb, {
      sources: args.sources?.split(","),
      hours: num(args.hours),
      pages: num(args.pages),
      from: num(args.from),
      backfill: num(args.backfill),
      refreshSeries: num(args["refresh-series"]),
      limit: Number(args.limit),
      concurrency: Number(args.concurrency),
      resolveOnly: args["resolve-only"],
      fetchOnly: args["fetch-only"],
      republish: args.republish,
    });
  if (target !== "remote") return void (await job());
  const done = await withLease(db, `script:${process.pid}`, 120, job);
  if (done === null) throw new Error("another catalog job holds the lease, or a mirror is checked out: try later");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
