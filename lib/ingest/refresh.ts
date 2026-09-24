import type { Db } from "@/lib/db/types";
import type { Kind } from "@/lib/domain/kinds";
import { TmdbClient, TmdbNotFound, type TmdbType } from "@/lib/tmdb/client";
import { upsertTitleFromTmdb } from "./titles";

/**
 * Re-pulls TMDB for series that are still airing, so next-episode dates, new seasons and
 * episode counts stay current. Oldest-synced first; each title at most once per ~20h.
 */
export async function refreshAiringSeries(db: Db, tmdb: TmdbClient, limit: number): Promise<{ refreshed: number; ids: number[] }> {
  const rows = await db.all<{ id: number; kind: Kind; tmdb_type: TmdbType; tmdb_id: number }>(
    `SELECT id, kind, tmdb_type, tmdb_id FROM titles
     WHERE status = 'active' AND tmdb_type = 'tv' AND tmdb_id IS NOT NULL
       AND (tv_status IS NULL OR tv_status IN ('Returning Series', 'In Production', 'Planned', 'Pilot'))
       AND (tmdb_synced_at IS NULL OR tmdb_synced_at < datetime('now', '-20 hours'))
     ORDER BY tmdb_synced_at ASC LIMIT ?`,
    [limit],
  );
  const ids: number[] = [];
  const queue = [...rows];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      try {
        const details = await tmdb.details(row.tmdb_type, row.tmdb_id);
        await upsertTitleFromTmdb(db, details, row.tmdb_type, row.kind);
        ids.push(row.id);
      } catch (err) {
        if (!(err instanceof TmdbNotFound)) throw err;
        // Gone from TMDB: keep the page, just stop retrying for a day.
        await db.run("UPDATE titles SET tmdb_synced_at = datetime('now') WHERE id = ?", [row.id]);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return { refreshed: ids.length, ids };
}
