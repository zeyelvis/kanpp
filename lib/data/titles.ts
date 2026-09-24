import "server-only";
import { cache } from "react";
import { getDb } from "@/lib/db/server";
import type { Kind } from "@/lib/domain/kinds";
import { isNextEpisodeAhead } from "@/lib/domain/labels";
import { normalizeKey } from "@/lib/domain/normalize";
import { pickHlsEpisodes, type Episode } from "@/lib/sources/playurl";
import { getSource } from "@/lib/sources/registry";

export interface TitleCard {
  id: number;
  kind: Kind;
  name: string;
  year: number | null;
  poster_path: string | null;
  latest_label: string | null;
  vote_average: number | null;
  slug: string;
}

export interface CastMember {
  id: number;
  name: string;
  character: string | null;
  profile: string | null;
}

export interface CrewMember {
  id: number;
  name: string;
  job: string;
}

export interface TitleDetail extends TitleCard {
  original_name: string | null;
  tmdb_type: "movie" | "tv";
  tmdb_id: number | null;
  imdb_id: string | null;
  overview: string | null;
  tagline: string | null;
  backdrop_path: string | null;
  genres: string[];
  countries: string[];
  languages: string[];
  runtime: number | null;
  release_date: string | null;
  last_air_date: string | null;
  tv_status: string | null;
  number_of_seasons: number | null;
  number_of_episodes: number | null;
  next_episode_date: string | null;
  next_episode_season: number | null;
  next_episode_number: number | null;
  vote_count: number | null;
  cast: CastMember[];
  crew: CrewMember[];
  status: "active" | "hidden" | "merged" | "removed";
  merged_into: number | null;
  indexable: number;
  published_at: string | null;
  updated_at: string;
  source_updated_at: string | null;
}

export interface Season {
  season_number: number;
  name: string | null;
  overview: string | null;
  air_date: string | null;
  episode_count: number | null;
  poster_path: string | null;
}

export interface Line {
  sourceId: string;
  sourceName: string;
  adIntro: boolean;
  season: number | null;
  remarks: string | null;
  updatedAt: string | null;
  episodes: Episode[];
}

const CARD_COLUMNS = "t.id, t.kind, t.name, t.year, t.poster_path, t.latest_label, t.vote_average, s.slug";
const CARD_JOIN = "FROM titles t JOIN slugs s ON s.title_id = t.id AND s.is_canonical = 1";

export const PAGE_SIZE = 36;

export async function latestByKind(kind: Kind | null, limit: number, offset = 0): Promise<TitleCard[]> {
  const db = await getDb();
  return db.all<TitleCard>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOIN}
     WHERE t.indexable = 1 ${kind ? "AND t.kind = ?" : ""}
     ORDER BY t.source_updated_at DESC, t.id DESC LIMIT ? OFFSET ?`,
    kind ? [kind, limit, offset] : [limit, offset],
  );
}

export async function popularByKind(kind: Kind, limit: number): Promise<TitleCard[]> {
  const db = await getDb();
  return db.all<TitleCard>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOIN}
     WHERE t.indexable = 1 AND t.kind = ? ORDER BY t.popularity DESC LIMIT ?`,
    [kind, limit],
  );
}

export interface UpcomingCard extends TitleCard {
  next_episode_date: string;
  next_episode_season: number | null;
  next_episode_number: number | null;
}

/** Series with an episode airing in the next `days` days (the 追剧 calendar). */
export async function upcomingEpisodes(days: number, limit: number): Promise<UpcomingCard[]> {
  const db = await getDb();
  const rows = await db.all<UpcomingCard>(
    `SELECT ${CARD_COLUMNS}, t.next_episode_date, t.next_episode_season, t.next_episode_number ${CARD_JOIN}
     WHERE t.indexable = 1 AND t.next_episode_date BETWEEN date('now') AND date('now', ?)
     ORDER BY t.next_episode_date, t.popularity DESC LIMIT ?`,
    [`+${days} days`, limit * 2],
  );
  return rows.filter((t) => isNextEpisodeAhead(t)).slice(0, limit);
}

