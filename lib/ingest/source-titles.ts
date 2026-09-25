import { createHash } from "node:crypto";
import type { Kind } from "@/lib/domain/kinds";
import { cleanDisplayName, normalizeKey, splitPeople } from "@/lib/domain/normalize";
import { hasAdultSignal, isCommentary, isPublishableName } from "@/lib/domain/safety";
import { classifyCategory } from "@/lib/sources/categories";
import { getSource } from "@/lib/sources/registry";
import { toSimplified, toTraditional } from "./chinese";
import { parseSourceName } from "./resolve";

/**
 * Titles built from the CMS sources' own metadata, for Chinese animation and variety shows
 * that TMDB does not list. A title is only created when the sources corroborate each other:
 * at least two different sources carry the same name and year, with a poster, playable
 * episodes and a real synopsis.
 */

/** Source categories eligible for source-built titles (Chinese animation, variety). */
export const SOURCE_TITLE_TYPES = ["国产动漫", "中国动漫", "大陆综艺", "日韩综艺", "港台综艺", "欧美综艺", "综艺"];
export const MIN_SOURCE_OVERVIEW = 40;
// Cheap motion-comic formats, same quality tier as the short dramas the categories already block.
const LOW_QUALITY_FORMAT = /动态漫画|动态漫|沙雕动画/;
const MIN_SOURCES = 2;

export interface SourceRow {
  source_id: string;
  vod_id: string;
  vod_name: string;
  vod_year: number | null;
  type_name: string | null;
  area: string | null;
  pic: string | null;
  actor: string | null;
  director: string | null;
  content: string | null;
  classes: string | null;
  remarks: string | null;
  vod_time: string | null;
  episode_count: number;
}

export interface SourceTitlePlan {
  kind: Kind;
  key: string;
  name: string;
  year: number;
  overview: string | null;
  poster: { key: string; url: string; path: string };
  genres: string[];
  countries: string[];
  cast: string[];
  directors: string[];
  aliasKeys: { norm: string; alias: string; lang: string }[];
  latestLabel: string | null;
  sourceUpdatedAt: string | null;
  rows: { source_id: string; vod_id: string; season: number }[];
}

const AREA: Record<string, string> = {
  大陆: "CN", 中国大陆: "CN", 内地: "CN", 中国: "CN", 香港: "HK", 中国香港: "HK", 台湾: "TW", 中国台湾: "TW",
  日本: "JP", 韩国: "KR", 美国: "US", 英国: "GB", 泰国: "TH",
};

// Source genre words -> the genre labels the site already uses for that kind (lib/domain/filters).
const GENRE_MAP: Record<"anime" | "variety", Record<string, string>> = {
  anime: {
    动作: "动作冒险", 冒险: "动作冒险", 热血: "动作冒险", 战斗: "动作冒险",
    科幻: "科幻奇幻", 奇幻: "科幻奇幻", 玄幻: "科幻奇幻", 仙侠: "科幻奇幻", 魔幻: "科幻奇幻", 修仙: "科幻奇幻",
    喜剧: "喜剧", 搞笑: "喜剧", 剧情: "剧情", 悬疑: "悬疑", 推理: "悬疑", 家庭: "家庭", 儿童: "儿童", 亲子: "儿童", 益智: "儿童",
  },
  variety: { 真人秀: "真人秀", 脱口秀: "脱口秀", 喜剧: "喜剧", 搞笑: "喜剧", 家庭: "家庭", 亲子: "家庭" },
};

