import "server-only";
import { cache } from "react";
import { cachedQuery, TAG } from "@/lib/data/cache";
import { getDb } from "@/lib/db/server";
import type { BrowseFilters } from "@/lib/domain/filters";
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

// id is the TMDB person id; null for titles built from source metadata.
export interface CastMember {
  id: number | null;
  name: string;
  character: string | null;
  profile: string | null;
}

export interface CrewMember {
  id: number | null;
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

export const CARD_COLUMNS = "t.id, t.kind, t.name, t.year, t.poster_path, t.latest_label, t.vote_average, s.slug";
export const CARD_JOIN = "FROM titles t JOIN slugs s ON s.title_id = t.id AND s.is_canonical = 1";

export const PAGE_SIZE = 36;

export function latestByKind(kind: Kind | null, limit: number, offset = 0): Promise<TitleCard[]> {
  return cachedQuery(["latest", kind, limit, offset], [TAG.catalog], 900, async () => (await getDb()).all<TitleCard>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOIN}
     WHERE t.indexable = 1 ${kind ? "AND t.kind = ?" : ""}
     ORDER BY t.source_updated_at DESC, t.id DESC LIMIT ? OFFSET ?`,
    kind ? [kind, limit, offset] : [limit, offset],
  ));
}

export function popularByKind(kind: Kind, limit: number): Promise<TitleCard[]> {
  return cachedQuery(["popular", kind, limit], [TAG.catalog], 900, async () => (await getDb()).all<TitleCard>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOIN}
     WHERE t.indexable = 1 AND t.kind = ? ORDER BY t.popularity DESC LIMIT ?`,
    [kind, limit],
  ));
}

/**
 * Filtered channel listing. Returns one extra row to signal "has next page" instead of
 * counting the filtered set.
 */
export function browseTitles(kind: Kind, f: BrowseFilters, limit: number, offset: number): Promise<{ titles: TitleCard[]; hasMore: boolean }> {
  return cachedQuery(["browse", kind, f.genre, f.region, f.year, f.sort, limit, offset], [TAG.catalog], 900, () => browseQuery(kind, f, limit, offset));
}

async function browseQuery(kind: Kind, f: BrowseFilters, limit: number, offset: number): Promise<{ titles: TitleCard[]; hasMore: boolean }> {
  const db = await getDb();
  const where = ["t.indexable = 1", "t.kind = ?"];
  const params: (string | number)[] = [kind];
  if (f.genre) {
    where.push("t.genres LIKE ?");
    params.push(`%"${f.genre}"%`);
  }
  if (f.region) {
    where.push("t.countries LIKE ?");
    params.push(`%"${f.region}"%`);
  }
  if (f.year === "older") where.push("t.year < 2010");
  else if (f.year === "2010s") where.push("t.year BETWEEN 2010 AND 2019");
  else if (f.year) {
    where.push("t.year = ?");
    params.push(Number(f.year));
  }
  if (f.sort === "rating") where.push("t.vote_count >= 50");
  const order =
    f.sort === "hot" ? "t.popularity DESC" : f.sort === "rating" ? "t.vote_average DESC, t.vote_count DESC" : "t.source_updated_at DESC, t.id DESC";
  const rows = await db.all<TitleCard>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOIN} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, limit + 1, offset],
  );
  return { titles: rows.slice(0, limit), hasMore: rows.length > limit };
}

export interface FollowCard extends TitleCard {
  next_episode_date: string | null;
  next_episode_number: number | null;
  next_episode_season: number | null;
  tv_status: string | null;
}

/** Cards for a list of ids (followed titles). D1 caps bound parameters at 100. */
export function titlesByIds(ids: number[]): Promise<FollowCard[]> {
  const list = [...new Set(ids)].sort((a, b) => a - b).slice(0, 90);
  return cachedQuery(["byIds", list.join(",")], [TAG.catalog], 600, async () => (await getDb()).all<FollowCard>(
    `SELECT ${CARD_COLUMNS}, t.next_episode_date, t.next_episode_number, t.next_episode_season, t.tv_status ${CARD_JOIN}
     WHERE t.id IN (${list.map(() => "?").join(",")}) AND t.status = 'active'`,
    list,
  ));
}

