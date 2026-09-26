import type { Db } from "@/lib/db/types";
import type { Kind } from "@/lib/domain/kinds";
import { titlePath } from "@/lib/domain/slug";

export interface RevalidatePayload {
  titleIds: number[];
  created: boolean;
  catalog: boolean;
}

/**
 * Tells the live site which cached pages and data are stale (POST /api/revalidate). `fetcher`
 * is plain fetch from scripts, or the site's service binding in the ingest Worker.
 */
export function siteNotifier(opts: { base: string; secret: string | undefined; fetcher?: (url: string, init: RequestInit) => Promise<Response> }) {
  const fetcher = opts.fetcher ?? ((url, init) => fetch(url, init));
  return async (payload: RevalidatePayload): Promise<string> => {
    if (!opts.secret) return "skipped (REVALIDATE_SECRET not set)";
    const results: string[] = [];
    // Chunked so a large backfill stays within request limits.
    for (let i = 0; i === 0 || i < payload.titleIds.length; i += 1000) {
      const chunk = payload.titleIds.slice(i, i + 1000);
      const first = i === 0;
      const res = await fetcher(`${opts.base}/api/revalidate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ titleIds: chunk, created: first && payload.created, catalog: first && payload.catalog }),
      });
      results.push(`${res.status}`);
      await res.body?.cancel();
      if (!res.ok) break;
    }
    return results.join(",");
  };
}

/** Canonical paths of the given titles that are published (for IndexNow). */
export async function titlePaths(db: Db, titleIds: number[]): Promise<string[]> {
  const paths: string[] = [];
  // D1 allows at most 100 bound parameters per query.
  for (let i = 0; i < titleIds.length; i += 100) {
    const ids = titleIds.slice(i, i + 100);
    const rows = await db.all<{ kind: Kind; slug: string }>(
      `SELECT t.kind, s.slug FROM titles t JOIN slugs s ON s.title_id = t.id AND s.is_canonical = 1
       WHERE t.id IN (${ids.map(() => "?").join(",")}) AND +t.indexable = 1`,
      ids,
    );
    paths.push(...rows.map((r) => titlePath(r.kind, r.slug)));
  }
  return paths;
}

const INDEXNOW_QUEUE = "indexnow:queue";
const MAX_QUEUED = 10_000;

/**
 * Submits paths to IndexNow together with any an earlier run could not deliver (the endpoint
 * answers 429 when it has had enough for a while); undelivered paths wait in sync_state for
 * the next run.
 */
export async function submitQueued(db: Db, submit: (paths: string[]) => Promise<string>, paths: string[]): Promise<string> {
  const queued = JSON.parse((await db.first<{ value: string }>("SELECT value FROM sync_state WHERE key = ?", [INDEXNOW_QUEUE]))?.value || "[]") as string[];
  const all = [...new Set([...queued, ...paths])].slice(-MAX_QUEUED);
  if (all.length === 0) return "nothing to submit";
  const result = await submit(all);
  // "N urls: 200,202" when every batch was accepted; "skipped (...)" off production.
  const delivered = /^skipped/.test(result) || /: (2\d\d,?)+$/.test(result);
  await db.run(
    "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    [INDEXNOW_QUEUE, delivered ? "" : JSON.stringify(all)],
  );
  return delivered ? result : `${result} (${all.length} kept for the next run)`;
}
