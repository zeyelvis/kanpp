import type { Db } from "@/lib/db/types";
import { sameProgress, sourceProgress, type SourceLabel } from "@/lib/domain/labels";
import { isPublishableName } from "@/lib/domain/safety";
import { SOURCES } from "@/lib/sources/registry";

export const MIN_OVERVIEW_LENGTH = 20;

/**
 * Stores per-kind indexable counts in sync_state, so list pages and sitemaps read one row
 * instead of counting the whole catalog on every request.
 */
export async function storeCatalogCounts(db: Db): Promise<Record<string, number>> {
  const rows = await db.all<{ kind: string; n: number }>("SELECT kind, COUNT(*) AS n FROM titles WHERE indexable = 1 GROUP BY kind");
  const counts: Record<string, number> = Object.fromEntries(rows.map((r) => [r.kind, r.n]));
  counts.all = rows.reduce((sum, r) => sum + r.n, 0);
  await db.batch(
    Object.entries(counts).map(([kind, n]) => ({
      sql: "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
      params: [`count:${kind}`, String(n)],
    })),
  );
  return counts;
}

interface TitleRow {
  id: number;
  name: string;
  status: string;
  poster_path: string | null;
  overview: string | null;
  indexable: number;
  latest_label: string | null;
  source_updated_at: string | null;
}

/**
 * Recomputes source-derived fields and the publish gate for the given titles.
 * A title is indexable only when it is active, has a clean Chinese name, a poster, a real
 * synopsis and at least one playable HLS line. Everything else stays out of search engines.
 */
export async function refreshTitles(
  db: Db,
  titleIds: Iterable<number>,
  concurrency = 8,
): Promise<{ refreshed: number; indexable: number; changed: number[] }> {
  let refreshed = 0;
  let indexable = 0;
  const changed: number[] = [];
  const queue = [...titleIds];
  // Four queries per title: over D1's HTTP API they are round trips, so run a few titles at once.
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const result = await refreshTitle(db, id);
      if (!result) continue;
      refreshed++;
      if (result.indexable) indexable++;
      if (result.changed) changed.push(id);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { refreshed, indexable, changed };
}

/**
 * `changed`: the page is indexable and either newly so or showing new progress (a new episode,
 * a new season, finished), i.e. worth re-rendering and announcing to search engines. A source
 * relabelling or re-uploading what it had is not a change. Null when the title does not exist.
 */
async function refreshTitle(db: Db, id: number): Promise<{ indexable: boolean; changed: boolean } | null> {
  const t = await db.first<TitleRow>(
    "SELECT id, name, status, poster_path, overview, indexable, latest_label, source_updated_at FROM titles WHERE id = ?",
    [id],
  );
  if (!t) return null;
  const active = SOURCES.map((s) => s.id);
  // The playable rows of sources still in use: they alone say how far the title is.
  const rows = await db.all<SourceLabel & { source_id: string }>(
    `SELECT source_id, remarks, vod_time, season_number FROM source_items
     WHERE title_id = ? AND match_status = 'matched' AND episode_count > 0
       AND source_id IN (${active.map(() => "?").join(",")})`,
    [id, ...active],
  );
  const progress = sourceProgress(rows);
  const ok =
    t.status === "active" &&
    isPublishableName(t.name) &&
    Boolean(t.poster_path) &&
    (t.overview?.trim().length ?? 0) >= MIN_OVERVIEW_LENGTH &&
    rows.length > 0;
  await db.run(
    `UPDATE titles SET latest_label = ?, source_updated_at = ?, indexable = ?, source_count = ?,
       published_at = CASE WHEN ? = 1 THEN COALESCE(published_at, datetime('now')) ELSE published_at END
     WHERE id = ?`,
    [progress.label, progress.since, ok ? 1 : 0, new Set(rows.map((r) => r.source_id)).size, ok ? 1 : 0, id],
  );
  const progressed = !sameProgress(t.latest_label, progress.label) && (progress.since ?? "") > (t.source_updated_at ?? "");
  return { indexable: ok, changed: ok && (t.indexable !== 1 || progressed) };
}
