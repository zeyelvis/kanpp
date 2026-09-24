import type { Db } from "@/lib/db/types";
import { isPublishableName } from "@/lib/domain/safety";

export const MIN_OVERVIEW_LENGTH = 20;

interface TitleRow {
  id: number;
  name: string;
  status: string;
  poster_path: string | null;
  overview: string | null;
}

/**
 * Recomputes source-derived fields and the publish gate for the given titles.
 * A title is indexable only when it is active, has a clean Chinese name, a poster, a real
 * synopsis and at least one playable HLS line. Everything else stays out of search engines.
 */
export async function refreshTitles(db: Db, titleIds: Iterable<number>): Promise<{ refreshed: number; indexable: number }> {
  let refreshed = 0;
  let indexable = 0;
  for (const id of titleIds) {
    const t = await db.first<TitleRow>("SELECT id, name, status, poster_path, overview FROM titles WHERE id = ?", [id]);
    if (!t) continue;
    const latest = await db.first<{ remarks: string | null; vod_time: string | null }>(
      `SELECT remarks, vod_time FROM source_items WHERE title_id = ? AND match_status = 'matched'
       ORDER BY vod_time DESC LIMIT 1`,
      [id],
    );
    const playable = await db.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM source_items WHERE title_id = ? AND match_status = 'matched' AND episode_count > 0",
      [id],
    );
    const ok =
      t.status === "active" &&
      isPublishableName(t.name) &&
      Boolean(t.poster_path) &&
      (t.overview?.trim().length ?? 0) >= MIN_OVERVIEW_LENGTH &&
      (playable?.n ?? 0) > 0;
    await db.run(
      `UPDATE titles SET latest_label = ?, source_updated_at = ?, indexable = ?,
         published_at = CASE WHEN ? = 1 THEN COALESCE(published_at, datetime('now')) ELSE published_at END
       WHERE id = ?`,
      [latest?.remarks ?? null, latest?.vod_time ?? null, ok ? 1 : 0, ok ? 1 : 0, id],
    );
    refreshed++;
    if (ok) indexable++;
  }
  return { refreshed, indexable };
}