export interface FeaturedCard extends TitleCard {
  backdrop_path: string;
  overview: string | null;
  genres: string;
  tmdb_type: "movie" | "tv";
}

/** Hero slides: popular titles with a backdrop that got new episodes/lines recently. */
export function featuredTitles(limit: number): Promise<FeaturedCard[]> {
  return cachedQuery(["featured", limit], [TAG.catalog], 900, async () => (await getDb()).all<FeaturedCard>(
    `SELECT ${CARD_COLUMNS}, t.backdrop_path, t.overview, t.genres, t.tmdb_type ${CARD_JOIN}
     WHERE t.indexable = 1 AND t.backdrop_path IS NOT NULL AND t.source_updated_at >= datetime('now', '-10 days')
     ORDER BY t.popularity DESC LIMIT ?`,
    [limit],
  ));
}

/** Well-rated titles with enough votes to mean something. */
export function topRated(limit: number): Promise<TitleCard[]> {
  return cachedQuery(["topRated", limit], [TAG.catalog], 3600, async () => (await getDb()).all<TitleCard>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOIN}
     WHERE t.indexable = 1 AND t.vote_count >= 200 AND t.vote_average >= 7.5
     ORDER BY t.vote_average DESC, t.vote_count DESC LIMIT ?`,
    [limit],
  ));
}

export interface UpcomingCard extends TitleCard {
  next_episode_date: string;
  next_episode_season: number | null;
  next_episode_number: number | null;
}

/** Series with an episode airing in the next `days` days (the 追剧 calendar). */
export function upcomingEpisodes(days: number, limit: number): Promise<UpcomingCard[]> {
  return cachedQuery(["upcoming", days, limit], [TAG.catalog], 900, () => upcomingQuery(days, limit));
}

async function upcomingQuery(days: number, limit: number): Promise<UpcomingCard[]> {
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
export function relatedTitles(t: { id: number; kind: Kind; genres: string[] }, limit: number): Promise<TitleCard[]> {
  const genre = t.genres[0] ?? null;
  return cachedQuery(["related", t.id, t.kind, genre, limit], [TAG.related], 86400, async () => (await getDb()).all<TitleCard>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOIN}
     WHERE t.indexable = 1 AND t.kind = ? AND t.id <> ? ${genre ? "AND t.genres LIKE ?" : ""}
     ORDER BY t.popularity DESC LIMIT ?`,
    genre ? [t.kind, t.id, `%"${genre}"%`, limit] : [t.kind, t.id, limit],
  ));
}

/** Catalog sizes precomputed by the ingest run (falls back to counting if never stored). */
export function storedCount(key: string, fallbackSql: string, params: (string | number)[]): Promise<number> {
  return cachedQuery(["count", key], [TAG.catalog], 900, () => countQuery(key, fallbackSql, params));
}

async function countQuery(key: string, fallbackSql: string, params: (string | number)[]): Promise<number> {
  const db = await getDb();
  const stored = await db.first<{ value: string }>("SELECT value FROM sync_state WHERE key = ?", [`count:${key}`]);
  if (stored) return Number(stored.value);
  return (await db.first<{ n: number }>(fallbackSql, params))?.n ?? 0;
}

export function countByKind(kind: Kind): Promise<number> {
  return storedCount(kind, "SELECT COUNT(*) AS n FROM titles WHERE indexable = 1 AND kind = ?", [kind]);
}

