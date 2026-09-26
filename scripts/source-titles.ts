/**
 * Builds titles from the CMS sources' own metadata for Chinese animation and variety shows
 * that TMDB does not list, from this machine (scheduled runs happen in the ingest Worker; the
 * job is lib/ingest/source-titles-job.ts, the rules lib/ingest/source-titles.ts).
 *
 *   npx tsx scripts/source-titles.ts --db=remote --dry-run
 *   npx tsx scripts/source-titles.ts --db=remote [--limit=500]
 *
 * Titles are written with explicit ids, so against production the run takes the catalog lease
 * (lib/ingest/lease.ts) that the Worker's jobs also take.
 */
import { parseArgs } from "node:util";
import { site } from "@/lib/config/site";
import { withLease } from "@/lib/ingest/lease";
import type { JobContext } from "@/lib/ingest/pipeline";
import { runSourceTitles } from "@/lib/ingest/source-titles-job";
import { submitIndexNow } from "@/lib/seo/indexnow";
import { loadEnv, openDb, parseDbTarget } from "./lib/open-db";
import { notifySite } from "./lib/revalidate";

loadEnv();

const { values: args } = parseArgs({
  options: {
    db: { type: "string", default: "local" },
    limit: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const log = (...parts: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...parts);

async function main() {
  const target = parseDbTarget(args.db);
  const db = openDb(target);
  const ctx: JobContext = { db, log, notifySite, submitIndexNow, siteFetch: (path) => fetch(`${site.url}${path}`), announce: target === "remote" };
  const job = () => runSourceTitles(ctx, { limit: args.limit ? Number(args.limit) : undefined, dryRun: args["dry-run"] });
  if (target !== "remote" || args["dry-run"]) return void (await job());
  const done = await withLease(db, `script:${process.pid}`, 60, job);
  if (done === null) throw new Error("another catalog job holds the lease, or a mirror is checked out: try later");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
