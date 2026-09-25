import type { Kind } from "./kinds";

/**
 * Topic pages (/topic/{name}): curated landing pages for the searches people actually make
 * ("韩剧", "2026年电影", "动作电影"). Each is a filter over the catalog with its own facts,
 * rankings and links; one with fewer than MIN_TOPIC_TITLES titles is not indexed.
 */
export interface Topic {
  /** Also the URL segment and the H1. */
  name: string;
  kind: Kind;
  regions?: string[];
  genres?: string[];
  year?: number;
  /** Grouping on the topic index and for "related topics". */
  group: "region" | "genre" | "year";
}

export const MIN_TOPIC_TITLES = 24;

const R = (name: string, kind: Kind, regions: string[]): Topic => ({ name, kind, regions, group: "region" });
const G = (name: string, kind: Kind, genres: string[]): Topic => ({ name, kind, genres, group: "genre" });

function yearTopics(now: number): Topic[] {
  const years = [now, now - 1, now - 2];
  const out: Topic[] = [];
  for (const y of years) {
    out.push({ name: `${y}年电视剧`, kind: "tv", year: y, group: "year" });
    out.push({ name: `${y}年电影`, kind: "movie", year: y, group: "year" });
    out.push({ name: `${y}年动漫`, kind: "anime", year: y, group: "year" });
    out.push({ name: `${y}年综艺`, kind: "variety", year: y, group: "year" });
  }
  for (const y of years.slice(0, 2)) {
    out.push({ name: `${y}年国产剧`, kind: "tv", regions: ["CN"], year: y, group: "year" });
    out.push({ name: `${y}年韩剧`, kind: "tv", regions: ["KR"], year: y, group: "year" });
    out.push({ name: `${y}年日剧`, kind: "tv", regions: ["JP"], year: y, group: "year" });
    out.push({ name: `${y}年美剧`, kind: "tv", regions: ["US"], year: y, group: "year" });
    out.push({ name: `${y}年国产电影`, kind: "movie", regions: ["CN"], year: y, group: "year" });
    out.push({ name: `${y}年日本动漫`, kind: "anime", regions: ["JP"], year: y, group: "year" });
  }
  return out;
}

const WESTERN = ["US", "GB", "FR", "DE", "IT", "ES", "CA"];

const FIXED: Topic[] = [
  R("国产剧", "tv", ["CN"]),
  R("韩剧", "tv", ["KR"]),
  R("美剧", "tv", ["US"]),
  R("日剧", "tv", ["JP"]),
  R("港剧", "tv", ["HK"]),
  R("台剧", "tv", ["TW"]),
  R("英剧", "tv", ["GB"]),
  R("泰剧", "tv", ["TH"]),
  G("悬疑剧", "tv", ["悬疑"]),
  G("犯罪剧", "tv", ["犯罪"]),
  G("喜剧电视剧", "tv", ["喜剧"]),
  G("科幻奇幻剧", "tv", ["科幻奇幻"]),
  G("家庭剧", "tv", ["家庭"]),
  G("战争剧", "tv", ["战争政治"]),
  R("国产电影", "movie", ["CN"]),
  R("欧美电影", "movie", WESTERN),
  R("美国电影", "movie", ["US"]),
  R("日本电影", "movie", ["JP"]),
  R("韩国电影", "movie", ["KR"]),
  R("香港电影", "movie", ["HK"]),
  R("台湾电影", "movie", ["TW"]),
  R("印度电影", "movie", ["IN"]),
  R("泰国电影", "movie", ["TH"]),
  R("法国电影", "movie", ["FR"]),
  R("英国电影", "movie", ["GB"]),
  G("动作电影", "movie", ["动作"]),
  G("喜剧电影", "movie", ["喜剧"]),
  G("爱情电影", "movie", ["爱情"]),
  G("科幻电影", "movie", ["科幻"]),
  G("恐怖电影", "movie", ["恐怖"]),
  G("悬疑电影", "movie", ["悬疑"]),
  G("惊悚电影", "movie", ["惊悚"]),
  G("犯罪电影", "movie", ["犯罪"]),
  G("奇幻电影", "movie", ["奇幻"]),
  G("冒险电影", "movie", ["冒险"]),
  G("战争电影", "movie", ["战争"]),
  G("动画电影", "movie", ["动画"]),
  G("历史电影", "movie", ["历史"]),
  G("家庭电影", "movie", ["家庭"]),
  R("日本动漫", "anime", ["JP"]),
  R("国产动漫", "anime", ["CN"]),
  R("欧美动漫", "anime", ["US", "GB", "CA", "FR"]),
  R("大陆综艺", "variety", ["CN"]),
  R("韩国综艺", "variety", ["KR"]),
  R("港台综艺", "variety", ["HK", "TW"]),
  R("欧美综艺", "variety", ["US", "GB"]),
  R("国产纪录片", "doc", ["CN"]),
  R("欧美纪录片", "doc", WESTERN),
  G("犯罪纪录片", "doc", ["犯罪"]),
];

