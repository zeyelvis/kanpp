import type { Db } from "@/lib/db/types";
import type { Kind } from "@/lib/domain/kinds";
import { scoreMatch, type CandidateSignal, type MatchResult, type SourceSignal } from "@/lib/domain/match";
import { cleanDisplayName, normalizeKey, splitPeople, stripGluedYear } from "@/lib/domain/normalize";
import { matchConflict, MAX_FILM_EPISODES } from "@/lib/domain/match-guard";
import { hasAdultSignal, isCommentary } from "@/lib/domain/safety";
import { extractSeason, trailingSeason } from "@/lib/domain/season";
import { classifyCategory } from "@/lib/sources/categories";
import { TmdbClient, type TmdbDetails, type TmdbType } from "@/lib/tmdb/client";
import { toSimplified, toTraditional } from "./chinese";
import { aliasesFromDetails, chineseName, peopleFromDetails, upsertTitleFromTmdb, yearOf } from "./titles";

interface PendingRow {
  source_id: string;
  vod_id: string;
  vod_name: string;
  vod_year: number | null;
  type_name: string | null;
  douban_id: string | null;
  actor: string | null;
  director: string | null;
  episode_count: number | null;
}

type Outcome =
  | { status: "matched"; titleId: number; season: number | null; score: number; note: string }
  | { status: "review" | "unmatched" | "rejected"; score?: number; note: string };

export interface ResolveStats {
  processed: number;
  matched: number;
  created: number;
  review: number;
  unmatched: number;
  rejected: number;
  touchedTitleIds: Set<number>;
}

/** Annotations are stripped before the season marker is read ("第2季国语" -> season 2). */
export function parseSourceName(vodName: string, year: number | null): { base: string; season: number | null } {
  return extractSeason(cleanDisplayName(toSimplified(vodName), year));
}

export function sourceSignal(row: PendingRow, category: { kind: Kind; tmdbType: TmdbType }): { signal: SourceSignal; base: string } {
  const { base, season } = parseSourceName(row.vod_name, row.vod_year);
  const key = normalizeKey(base);
  const keys = [...new Set([key, stripGluedYear(key, row.vod_year)])].filter(Boolean);
  const people = [...splitPeople(row.actor), ...splitPeople(row.director)].map(toSimplified);
  return {
    signal: { keys, season, year: row.vod_year, tmdbType: category.tmdbType, people, ongoing: category.kind === "variety" },
    base,
  };
}

export function candidateFromDetails(d: TmdbDetails, type: TmdbType): CandidateSignal {
  const { cast, crew } = peopleFromDetails(d);
  return {
    keys: new Set(aliasesFromDetails(d, chineseName(d)).map((a) => a.norm)),
    year: yearOf(d.release_date || d.first_air_date),
    seasonYears: new Map(
      (d.seasons ?? []).filter((s) => s.season_number > 0 && yearOf(s.air_date)).map((s) => [s.season_number, yearOf(s.air_date)!]),
    ),
    tmdbType: type,
    people: [...cast, ...crew].map((p) => p.name),
  };
}

async function candidateFromDb(db: Db, titleId: number): Promise<CandidateSignal | null> {
  const t = await db.first<{ year: number | null; tmdb_type: TmdbType; cast_json: string; crew_json: string; status: string }>(
    "SELECT year, tmdb_type, cast_json, crew_json, status FROM titles WHERE id = ?",
    [titleId],
  );
  if (!t || t.status !== "active") return null;
  const aliases = await db.all<{ norm: string }>("SELECT norm FROM aliases WHERE title_id = ?", [titleId]);
  const seasons = await db.all<{ season_number: number; air_date: string | null }>("SELECT season_number, air_date FROM seasons WHERE title_id = ?", [titleId]);
  const people = [...(JSON.parse(t.cast_json) as { name: string }[]), ...(JSON.parse(t.crew_json) as { name: string }[])].map((p) => p.name);
  return {
    keys: new Set(aliases.map((a) => a.norm)),
    year: t.year,
    seasonYears: new Map(seasons.filter((s) => yearOf(s.air_date)).map((s) => [s.season_number, yearOf(s.air_date)!])),
    tmdbType: t.tmdb_type,
    people,
  };
}

export class Resolver {
  private detailsCache = new Map<string, Promise<TmdbDetails>>();
  private searchCache = new Map<string, Promise<{ id: number; key: string }[]>>();

  constructor(
    private readonly db: Db,
    private readonly tmdb: TmdbClient,
  ) {}

  private details(type: TmdbType, id: number) {
    const k = `${type}:${id}`;
    if (!this.detailsCache.has(k)) this.detailsCache.set(k, this.tmdb.details(type, id));
    return this.detailsCache.get(k)!;
  }

