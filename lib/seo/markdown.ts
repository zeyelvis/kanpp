import { absoluteUrl, site } from "@/lib/config/site";
import type { Line, Season, TitleCard, TitleDetail } from "@/lib/data/titles";
import { KIND_LABEL } from "@/lib/domain/kinds";
import { countryLabel, formatRuntime, shortDate } from "@/lib/domain/labels";
import { personPath, seasonPath, titlePath } from "@/lib/domain/slug";
import { topicPath, type Topic } from "@/lib/domain/topics";
import { updateCadence, type UpdateEntry } from "@/lib/domain/updates";
import { titleFacts } from "@/lib/seo/title";

/**
 * Title pages as Markdown for AI agents and answer engines (see proxy.ts and app/api/md):
 * the page's own facts, easier to read than the HTML. Nothing here is written for bots only.
 */

/** Markdown-safe inline text: no stray link or emphasis syntax from source data. */
function inline(text: string): string {
  return text.replace(/\s+/g, " ").replace(/([\\`*_[\]<>|])/g, "\\$1").trim();
}

const link = (text: string, path: string) => `[${inline(text)}](${absoluteUrl(path)})`;

export interface TitleMarkdownInput {
  title: TitleDetail;
  seasons: Season[];
  lines: Line[];
  timeline: UpdateEntry[];
  related: TitleCard[];
  topics: Topic[];
  /** TMDB person id -> person page slug, for people who have a page. */
  people: Record<number, string>;
}

export function titleMarkdown({ title: t, seasons, lines, timeline, related, topics, people }: TitleMarkdownInput): string {
  const url = absoluteUrl(titlePath(t.kind, t.slug));
  const names = (list: { id: number | null; name: string }[]) =>
    list.map((p) => (p.id != null && people[p.id] ? link(p.name, personPath(people[p.id])) : inline(p.name))).join("、");
  const out: string[] = [`# ${inline(t.name)}${t.year ? `（${t.year}）` : ""}`, ""];

  const facts: string[] = [`- 类型：${KIND_LABEL[t.kind]}${t.genres.length ? ` · ${t.genres.join(" / ")}` : ""}`];
  if (t.original_name && t.original_name !== t.name) facts.push(`- 原名：${inline(t.original_name)}`);
  if (t.countries.length) facts.push(`- 地区：${t.countries.map(countryLabel).join("、")}`);
  if (t.release_date) facts.push(`- ${t.tmdb_type === "tv" ? "首播" : "上映"}：${t.release_date}`);
  const runtime = t.tmdb_type === "movie" ? formatRuntime(t.runtime) : null;
  if (runtime) facts.push(`- 片长：${runtime}`);
  if (t.vote_average && t.vote_count) facts.push(`- 评分：${t.vote_average.toFixed(1)}（TMDB，${t.vote_count.toLocaleString("en-US")} 人评分）`);
  const directors = t.crew.filter((c) => c.job === "导演");
  const creators = t.crew.filter((c) => c.job === "主创");
  if (directors.length) facts.push(`- 导演：${names(directors)}`);
  if (creators.length) facts.push(`- 主创：${names(creators)}`);
  if (t.cast.length) facts.push(`- 主演：${names(t.cast.slice(0, 8))}`);
  if (t.latest_label) facts.push(`- 最新：${inline(t.latest_label)}`);
  facts.push(`- 在线观看：${url}`);
  out.push(...facts, "", "## 作品速览", "", titleFacts(t, lines), "");

  if (t.overview) out.push("## 剧情简介", "", t.overview.trim(), "");

  if (seasons.length > 1) {
    out.push("## 分季", "");
    for (const s of seasons) {
      const bits = [s.air_date?.slice(0, 4), s.episode_count ? `${s.episode_count}集` : null].filter(Boolean).join("，");
      out.push(`- ${link(s.name ?? `第${s.season_number}季`, seasonPath(t.kind, t.slug, s.season_number))}${bits ? `（${bits}）` : ""}`);
    }
    out.push("");
  }

  if (timeline.length >= 2) {
    const cadence = updateCadence(timeline);
    out.push("## 更新记录", "", ...(cadence ? [`${cadence}（北京时间）。`, ""] : []));
    out.push(...timeline.map((e) => `- ${shortDate(e.date)}：${e.text}`), "");
  }

  if (lines.length) {
    out.push("## 播放线路", "", `在作品页顶部直接播放，共 ${new Set(lines.map((l) => l.sourceId)).size} 条线路：`, "");
    const seen = new Set<string>();
    for (const l of lines) {
      if (seen.has(l.sourceId)) continue;
      seen.add(l.sourceId);
      const progress = l.remarks ? inline(l.remarks) : `${l.episodes.length}集`;
      out.push(`- ${inline(l.sourceName)}：${progress}${l.adIntro ? "（有片头广告）" : ""}`);
    }
    out.push("");
  }

  if (topics.length) out.push("## 相关专题", "", ...topics.map((x) => `- ${link(x.name, topicPath(x))}`), "");
  if (related.length) {
    out.push("## 相似作品", "", ...related.map((r) => `- ${link(`${r.name}${r.year ? `（${r.year}）` : ""}`, titlePath(r.kind, r.slug))}`), "");
  }

  out.push("---", "", `来源：${site.name} ${url}（影视资料来自 TMDB 与各播放源，本站不存储视频文件）`, "");
  return out.join("\n");
}