/** Slug lookup. Returns the title plus whether this slug is its canonical one. */
export const resolveSlug = cache(async (slug: string): Promise<{ title: TitleDetail; canonicalSlug: string; isCanonical: boolean } | null> => {
  const hit = await cachedQuery(["slug", slug], [TAG.slugs], 86400, async () =>
    (await getDb()).first<{ title_id: number; is_canonical: number }>("SELECT title_id, is_canonical FROM slugs WHERE slug = ?", [slug]),
  );
  if (!hit) return null;
  const title = await getTitle(hit.title_id);
  if (!title) return null;
  return { title, canonicalSlug: title.slug, isCanonical: hit.is_canonical === 1 };
});

export const getTitle = cache(async (id: number): Promise<TitleDetail | null> => {
  const row = await cachedQuery(["title", id], [TAG.title(id)], 3600, async () =>
    (await getDb()).first<Record<string, unknown>>(`SELECT t.*, s.slug ${CARD_JOIN} WHERE t.id = ?`, [id]),
  );
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

export const getSeasons = cache((titleId: number): Promise<Season[]> =>
  cachedQuery(["seasons", titleId], [TAG.title(titleId)], 3600, async () =>
    (await getDb()).all<Season>(
      "SELECT season_number, name, overview, air_date, episode_count, poster_path FROM seasons WHERE title_id = ? ORDER BY season_number",
      [titleId],
    ),
  ),
);

/**
 * Playable lines for a title, in source priority order. Series rows without a season
 * marker belong to season 1.
 */
export const getLines = cache(async (titleId: number, tmdbType: "movie" | "tv"): Promise<Line[]> => {
  const rows = await cachedQuery(["lines", titleId], [TAG.title(titleId)], 1800, async () =>
    (await getDb()).all<{ source_id: string; season_number: number | null; remarks: string | null; vod_time: string | null; play_from: string | null; play_url: string | null }>(
      `SELECT source_id, season_number, remarks, vod_time, play_from, play_url FROM source_items
       WHERE title_id = ? AND match_status = 'matched' AND episode_count > 0`,
      [titleId],
    ),
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
  const q = query.trim();
  // Prefix range on the alias index: exact and "starts with" hits, both scripts.
  return cachedQuery(["search", key, q, limit], [TAG.catalog], 3600, async () => (await getDb()).all<TitleCard>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOIN}
     WHERE t.id IN (SELECT title_id FROM aliases WHERE norm >= ? AND norm < ?) AND +t.indexable = 1
     ORDER BY (t.name = ?) DESC, t.popularity DESC LIMIT ?`,
    [key, `${key}\u{10FFFF}`, q, limit],
  ));
}

export interface SitemapEntry {
  kind: Kind;
  slug: string;
  updated_at: string;
  source_updated_at: string | null;
}

export function sitemapTitles(offset: number, limit: number): Promise<SitemapEntry[]> {
  return cachedQuery(["sitemap", offset, limit], [TAG.catalog], 3600, async () => (await getDb()).all<SitemapEntry>(
    `SELECT t.kind, s.slug, t.updated_at, t.source_updated_at ${CARD_JOIN}
     WHERE t.indexable = 1 ORDER BY t.id LIMIT ? OFFSET ?`,
    [limit, offset],
  ));
}

/**
 * Titles whose sources changed in the last two weeks, newest first: a small sitemap with
 * accurate lastmod so new episodes and new titles are re-crawled quickly.
 */
export function recentSitemapTitles(limit: number): Promise<SitemapEntry[]> {
  return cachedQuery(["sitemap-recent", limit], [TAG.catalog], 3600, async () => (await getDb()).all<SitemapEntry>(
    `SELECT t.kind, s.slug, t.updated_at, t.source_updated_at ${CARD_JOIN}
     WHERE t.indexable = 1 AND t.source_updated_at >= datetime('now', '-14 days')
     ORDER BY t.source_updated_at DESC LIMIT ?`,
    [limit],
  ));
}

export function countIndexable(): Promise<number> {
  return storedCount("all", "SELECT COUNT(*) AS n FROM titles WHERE indexable = 1", []);
}
