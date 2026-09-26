/**
 * kanpp-ingest: the catalog's scheduled jobs, run by Cloudflare instead of a machine that may
 * be asleep. Same code as the scripts (lib/ingest/*), with the D1 binding and the site's
 * service binding. Three cron jobs every 4 hours, each with its own time and request budget:
 *
 *   catalog  sources' recent updates and backfill pages -> matching -> publish gate -> people
 *   series   TMDB refresh of airing series -> publish gate -> people
 *   extras   titles from source metadata (Chinese animation/variety), then update reminders
 *
 * Every job holds the catalog lease (lib/ingest/lease.ts) and skips while another job, a
 * script, or a checked-out mirror holds it. Results go to sync_state "job:{name}" (the health
 * report reads them) and to Workers logs.
 *
 * Manual run: POST https://kanpp-ingest.<account>.workers.dev/run?job=catalog with
 * "Authorization: Bearer <REVALIDATE_SECRET>" (optional hours, backfill, limit; limit=0 only
 * fetches). Jobs that match against TMDB are skipped until TMDB_API_KEY is set.
 */
import { site } from "../lib/config/site";
import { d1Db, type D1DatabaseLike } from "../lib/db/d1";
import { retryingDb } from "../lib/db/retry";
import { VAPID_PUBLIC_KEY } from "../lib/domain/push";
import { withLease } from "../lib/ingest/lease";
import { siteNotifier } from "../lib/ingest/notify";
import { runIngest, type JobContext } from "../lib/ingest/pipeline";
import { runPushUpdates } from "../lib/ingest/push-job";
import { runSourceTitles } from "../lib/ingest/source-titles-job";
import { submitIndexNow } from "../lib/seo/indexnow";
import { TmdbClient } from "../lib/tmdb/client";

interface Fetcher {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}
interface ScheduledController {
  cron: string;
  scheduledTime: number;
}

interface Env {
  DB: D1DatabaseLike;
  /** The site worker (kanpp): cache revalidation and image warming without the public internet. */
  SITE: Fetcher;
  TMDB_API_KEY?: string;
  REVALIDATE_SECRET?: string;
  VAPID_PRIVATE_KEY?: string;
  /** "false" for local test runs: no revalidation, IndexNow or image warming. */
  ANNOUNCE?: string;
}

/** Overrides for a manual run (POST /run?job=catalog&limit=0 fetches without matching). */
interface RunOptions {
  hours?: number;
  backfill?: number;
  limit?: number;
}

type JobName = "catalog" | "series" | "extras";

// Must match "triggers.crons" in ingest/wrangler.jsonc.
const SCHEDULE: Record<string, JobName> = {
  "5 */4 * * *": "catalog",
  "25 */4 * * *": "series",
  "45 */4 * * *": "extras",
};

// A Worker has at most 6 connections open at once; more TMDB concurrency only queues.
const TMDB_CONCURRENCY = 6;

async function runJob(env: Env, job: JobName, log: (...parts: unknown[]) => void, opts: RunOptions = {}) {
  // D1 occasionally drops a connection mid-job ("Network connection lost"): retry those.
  const db = retryingDb(d1Db(env.DB));
  const ctx: JobContext = {
    db,
    log,
    notifySite: siteNotifier({ base: site.url, secret: env.REVALIDATE_SECRET, fetcher: (url, init) => env.SITE.fetch(url, init) }),
    submitIndexNow,
    siteFetch: (path) => env.SITE.fetch(`${site.url}${path}`),
    announce: env.ANNOUNCE !== "false",
  };
  const tmdb = env.TMDB_API_KEY ? new TmdbClient(env.TMDB_API_KEY, TMDB_CONCURRENCY) : null;
  const started = Date.now();
  let record: Record<string, unknown>;
  try {
    const limit = opts.limit ?? 2000;
    // Without a TMDB key every lookup fails and pending rows would be marked unmatched for good.
    const needsTmdb = job === "series" || (job === "catalog" && limit > 0);
    const missing = needsTmdb && !env.TMDB_API_KEY ? "TMDB_API_KEY" : ctx.announce && !env.REVALIDATE_SECRET ? "REVALIDATE_SECRET" : null;
    const result = missing ? `missing ${missing}` : await withLease(db, `worker:${job}:${crypto.randomUUID()}`, 20, async () => {
      if (job === "catalog") return runIngest(ctx, tmdb, { hours: opts.hours ?? 5, backfill: opts.backfill ?? 5, limit, concurrency: 4 });
      if (job === "series") return runIngest(ctx, tmdb, { refreshSeries: 300, limit: 0, concurrency: 4, resolveOnly: true });
      const vapid = env.VAPID_PRIVATE_KEY ? { subject: site.url, publicKey: VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } : null;
      return { sourceTitles: await runSourceTitles(ctx), reminders: await runPushUpdates(ctx, vapid) };
    });
    record =
      result === null ? { ok: true, skipped: "lease held or mirror checked out" } : typeof result === "string" ? { ok: true, skipped: result } : { ok: true, summary: result };
  } catch (err) {
    record = { ok: false, error: err instanceof Error ? `${err.message}\n${err.stack ?? ""}`.slice(0, 1500) : String(err) };
  }
  record = { ...record, job, startedAt: new Date(started).toISOString(), ms: Date.now() - started };
  log(`job ${job}: ${JSON.stringify(record)}`);
  await db.run(
    "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    [`job:${job}`, JSON.stringify(record)],
  );
  if (!record.ok) throw new Error(`job ${job} failed: ${record.error}`);
  return record;
}

const worker = {
  // Awaited, so a failed job shows as a failed cron invocation.
  async scheduled(controller: ScheduledController, env: Env) {
    const job = SCHEDULE[controller.cron];
    if (!job) throw new Error(`no job for cron "${controller.cron}"`);
    await runJob(env, job, (...parts) => console.log(...parts));
  },

  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const job = url.searchParams.get("job") as JobName | null;
    const authorized = env.REVALIDATE_SECRET && request.headers.get("authorization") === `Bearer ${env.REVALIDATE_SECRET}`;
    if (request.method !== "POST" || url.pathname !== "/run" || !authorized || !job || !Object.values(SCHEDULE).includes(job)) {
      return new Response("Not found", { status: 404 });
    }
    const lines: string[] = [];
    const log = (...parts: unknown[]) => {
      const line = parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
      lines.push(line);
      console.log(line);
    };
    const num = (name: string) => (url.searchParams.has(name) ? Number(url.searchParams.get(name)) : undefined);
    const record = await runJob(env, job, log, { hours: num("hours"), backfill: num("backfill"), limit: num("limit") }).catch((err: unknown) => ({ ok: false, error: String(err) }));
    return Response.json({ record, log: lines });
  },
};

export default worker;
