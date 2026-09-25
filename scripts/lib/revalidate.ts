import { site } from "@/lib/config/site";
import type { Db } from "@/lib/db/types";
import { titlePath } from "@/lib/domain/slug";
import type { Kind } from "@/lib/domain/kinds";
import { submitIndexNow } from "@/lib/seo/indexnow";

/**
 * Tells the live site which cached pages/data are stale after an ingest run. Skipped when no
 * secret is configured (e.g. local runs against the dev database).
 */
export async function notifySite(payload: { titleIds: number[]; created: boolean; catalog: boolean }): Promise<string> {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return "skipped (REVALIDATE_SECRET not set)";
  const base = process.env.SITE_URL ?? site.url;
  const results: string[] = [];
  // Chunked so a large backfill stays within request limits.
  for (let i = 0; i === 0 || i < payload.titleIds.length; i += 1000) {
    const chunk = payload.titleIds.slice(i, i + 1000);
    const first = i === 0;
    const res = await fetch(`${base}/api/revalidate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ titleIds: chunk, created: first && payload.created, catalog: first && payload.catalog }),
    });
    results.push(`${res.status}`);
    if (!res.ok) break;
  }
  return results.join(",");
}

/** Submits the canonical URLs of the given titles (plus any other paths) to IndexNow. */
export async function announceTitles(db: Db, titleIds: number[], extraPaths: string[] = []): Promise<string> {
  const paths: string[] = [...extraPaths];
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
  return submitIndexNow(paths);
}