  private search(type: TmdbType, query: string, year: number | null) {
    const k = `${type}:${query}:${year ?? ""}`;
    if (!this.searchCache.has(k)) {
      this.searchCache.set(
        k,
        this.tmdb.search(type, query, year).then((rs) =>
          rs.filter((r) => !r.adult).slice(0, 6).map((r) => ({ id: r.id, key: normalizeKey(toSimplified(r.title ?? r.name ?? "")) })),
        ),
      );
    }
    return this.searchCache.get(k)!;
  }

  async resolveRow(row: PendingRow): Promise<Outcome & { created?: boolean }> {
    let category = classifyCategory(row.type_name, row.vod_name);
    if (!category) return { status: "rejected", note: "category" };
    // A "film" category with dozens of episodes is a series filed under the wrong category
    // (长安的荔枝, 37 episodes under 喜剧片): match it as one.
    if (category.tmdbType === "movie" && (row.episode_count ?? 0) > MAX_FILM_EPISODES) category = { kind: "tv", tmdbType: "tv" };
    if (hasAdultSignal(row.vod_name) || isCommentary(row.vod_name)) return { status: "rejected", note: "name-policy" };
    const { signal, base } = sourceSignal(row, category);
    if (signal.keys.length === 0) return { status: "unmatched", note: "empty-name" };

    // 1. A douban subject we have seen before, unless the row is implausible for its title
    //    (sources sometimes carry another work's douban id): then match by name instead.
    if (row.douban_id) {
      const ext = await this.db.first<{ title_id: number; season_number: number | null }>(
        "SELECT title_id, season_number FROM external_ids WHERE provider = 'douban' AND external_id = ?",
        [row.douban_id],
      );
      if (ext && !(await this.doubanConflict(ext.title_id, row, category, signal))) {
        return { status: "matched", titleId: ext.title_id, season: ext.season_number ?? signal.season, score: 1, note: "douban" };
      }
    }

    const outcome = await this.match(row, category, signal, base);
    if (outcome.status === "matched" || category.tmdbType !== "tv" || signal.season != null) return outcome;
    // "乡村爱情18", "同床异梦2": nothing carries the full name, so read the number as the season.
    const numbered = trailingSeason(base);
    if (!numbered) return outcome;
    const retry = await this.match(row, category, { ...signal, keys: [normalizeKey(numbered.base)], season: numbered.season }, numbered.base);
    return retry.status === "matched" ? { ...retry, note: `${retry.note} trailing-season` } : outcome;
  }

  /** Local registry by exact alias, then TMDB. */
  private async match(
    row: PendingRow,
    category: { kind: Kind; tmdbType: TmdbType },
    signal: SourceSignal,
    base: string,
  ): Promise<Outcome & { created?: boolean }> {
    // 2. Titles already in the registry under the same exact name.
    const local = await this.db.all<{ title_id: number }>(
      `SELECT DISTINCT title_id FROM aliases WHERE norm IN (${signal.keys.map(() => "?").join(",")})`,
      signal.keys,
    );
    let best: { titleId: number; result: MatchResult } | null = null;
    for (const { title_id } of local) {
      const cand = await candidateFromDb(this.db, title_id);
      if (!cand) continue;
      const result = scoreMatch(signal, cand);
      // A film under the same name is not this row when the row cannot be that film.
      if (result.decision === "same" && cand.tmdbType === "movie" && (await this.doubanConflict(title_id, row, category, signal))) continue;
      if (!best || result.score > best.result.score) best = { titleId: title_id, result };
    }
    if (best?.result.decision === "same") {
      await this.rememberDouban(row.douban_id, best.titleId, signal.season);
      return { status: "matched", titleId: best.titleId, season: signal.season, score: best.result.score, note: `local ${best.result.reasons.join(" ")}` };
    }

    // 3. TMDB. Films search with the year; series only when no later season is implied.
    const type = category.tmdbType;
    const searchYear = type === "movie" ? signal.year : signal.season && signal.season > 1 ? null : signal.year;
    let hits = await this.search(type, base, searchYear);
    if (hits.length === 0 && searchYear) hits = await this.search(type, base, null);
    if (hits.length === 0) hits = await this.search(type, toTraditional(base), null);

    let tmdbBest: { details: TmdbDetails; result: MatchResult } | null = null;
    // Details are fetched for exact-name hits first, then the top results (alias check).
    const ordered = [...hits.filter((h) => signal.keys.includes(h.key)), ...hits.filter((h) => !signal.keys.includes(h.key))].slice(0, 3);
    for (const hit of ordered) {
      const details = await this.details(type, hit.id).catch(() => null);
      if (!details) continue;
      const result = scoreMatch(signal, candidateFromDetails(details, type));
      if (!tmdbBest || result.score > tmdbBest.result.score) tmdbBest = { details, result };
      if (result.decision === "same" && result.score >= 0.9) break;
    }

    if (tmdbBest?.result.decision === "same") {
      if (tmdbBest.details.adult || tmdbBest.details.softcore) return { status: "rejected", note: `tmdb-adult ${type}:${tmdbBest.details.id}` };
      const { id, created } = await upsertTitleFromTmdb(this.db, tmdbBest.details, type, category.kind as Kind);
      await this.rememberDouban(row.douban_id, id, signal.season);
      return { status: "matched", titleId: id, season: signal.season, score: tmdbBest.result.score, note: `tmdb:${type}:${tmdbBest.details.id} ${tmdbBest.result.reasons.join(" ")}`, created };
    }

    const reviewCand = [best && { note: `local:${best.titleId}`, r: best.result }, tmdbBest && { note: `tmdb:${type}:${tmdbBest.details.id}`, r: tmdbBest.result }]
      .filter((x): x is { note: string; r: MatchResult } => Boolean(x))
      .sort((a, b) => b.r.score - a.r.score)[0];
    if (reviewCand?.r.decision === "review") {
      return { status: "review", score: reviewCand.r.score, note: `${reviewCand.note} ${reviewCand.r.reasons.join(" ")}` };
    }
    return { status: "unmatched", score: reviewCand?.r.score, note: reviewCand ? `${reviewCand.note} ${reviewCand.r.reasons.join(" ")}` : `no-tmdb-hit q=${base}` };
  }

