import type { Db, SqlValue, Statement } from "@/lib/db/types";
import { cleanDoubanId, cleanYear, type CmsItem } from "@/lib/sources/cms";
import { classifyCategory } from "@/lib/sources/categories";
import { pickHlsEpisodes } from "@/lib/sources/playurl";

export type SkipReason = "category-blocked" | "category-unknown" | "no-name";

export interface PreparedRow {
  params: SqlValue[];
  vodId: string;
}

/** Validates a CMS row and turns it into insert params, or says why it is skipped. */
export function prepareSourceRow(sourceId: string, item: CmsItem): PreparedRow | { skip: SkipReason } {
  const name = String(item.vod_name ?? "").trim();
  if (!name) return { skip: "no-name" };
  const category = classifyCategory(item.type_name, name);
  if (category === null) return { skip: "category-blocked" };
  if (category === undefined) return { skip: "category-unknown" };

  const vodId = String(item.vod_id);
  const episodes = pickHlsEpisodes(item.vod_play_from, item.vod_play_url);
  return {
    vodId,
    params: [
      sourceId,
      vodId,
      name,
      item.vod_sub?.trim() || null,
      cleanYear(item.vod_year),
      item.type_name?.trim() || null,
      item.vod_area?.trim() || null,
      item.vod_lang?.trim() || null,
      cleanDoubanId(item.vod_douban_id),
      item.vod_remarks?.trim() || null,
      item.vod_time?.trim() || null,
      item.vod_pic?.trim() || null,
      item.vod_actor?.trim() || null,
      item.vod_director?.trim() || null,
      item.vod_play_from ?? null,
      item.vod_play_url ?? null,
      episodes.length,
    ],
  };
}

// A renamed row or a changed douban id may now be a different work, so it is re-resolved.
const UPSERT_SQL = `
INSERT INTO source_items (source_id, vod_id, vod_name, vod_sub, vod_year, type_name, area, lang, douban_id,
  remarks, vod_time, pic, actor, director, play_from, play_url, episode_count)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (source_id, vod_id) DO UPDATE SET
  match_status = CASE WHEN excluded.vod_name <> source_items.vod_name
    OR IFNULL(excluded.douban_id, '') <> IFNULL(source_items.douban_id, '') THEN 'pending' ELSE source_items.match_status END,
  title_id = CASE WHEN excluded.vod_name <> source_items.vod_name
    OR IFNULL(excluded.douban_id, '') <> IFNULL(source_items.douban_id, '') THEN NULL ELSE source_items.title_id END,
  season_number = CASE WHEN excluded.vod_name <> source_items.vod_name
    OR IFNULL(excluded.douban_id, '') <> IFNULL(source_items.douban_id, '') THEN NULL ELSE source_items.season_number END,
  vod_name = excluded.vod_name, vod_sub = excluded.vod_sub, vod_year = excluded.vod_year,
  type_name = excluded.type_name, area = excluded.area, lang = excluded.lang, douban_id = excluded.douban_id,
  remarks = excluded.remarks, vod_time = excluded.vod_time, pic = excluded.pic, actor = excluded.actor,
  director = excluded.director, play_from = excluded.play_from, play_url = excluded.play_url,
  episode_count = excluded.episode_count, last_seen_at = datetime('now')`;

export interface UpsertStats {
  written: number;
  skipped: Partial<Record<SkipReason, number>>;
  touchedTitleIds: number[];
}

export async function upsertSourceRows(db: Db, sourceId: string, items: CmsItem[]): Promise<UpsertStats> {
  const stats: UpsertStats = { written: 0, skipped: {}, touchedTitleIds: [] };
  const statements: Statement[] = [];
  const vodIds: string[] = [];
  for (const item of items) {
    const prepared = prepareSourceRow(sourceId, item);
    if ("skip" in prepared) {
      stats.skipped[prepared.skip] = (stats.skipped[prepared.skip] ?? 0) + 1;
      continue;
    }
    statements.push({ sql: UPSERT_SQL, params: prepared.params });
    vodIds.push(prepared.vodId);
  }
  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50));
  }
  stats.written = statements.length;
  if (vodIds.length > 0) {
    const rows = await db.all<{ title_id: number }>(
      `SELECT DISTINCT title_id FROM source_items
       WHERE source_id = ? AND title_id IS NOT NULL AND vod_id IN (${vodIds.map(() => "?").join(",")})`,
      [sourceId, ...vodIds],
    );
    stats.touchedTitleIds = rows.map((r) => r.title_id);
  }
  return stats;
}