export function posterFor(url: string): { key: string; url: string; path: string } {
  const key = createHash("sha1").update(url).digest("hex").slice(0, 20);
  const ext = url.match(/\.(jpe?g|png|webp)(?:$|[?#])/i)?.[1]?.toLowerCase().replace("jpeg", "jpg") ?? "jpg";
  return { key, url, path: `/src/${key}.${ext}` };
}

function genresFor(kind: "anime" | "variety", classes: (string | null)[]): string[] {
  const out = new Set<string>(kind === "anime" ? ["动画"] : ["真人秀"]);
  for (const c of classes) for (const word of (c ?? "").split(/[,，/\s]+/)) if (GENRE_MAP[kind][word]) out.add(GENRE_MAP[kind][word]);
  return [...out].slice(0, 4);
}

const mostCommon = <T,>(values: T[]): T | undefined => {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/** Rows grouped into works: same kind and normalized name (seasons of one show together). */
export function groupSourceRows(rows: SourceRow[]): Map<string, { kind: "anime" | "variety"; rows: (SourceRow & { base: string; season: number })[] }> {
  const groups = new Map<string, { kind: "anime" | "variety"; rows: (SourceRow & { base: string; season: number })[] }>();
  for (const row of rows) {
    if (!row.type_name || !SOURCE_TITLE_TYPES.includes(row.type_name)) continue;
    const category = classifyCategory(row.type_name, row.vod_name);
    if (!category || (category.kind !== "anime" && category.kind !== "variety")) continue;
    const { base, season } = parseSourceName(row.vod_name, row.vod_year);
    const key = normalizeKey(base);
    if (!key) continue;
    const id = `${category.kind}|${key}`;
    const g = groups.get(id) ?? { kind: category.kind, rows: [] };
    g.rows.push({ ...row, base, season: season ?? 1 });
    groups.set(id, g);
  }
  return groups;
}

/** Why a group is not (yet) a title; null when it qualifies apart from the synopsis. */
export function corroboration(rows: (SourceRow & { season: number })[]): string | null {
  const bySeason = new Map<number, (SourceRow & { season: number })[]>();
  for (const r of rows) bySeason.set(r.season, [...(bySeason.get(r.season) ?? []), r]);
  const corroborated = [...bySeason.values()].some((season) => {
    if (new Set(season.map((r) => r.source_id)).size < MIN_SOURCES) return false;
    const years = season.map((r) => r.vod_year).filter((y): y is number => y != null);
    return years.length > 0 && Math.max(...years) - Math.min(...years) <= 1;
  });
  if (!corroborated) return "single-source";
  if (!rows.some((r) => r.pic)) return "no-poster";
  if (!rows.some((r) => r.episode_count > 0 && getSource(r.source_id))) return "not-playable";
  return null;
}

/** Turns a corroborated group into the title to create, or explains why not. */
export function planSourceTitle(kind: "anime" | "variety", all: (SourceRow & { base: string; season: number })[]): SourceTitlePlan | { skip: string } {
  // The title's year is the first season's most common year. Same-name rows of that season
  // from a different era are another work and stay unmatched.
  const firstSeason = Math.min(...all.map((r) => r.season));
  const year =
    mostCommon(all.filter((r) => r.season === firstSeason && r.vod_year != null).map((r) => r.vod_year!)) ??
    mostCommon(all.filter((r) => r.vod_year != null).map((r) => r.vod_year!));
  if (year == null) return { skip: "no-year" };
  const rows = all.filter((r) => r.season !== firstSeason || r.vod_year == null || Math.abs(r.vod_year - year) <= 1);
  const why = corroboration(rows);
  if (why) return { skip: why };

  const name = cleanDisplayName(toSimplified(mostCommon(rows.map((r) => r.base))!));
  if (!isPublishableName(name) || hasAdultSignal(name) || rows.some((r) => hasAdultSignal(r.vod_name) || isCommentary(r.vod_name))) {
    return { skip: "name-policy" };
  }
  if (rows.some((r) => LOW_QUALITY_FORMAT.test(r.vod_name))) return { skip: "low-quality-format" };
  const longest = rows.map((r) => r.content).filter((c): c is string => Boolean(c)).sort((a, b) => b.length - a.length)[0];
  const overview = longest ? toSimplified(longest) : null;
  if (!overview || overview.length < MIN_SOURCE_OVERVIEW) return { skip: "no-synopsis" };

  // Poster from the highest-priority source that has one.
  const withPic = rows.filter((r) => r.pic?.startsWith("http")).sort((a, b) => (getSource(a.source_id)?.priority ?? 99) - (getSource(b.source_id)?.priority ?? 99));
  if (withPic.length === 0) return { skip: "no-poster" };

  const aliasKeys = new Map<string, { norm: string; alias: string; lang: string }>();
  for (const alias of [name, toTraditional(name), ...rows.map((r) => r.base)]) {
    const norm = normalizeKey(alias);
    if (norm && !aliasKeys.has(norm)) aliasKeys.set(norm, { norm, alias, lang: "source" });
  }
  const latest = [...rows].sort((a, b) => (b.vod_time ?? "").localeCompare(a.vod_time ?? ""))[0];
  return {
    kind,
    key: normalizeKey(name),
    name,
    year,
    overview,
    poster: posterFor(withPic[0].pic!),
    genres: genresFor(kind, rows.map((r) => r.classes)),
    countries: [...new Set(rows.map((r) => AREA[(r.area ?? "").trim()]).filter((c): c is string => Boolean(c)))].slice(0, 2),
    cast: [...new Set(rows.flatMap((r) => splitPeople(r.actor)).map(toSimplified))].slice(0, 8),
    directors: [...new Set(rows.flatMap((r) => splitPeople(r.director)).map(toSimplified))].slice(0, 3),
    aliasKeys: [...aliasKeys.values()],
    latestLabel: latest.remarks,
    sourceUpdatedAt: latest.vod_time,
    rows: rows.map((r) => ({ source_id: r.source_id, vod_id: r.vod_id, season: r.season })),
  };
}
