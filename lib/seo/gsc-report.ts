import type { Db } from "@/lib/db/types";

/**
 * The Google Search Console summary stored by scripts/gsc-sync.ts: search performance and the
 * URL Inspection sample. Shared by the daily health report and the back office.
 */
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

export const INDEXED = new Set(["Submitted and indexed", "Indexed, not submitted in sitemap"]);

export async function gscReport(db: Db) {
  const sum = (from: string, to: string) =>
    db.first<{ clicks: number | null; impressions: number | null; pages: number }>(
      "SELECT SUM(clicks) AS clicks, SUM(impressions) AS impressions, COUNT(DISTINCT page) AS pages FROM gsc_page_daily WHERE date BETWEEN ? AND ?",
      [from, to],
    );
  const latest = (await db.first<{ d: string | null }>("SELECT MAX(date) AS d FROM gsc_page_daily"))?.d ?? null;
  const end = latest ?? day(-3);
  const shift = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
  const [week, before, queries, pages, chances, coverage, canonical] = await Promise.all([
    sum(shift(end, -6), end),
    sum(shift(end, -13), shift(end, -7)),
    db.all<{ query: string; clicks: number; impressions: number; position: number }>(
      `SELECT query, SUM(clicks) AS clicks, SUM(impressions) AS impressions,
              ROUND(SUM(position * impressions) / SUM(impressions), 1) AS position
       FROM gsc_query_daily WHERE date BETWEEN ? AND ? GROUP BY query ORDER BY impressions DESC LIMIT 10`,
      [shift(end, -6), end],
    ),
    db.all<{ page: string; clicks: number; impressions: number; position: number }>(
      `SELECT page, SUM(clicks) AS clicks, SUM(impressions) AS impressions,
              ROUND(SUM(position * impressions) / SUM(impressions), 1) AS position
       FROM gsc_page_daily WHERE date BETWEEN ? AND ? GROUP BY page ORDER BY clicks DESC, impressions DESC LIMIT 10`,
      [shift(end, -6), end],
    ),
    // Close to the first page: the queries where better titles, text or links pay off first.
    db.all<{ query: string; page: string; impressions: number; position: number }>(
      `SELECT query, page, SUM(impressions) AS impressions, ROUND(SUM(position * impressions) / SUM(impressions), 1) AS position
       FROM gsc_query_daily WHERE date BETWEEN ? AND ? GROUP BY query, page
       HAVING position BETWEEN 5 AND 20 ORDER BY impressions DESC LIMIT 10`,
      [shift(end, -27), end],
    ),
    db.all<{ page_type: string; coverage: string | null; n: number }>(
      `SELECT page_type, coverage, COUNT(*) AS n FROM gsc_inspections
       WHERE checked_at >= ? GROUP BY page_type, coverage ORDER BY page_type, n DESC`,
      [new Date(Date.now() - 30 * 86_400_000).toISOString()],
    ),
    db.all<{ path: string; google_canonical: string }>(
      "SELECT path, google_canonical FROM gsc_inspections WHERE google_canonical IS NOT NULL ORDER BY checked_at DESC LIMIT 10",
    ),
  ]);
  const byType: Record<string, { inspected: number; indexed: number; states: Record<string, number> }> = {};
  for (const row of coverage) {
    const t = (byType[row.page_type] ??= { inspected: 0, indexed: 0, states: {} });
    t.inspected += row.n;
    if (INDEXED.has(row.coverage ?? "")) t.indexed += row.n;
    t.states[row.coverage ?? "unknown"] = row.n;
  }
  return {
    latestDay: latest,
    last7d: { clicks: week?.clicks ?? 0, impressions: week?.impressions ?? 0, pages: week?.pages ?? 0 },
    previous7d: { clicks: before?.clicks ?? 0, impressions: before?.impressions ?? 0 },
    topQueries: queries,
    topPages: pages,
    opportunities: chances,
    index: byType,
    canonicalMismatches: canonical,
  };
}

export const STATE_LABEL: Record<string, string> = {
  "Submitted and indexed": "已收录",
  "Indexed, not submitted in sitemap": "已收录",
  "Crawled - currently not indexed": "已抓取未收录",
  "Discovered - currently not indexed": "已发现未抓取",
  "URL is unknown to Google": "Google 还不知道",
  "Duplicate, Google chose different canonical than user": "Google 另选了规范网址",
  "Page with redirect": "重定向",
  "Excluded by ‘noindex’ tag": "noindex",
  "Not found (404)": "404",
};
export const TYPE_LABEL: Record<string, string> = { hub: "首页/频道", page: "其他页", topic: "专题", title: "作品", season: "分季", person: "影人" };

export function reportLines(r: Awaited<ReturnType<typeof gscReport>>): string[] {
  const lines = [
    r.latestDay
      ? `Google 搜索（截至 ${r.latestDay} 的 7 天）：点击 ${r.last7d.clicks}，展示 ${r.last7d.impressions}，有展示的网页 ${r.last7d.pages} 个；前 7 天点击 ${r.previous7d.clicks}，展示 ${r.previous7d.impressions}`
      : "Google 搜索：还没有数据（Search Console 数据约晚 2-3 天）",
  ];
  if (r.topQueries.length) lines.push(`  热门搜索词：${r.topQueries.map((q) => `${q.query}（展示 ${q.impressions}，点击 ${q.clicks}，排名 ${q.position}）`).join("，")}`);
  if (r.opportunities.length) lines.push(`  排名 5-20 名：${r.opportunities.map((q) => `${q.query} → ${q.page}（第 ${q.position} 名，展示 ${q.impressions}）`).join("，")}`);
  const types = Object.entries(r.index);
  if (types.length) {
    lines.push(
      `Google 收录抽查（近 30 天）：${types
        .map(([t, s]) => `${TYPE_LABEL[t] ?? t} ${s.indexed}/${s.inspected} 已收录（${Object.entries(s.states).map(([k, n]) => `${STATE_LABEL[k] ?? k} ${n}`).join("、")}）`)
        .join("；")}`,
    );
  }
  if (r.canonicalMismatches.length) lines.push(`  Google 另选规范网址：${r.canonicalMismatches.map((c) => `${c.path} → ${c.google_canonical}`).join("，")}`);
  return lines;
}