/** All topics; year topics follow the calendar (this year and the two before). */
export function allTopics(now = new Date().getFullYear()): Topic[] {
  return [...FIXED, ...yearTopics(now)];
}

export function findTopic(name: string, now?: number): Topic | undefined {
  return allTopics(now).find((t) => t.name === name);
}

export function topicPath(topic: Topic | string): string {
  return `/topic/${encodeURIComponent(typeof topic === "string" ? topic : topic.name)}`;
}

/** A channel's own topics: regions and genres, plus this year's. */
export function topicsForKind(kind: Kind, now = new Date().getFullYear()): Topic[] {
  return allTopics(now).filter((t) => t.kind === kind && (t.group !== "year" || (t.year === now && !t.regions)));
}

/** A cross-channel selection for the home page. */
export function featuredTopics(now = new Date().getFullYear()): Topic[] {
  const names = ["韩剧", "美剧", "日剧", "国产剧", "港剧", "泰剧", `${now}年电视剧`, `${now}年电影`, "动作电影", "喜剧电影", "科幻电影", "恐怖电影", "日本动漫", "国产动漫", "大陆综艺", "韩国综艺"];
  const all = allTopics(now);
  return names.map((n) => all.find((t) => t.name === n)).filter((t): t is Topic => Boolean(t));
}

/** Topics a title belongs to (for links from its page), most specific first. */
export function topicsForTitle(t: { kind: Kind; countries: string[]; genres: string[]; year: number | null }, now?: number): Topic[] {
  const matches = allTopics(now).filter(
    (topic) =>
      topic.kind === t.kind &&
      (!topic.regions || topic.regions.some((r) => t.countries.includes(r))) &&
      (!topic.genres || topic.genres.some((g) => t.genres.includes(g))) &&
      (topic.year == null || topic.year === t.year),
  );
  const specificity = (x: Topic) => (x.regions ? 1 : 0) + (x.genres ? 1 : 0) + (x.year != null ? 1 : 0) - (x.regions && x.regions.length > 1 ? 0.5 : 0);
  return matches.sort((a, b) => specificity(b) - specificity(a)).slice(0, 5);
}

/** Other topics worth linking from a topic page: same kind first, then same region elsewhere. */
export function relatedTopics(topic: Topic, now?: number): Topic[] {
  const all = allTopics(now).filter((x) => x.name !== topic.name);
  const sameKind = all.filter((x) => x.kind === topic.kind && x.group !== "year");
  const sameYear = all.filter((x) => x.year != null && x.year === topic.year);
  const sameRegion = all.filter((x) => x.kind !== topic.kind && topic.regions && x.regions?.some((r) => topic.regions!.includes(r)) && x.year == null);
  return [...new Map([...sameYear, ...sameKind, ...sameRegion].map((x) => [x.name, x])).values()].slice(0, 16);
}
