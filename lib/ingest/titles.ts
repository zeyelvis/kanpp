import { createHash } from "node:crypto";
import type { Db, Statement } from "@/lib/db/types";
import type { Kind } from "@/lib/domain/kinds";
import { normalizeKey } from "@/lib/domain/normalize";
import { slugCandidates } from "@/lib/domain/slug";
import { GENRE_ZH, type TmdbDetails, type TmdbType } from "@/lib/tmdb/client";
import { toSimplified, toTraditional } from "./chinese";

const HAN = /[一-龥]/;
const CHINESE_REGIONS = new Set(["CN", "TW", "HK", "SG", "MO"]);

export interface AliasRow {
  norm: string;
  alias: string;
  lang: string;
}

/** Best simplified-Chinese display name TMDB offers, or null when there is none. */
export function chineseName(d: TmdbDetails): string | null {
  const primary = d.title ?? d.name ?? "";
  if (HAN.test(primary)) return toSimplified(primary).trim();
  const zh = d.translations?.translations.filter((t) => t.iso_639_1 === "zh") ?? [];
  for (const region of ["CN", "SG", "TW", "HK"]) {
    const t = zh.find((x) => x.iso_3166_1 === region);
    const n = t?.data.title || t?.data.name;
    if (n && HAN.test(n)) return toSimplified(n).trim();
  }
  const alt = d.alternative_titles?.titles ?? d.alternative_titles?.results ?? [];
  const altZh = alt.find((a) => CHINESE_REGIONS.has(a.iso_3166_1) && HAN.test(a.title));
  return altZh ? toSimplified(altZh.title).trim() : null;
}

function addAlias(out: Map<string, AliasRow>, alias: string | null | undefined, lang: string) {
  if (!alias) return;
  const display = alias.trim();
  if (!display) return;
  // Stored under the simplified key (what ingest matches on) and, for traditional input,
  // the raw key too, so searches typed in either script hit without OpenCC at runtime.
  for (const norm of new Set([normalizeKey(toSimplified(display)), normalizeKey(display)])) {
    if (norm && !out.has(norm)) out.set(norm, { norm, alias: display, lang });
  }
}

export function aliasesFromDetails(d: TmdbDetails, name: string | null): AliasRow[] {
  const out = new Map<string, AliasRow>();
  addAlias(out, name, "zh-Hans");
  if (name) addAlias(out, toTraditional(name), "zh-Hant");
  for (const t of d.translations?.translations ?? []) {
    if (t.iso_639_1 !== "zh") continue;
    addAlias(out, t.data.title || t.data.name, t.iso_3166_1 === "TW" || t.iso_3166_1 === "HK" ? "zh-Hant" : "zh-Hans");
  }
  for (const a of d.alternative_titles?.titles ?? d.alternative_titles?.results ?? []) {
    if (CHINESE_REGIONS.has(a.iso_3166_1) && HAN.test(a.title)) addAlias(out, a.title, "zh");
  }
  addAlias(out, d.original_title ?? d.original_name, "original");
  return [...out.values()];
}

export function yearOf(date: string | null | undefined): number | null {
  const y = Number((date ?? "").slice(0, 4));
  return y >= 1900 ? y : null;
}