  /** Why the row cannot belong to the title (lib/domain/match-guard.ts), used for douban and local matches. */
  private async doubanConflict(titleId: number, row: PendingRow, category: { kind: Kind }, signal: SourceSignal): Promise<string | null> {
    const t = await this.db.first<{ name: string; tmdb_type: TmdbType; year: number | null; genres: string }>(
      "SELECT name, tmdb_type, year, genres FROM titles WHERE id = ?",
      [titleId],
    );
    if (!t) return "no-title";
    const aliases = await this.db.all<{ norm: string }>("SELECT norm FROM aliases WHERE title_id = ?", [titleId]);
    return matchConflict(
      { name: t.name, film: t.tmdb_type === "movie", documentary: t.genres.includes("纪录"), year: t.year, keys: new Set(aliases.map((a) => a.norm)) },
      { kind: category.kind, name: row.vod_name, keys: signal.keys, year: row.vod_year, episodes: row.episode_count },
    );
  }

  private async rememberDouban(doubanId: string | null, titleId: number, season: number | null) {
    if (!doubanId) return;
    await this.db.run(
      "INSERT OR IGNORE INTO external_ids (provider, external_id, title_id, season_number) VALUES ('douban', ?, ?, ?)",
      [doubanId, titleId, season],
    );
  }

  async resolvePending(options: { limit: number; concurrency?: number; onProgress?: (s: ResolveStats) => void }): Promise<ResolveStats> {
    const rows = await this.db.all<PendingRow>(
      `SELECT source_id, vod_id, vod_name, vod_year, type_name, douban_id, actor, director, episode_count
       FROM source_items WHERE match_status = 'pending' ORDER BY vod_time DESC LIMIT ?`,
      [options.limit],
    );
    const stats: ResolveStats = { processed: 0, matched: 0, created: 0, review: 0, unmatched: 0, rejected: 0, touchedTitleIds: new Set() };
    // Rows naming the same work are handled by one worker in sequence, so the first row
    // creates the title and the rest match it locally instead of racing on TMDB.
    const groups = new Map<string, PendingRow[]>();
    for (const row of rows) {
      const key = row.douban_id ? `d:${row.douban_id}` : `n:${normalizeKey(parseSourceName(row.vod_name, row.vod_year).base)}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const queue = [...groups.values()];
    const worker = async () => {
      for (let group = queue.shift(); group; group = queue.shift()) {
        for (const row of group) {
          let outcome: Awaited<ReturnType<Resolver["resolveRow"]>>;
          try {
            outcome = await this.resolveRow(row);
          } catch (err) {
            outcome = { status: "unmatched", note: `error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200) };
          }
          await this.db.run(
            `UPDATE source_items SET match_status = ?, title_id = ?, season_number = ?, match_score = ?, match_note = ?
             WHERE source_id = ? AND vod_id = ?`,
            [
              outcome.status,
              outcome.status === "matched" ? outcome.titleId : null,
              outcome.status === "matched" ? outcome.season : null,
              outcome.score ?? null,
              outcome.note.slice(0, 300),
              row.source_id,
              row.vod_id,
            ],
          );
          stats.processed++;
          stats[outcome.status]++;
          if (outcome.status === "matched") {
            stats.touchedTitleIds.add(outcome.titleId);
            if (outcome.created) stats.created++;
          }
          if (stats.processed % 25 === 0) options.onProgress?.(stats);
        }
      }
    };
    await Promise.all(Array.from({ length: options.concurrency ?? 4 }, worker));
    return stats;
  }
}