/** Same kind, sharing the first genre; the internal-link rail on title pages. */
export async function relatedTitles(t: { id: number; kind: Kind; genres: string[] }, limit: number): Promise<TitleCard[]> {
  const db = await getDb();
  const genre = t.genres[0];
  return db.all<TitleCard>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOIN}
     WHERE t.indexable = 1 AND t.kind = ? AND t.id <> ? ${genre ? "AND t.genres LIKE ?" : ""}
     ORDER BY t.popularity DESC LIMIT ?`,
    genre ? [t.kind, t.id, `%"${genre}"%`, limit] : [t.kind, t.id, limit],
  );
}

export async function countByKind(kind: Kind): Promise<number> {
  const db = await getDb();
  return (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM titles WHERE indexable = 1 AND kind = ?", [kind]))?.n ?? 0;
}

/** Slug lookup. Returns the title plus whether this slug is its canonical one. */
export const resolveSlug = cache(async (slug: string): Promise<{ title: TitleDetail; canonicalSlug: string; isCanonical: boolean } | null> => {
  const db = await getDb();
  const hit = await db.first<{ title_id: number; is_canonical: number }>("SELECT title_id, is_canonical FROM slugs WHERE slug = ?", [slug]);
  if (!hit) return null;
  const title = await getTitle(hit.title_id);
  if (!title) return null;
  return { title, canonicalSlug: title.slug, isCanonical: hit.is_canonical === 1 };
});

export const getTitle = cache(async (id: number): Promise<TitleDetail | null> => {
  const db = await getDb();
  const row = await db.first<Record<string, unknown>>(`SELECT t.*, s.slug ${CARD_JOIN} WHERE t.id = ?`, [id]);
  if (!row) return null;
  const json = <T,>(v: unknown): T => JSON.parse((v as string) || "[]") as T;
  return {
    ...(row as unknown as TitleDetail),
    genres: json<string[]>(row.genres),
    countries: json<string[]>(row.countries),
    languages: json<string[]>(row.languages),
    cast: json<CastMember[]>(row.cast_json),
    crew: json<CrewMember[]>(row.crew_json),
  };
});

export const getSeasons = cache(async (titleId: number): Promise<Season[]> => {
  const db = await getDb();
  return db.all<Season>(
    "SELECT season_number, name, overview, air_date, episode_count, poster_path FROM seasons WHERE title_id = ? ORDER BY season_number",
    [titleId],
  );
});

/**
 * Playable lines for a title, in source priority order. Series rows without a season
 * marker belong to season 1.
 */
export const getLines = cache(async (titleId: number, tmdbType: "movie" | "tv"): Promise<Line[]> => {
  const db = await getDb();
  const rows = await db.all<{ source_id: string; season_number: number | null; remarks: string | null; vod_time: string | null; play_from: string | null; play_url: string | null }>(
    `SELECT source_id, season_number, remarks, vod_time, play_from, play_url FROM source_items
     WHERE title_id = ? AND match_status = 'matched' AND episode_count > 0`,
    [titleId],
  );
  return rows
    .filter((r) => getSource(r.source_id)) // retired sources are not offered as lines
    .map((r) => ({
      sourceId: r.source_id,
      sourceName: getSource(r.source_id)!.name,
      adIntro: Boolean(getSource(r.source_id)!.adIntro),
      priority: getSource(r.source_id)!.priority,
      season: tmdbType === "tv" ? r.season_number ?? 1 : null,
      remarks: r.remarks,
      updatedAt: r.vod_time,
      episodes: pickHlsEpisodes(r.play_from, r.play_url),
    }))
    .filter((l) => l.episodes.length > 0)
    .sort((a, b) => a.priority - b.priority || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .map(({ priority: _p, ...line }) => line);
});

export async function searchTitles(query: string, limit = 48): Promise<TitleCard[]> {
  const key = normalizeKey(query);
  if (!key) return [];
  const db = await getDb();
  // Prefix range on the alias index: exact and "starts with" hits, both scripts.
  return db.all<TitleCard>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOIN}
     WHERE t.indexable = 1 AND t.id IN (SELECT title_id FROM aliases WHERE norm >= ? AND norm < ?)
     ORDER BY (t.name = ?) DESC, t.popularity DESC LIMIT ?`,
    [key, `${key}\u{10FFFF}`, query.trim(), limit],
  );
}

export interface SitemapEntry {
  kind: Kind;
  slug: string;
  updated_at: string;
  source_updated_at: string | null;
}

export async function sitemapTitles(offset: number, limit: number): Promise<SitemapEntry[]> {
  const db = await getDb();
  return db.all<SitemapEntry>(
    `SELECT t.kind, s.slug, t.updated_at, t.source_updated_at ${CARD_JOIN}
     WHERE t.indexable = 1 ORDER BY t.id LIMIT ? OFFSET ?`,
    [limit, offset],
  );
}

export async function countIndexable(): Promise<number> {
  const db = await getDb();
  return (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM titles WHERE indexable = 1"))?.n ?? 0;
}