export function peopleFromDetails(d: TmdbDetails): { cast: { id: number; name: string; character: string | null; profile: string | null }[]; crew: { id: number; name: string; job: string }[] } {
  const cast = (d.credits?.cast ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .slice(0, 12)
    .map((c) => ({ id: c.id, name: toSimplified(c.name), character: c.character ? toSimplified(c.character) : null, profile: c.profile_path ?? null }));
  const crew: { id: number; name: string; job: string }[] = [];
  for (const c of d.created_by ?? []) crew.push({ id: c.id, name: toSimplified(c.name), job: "主创" });
  for (const c of d.credits?.crew ?? []) {
    if (c.job === "Director" && crew.filter((x) => x.job === "导演").length < 3) crew.push({ id: c.id, name: toSimplified(c.name), job: "导演" });
    if ((c.job === "Screenplay" || c.job === "Writer") && crew.filter((x) => x.job === "编剧").length < 2) crew.push({ id: c.id, name: toSimplified(c.name), job: "编剧" });
  }
  return { cast, crew };
}

interface TitleFields {
  kind: Kind;
  name: string;
  original_name: string | null;
  year: number | null;
  tmdb_type: TmdbType;
  tmdb_id: number;
  imdb_id: string | null;
  overview: string | null;
  tagline: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: string;
  countries: string;
  languages: string;
  runtime: number | null;
  release_date: string | null;
  last_air_date: string | null;
  tv_status: string | null;
  number_of_seasons: number | null;
  number_of_episodes: number | null;
  next_episode_date: string | null;
  next_episode_season: number | null;
  next_episode_number: number | null;
  vote_average: number | null;
  vote_count: number | null;
  popularity: number | null;
  cast_json: string;
  crew_json: string;
}

export function titleFieldsFromDetails(d: TmdbDetails, type: TmdbType, kind: Kind): TitleFields {
  const name = chineseName(d);
  const { cast, crew } = peopleFromDetails(d);
  const date = d.release_date || d.first_air_date || null;
  return {
    kind,
    name: name ?? (d.title || d.name || d.original_title || d.original_name || "").trim(),
    original_name: (d.original_title ?? d.original_name ?? null) || null,
    year: yearOf(date),
    tmdb_type: type,
    tmdb_id: d.id,
    imdb_id: d.external_ids?.imdb_id || null,
    overview: d.overview ? toSimplified(d.overview).trim() : null,
    tagline: d.tagline ? toSimplified(d.tagline).trim() : null,
    poster_path: d.poster_path ?? null,
    backdrop_path: d.backdrop_path ?? null,
    genres: JSON.stringify((d.genres ?? []).map((g) => GENRE_ZH[g.id] ?? g.name)),
    countries: JSON.stringify(d.origin_country?.length ? d.origin_country : (d.production_countries ?? []).map((c) => c.iso_3166_1)),
    languages: JSON.stringify(d.spoken_languages?.length ? d.spoken_languages.map((l) => l.iso_639_1) : d.original_language ? [d.original_language] : []),
    runtime: d.runtime || d.episode_run_time?.[0] || null,
    release_date: date,
    last_air_date: d.last_air_date || null,
    tv_status: type === "tv" ? d.status ?? null : null,
    number_of_seasons: d.number_of_seasons ?? null,
    number_of_episodes: d.number_of_episodes ?? null,
    next_episode_date: d.next_episode_to_air?.air_date ?? null,
    next_episode_season: d.next_episode_to_air?.season_number ?? null,
    next_episode_number: d.next_episode_to_air?.episode_number ?? null,
    vote_average: d.vote_count ? d.vote_average ?? null : null,
    vote_count: d.vote_count ?? null,
    popularity: d.popularity ?? null,
    cast_json: JSON.stringify(cast),
    crew_json: JSON.stringify(crew),
  };
}

function contentHash(f: TitleFields): string {
  const { popularity: _p, vote_count: _c, ...stable } = f;
  return createHash("sha1").update(JSON.stringify(stable)).digest("hex").slice(0, 16);
}

const FIELD_NAMES = [
  "kind", "name", "original_name", "year", "tmdb_type", "tmdb_id", "imdb_id", "overview", "tagline",
  "poster_path", "backdrop_path", "genres", "countries", "languages", "runtime", "release_date", "last_air_date",
  "tv_status", "number_of_seasons", "number_of_episodes", "next_episode_date", "next_episode_season",
  "next_episode_number", "vote_average", "vote_count", "popularity", "cast_json", "crew_json",
] as const satisfies readonly (keyof TitleFields)[];

/**
 * Creates or refreshes the title for a TMDB entity. Idempotent: the (tmdb_type, tmdb_id)
 * unique index means a TMDB entity can never produce two titles.
 */
export async function upsertTitleFromTmdb(db: Db, d: TmdbDetails, type: TmdbType, kind: Kind): Promise<{ id: number; created: boolean }> {
  const fields = titleFieldsFromDetails(d, type, kind);
  const hash = contentHash(fields);
  const existing = await db.first<{ id: number; content_hash: string | null; kind: Kind }>(
    "SELECT id, content_hash, kind FROM titles WHERE tmdb_type = ? AND tmdb_id = ?",
    [type, d.id],
  );

  let id: number;
  let created = false;
  if (existing) {
    id = existing.id;
    // Kind is decided when the title is first created; later rows must not flip its URL.
    const updatable = FIELD_NAMES.filter((f) => f !== "kind" && f !== "tmdb_type" && f !== "tmdb_id");
    await db.run(
      `UPDATE titles SET ${updatable.map((f) => `${f} = ?`).join(", ")}, tmdb_synced_at = datetime('now'),
         updated_at = CASE WHEN content_hash IS ? THEN updated_at ELSE datetime('now') END, content_hash = ?
       WHERE id = ?`,
      [...updatable.map((f) => fields[f]), hash, hash, id],
    );
  } else {
    try {
      const res = await db.run(
        `INSERT INTO titles (${FIELD_NAMES.join(", ")}, content_hash, tmdb_synced_at)
         VALUES (${FIELD_NAMES.map(() => "?").join(", ")}, ?, datetime('now'))`,
        [...FIELD_NAMES.map((f) => fields[f]), hash],
      );
      id = res.lastRowId!;
      created = true;
    } catch (err) {
      // Lost a race with a concurrent worker creating the same TMDB entity.
      const again = await db.first<{ id: number }>("SELECT id FROM titles WHERE tmdb_type = ? AND tmdb_id = ?", [type, d.id]);
      if (!again) throw err;
      id = again.id;
    }
  }

  const statements: Statement[] = aliasesFromDetails(d, chineseName(d)).map((a) => ({
    sql: "INSERT OR IGNORE INTO aliases (title_id, norm, alias, lang) VALUES (?, ?, ?, ?)",
    params: [id, a.norm, a.alias, a.lang],
  }));
  for (const s of d.seasons ?? []) {
    if (s.season_number < 1) continue;
    statements.push({
      sql: `INSERT INTO seasons (title_id, season_number, name, overview, air_date, episode_count, poster_path)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (title_id, season_number) DO UPDATE SET name = excluded.name, overview = excluded.overview,
              air_date = excluded.air_date, episode_count = excluded.episode_count, poster_path = excluded.poster_path`,
      params: [id, s.season_number, s.name ? toSimplified(s.name) : null, s.overview ? toSimplified(s.overview) : null, s.air_date ?? null, s.episode_count ?? null, s.poster_path ?? null],
    });
  }
  if (fields.imdb_id) {
    statements.push({ sql: "INSERT OR IGNORE INTO external_ids (provider, external_id, title_id) VALUES ('imdb', ?, ?)", params: [fields.imdb_id, id] });
  }
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));

  await ensureCanonicalSlug(db, id, fields.name, fields.year);
  return { id, created };
}

/** Gives a title its first slug. Existing slugs are never touched. */
export async function ensureCanonicalSlug(db: Db, titleId: number, name: string, year: number | null): Promise<string> {
  const current = await db.first<{ slug: string }>("SELECT slug FROM slugs WHERE title_id = ? AND is_canonical = 1", [titleId]);
  if (current) return current.slug;
  for (const candidate of slugCandidates(name, year)) {
    const taken = await db.first("SELECT 1 FROM slugs WHERE slug = ?", [candidate]);
    if (taken) continue;
    try {
      await db.run("INSERT INTO slugs (slug, title_id, is_canonical) VALUES (?, ?, 1)", [candidate, titleId]);
      return candidate;
    } catch {
      // Either the candidate was taken concurrently (try the next one), or another worker
      // resolving a row of the same title gave it its canonical slug meanwhile.
      const now = await db.first<{ slug: string }>("SELECT slug FROM slugs WHERE title_id = ? AND is_canonical = 1", [titleId]);
      if (now) return now.slug;
    }
  }
  throw new Error(`no free slug for title ${titleId}`);
}
