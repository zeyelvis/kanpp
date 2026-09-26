/**
 * Google Search Console -> D1, daily on this Mac (ops/run-health.sh, before the health report):
 * - search performance for the latest days of final data, by page and by page + query;
 * - URL Inspection of a rotating sample of sitemap URLs: how much of each page type Google has
 *   indexed, how recently it crawled, and whether it kept our canonical.
 *
 *   npx tsx scripts/gsc-sync.ts                     pull and inspect (--inspect=N URLs, default 150)
 *   npx tsx scripts/gsc-sync.ts --inspect=0         performance only
 *   npx tsx scripts/gsc-sync.ts --report [--json]   summary from D1 only (scripts/health.ts runs this)
 *
 * The service-account key is .env.gsc.json (scripts/lib/gsc.ts); it never leaves this Mac.
 */
import { parseArgs } from "node:util";
import { site } from "@/lib/config/site";
import type { Db, Statement } from "@/lib/db/types";
import { SearchConsole, type SearchRow } from "./lib/gsc";
import { loadEnv, openDb } from "./lib/open-db";

loadEnv();

const log = (...parts: unknown[]) => console.error(new Date().toISOString().slice(11, 19), ...parts);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function toPath(url: string): string {
  const path = url.startsWith(site.url) ? url.slice(site.url.length) || "/" : url;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function pageType(path: string): string {
  if (/^\/(movie|tv|anime|variety|documentary|schedule|topic)?$/.test(path)) return "hub";
  if (path.startsWith("/topic/")) return "topic";
  if (path.startsWith("/person/")) return "person";
  if (/^\/(movie|tv|anime|variety|documentary)\/[^/]+\/s\d+$/.test(path)) return "season";
  if (/^\/(movie|tv|anime|variety|documentary)\/[^/]+$/.test(path)) return "title";
  return "page";
}

/** Runs statements in batches, each INSERT carrying at most 100 parameters (D1's limit). */
async function insertRows(db: Db, table: string, columns: string[], rows: (string | number)[][]) {
  const perStatement = Math.floor(100 / columns.length);
  const statements: Statement[] = [];
  for (let i = 0; i < rows.length; i += perStatement) {
    const chunk = rows.slice(i, i + perStatement);
    statements.push({
      sql: `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES ${chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ")}`,
      params: chunk.flat(),
    });
  }
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
}

async function pullPerformance(db: Db, gsc: SearchConsole) {
  // Final data trails by ~2-3 days and can still be revised: re-pull the last ten days.
  const range = { startDate: day(-10), endDate: day(-1) };
  const [pages, queries] = await Promise.all([
    gsc.searchAnalytics({ ...range, dimensions: ["date", "page"] }),
    gsc.searchAnalytics({ ...range, dimensions: ["date", "page", "query"] }),
  ]);
  const row = (r: SearchRow) => [r.keys[0], toPath(r.keys[1]), ...r.keys.slice(2), r.clicks, r.impressions, Math.round(r.position * 10) / 10];
  await db.batch([
    { sql: "DELETE FROM gsc_page_daily WHERE date BETWEEN ? AND ?", params: [range.startDate, range.endDate] },
    { sql: "DELETE FROM gsc_query_daily WHERE date BETWEEN ? AND ?", params: [range.startDate, range.endDate] },
  ]);
  await insertRows(db, "gsc_page_daily", ["date", "page", "clicks", "impressions", "position"], pages.map(row));
  await insertRows(db, "gsc_query_daily", ["date", "page", "query", "clicks", "impressions", "position"], queries.map(row));
  const days = [...new Set(pages.map((r) => r.keys[0]))].sort();
  log(`performance ${range.startDate}..${range.endDate}: ${pages.length} page rows, ${queries.length} query rows, days with data: ${days.join(" ") || "none"}`);
}

async function sitemapPaths(): Promise<string[]> {
  const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const get = async (url: string) => (await fetch(url, { signal: AbortSignal.timeout(120_000) })).text();
  const files = locs(await get(`${site.url}/sitemap.xml`));
  const paths: string[] = [];
  for (const file of files) paths.push(...locs(await get(file)).map(toPath));
  return [...new Set(paths)];
}

function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * Today's sample: hubs, static pages and topics once a week; titles updated recently (their
 * lastmod asks for a re-crawl) once a week; then titles and people never inspected, two
 * titles to one person, at random so the sample stays representative.
 */
async function inspectSample(db: Db, gsc: SearchConsole, limit: number) {
  const [paths, recentXml, done] = await Promise.all([
    sitemapPaths(),
    fetch(`${site.url}/sitemaps/recent.xml`).then((r) => r.text()),
    db.all<{ path: string; checked_at: string }>("SELECT path, checked_at FROM gsc_inspections"),
  ]);
  const checked = new Map(done.map((r) => [r.path, r.checked_at]));
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const stale = (p: string) => (checked.get(p) ?? "") < weekAgo;
  const recent = [...recentXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => toPath(m[1]));
  const fresh = shuffle(paths.filter((p) => !checked.has(p)));
  const titles = fresh.filter((p) => pageType(p) === "title" || pageType(p) === "season");
  const people = fresh.filter((p) => pageType(p) === "person");
  const mixed: string[] = [];
  while (titles.length || people.length) mixed.push(...titles.splice(0, 2), ...people.splice(0, 1));
  const queue = [
    ...new Set([
      ...paths.filter((p) => ["hub", "page", "topic"].includes(pageType(p)) && stale(p)),
      ...shuffle(recent.filter(stale)).slice(0, 30),
      ...mixed,
    ]),
  ].slice(0, limit);

  let inspected = 0;
  const failures: string[] = [];
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (queue.length) {
        const path = queue.shift()!;
        try {
          const r = await gsc.inspect(site.url + encodeURI(path));
          const differs = r.googleCanonical && r.userCanonical && r.googleCanonical !== r.userCanonical;
          await db.run(
            `INSERT OR REPLACE INTO gsc_inspections (path, page_type, checked_at, verdict, coverage, last_crawl, fetch_state, google_canonical)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [path, pageType(path), new Date().toISOString(), r.verdict ?? null, r.coverageState ?? null, r.lastCrawlTime ?? null, r.pageFetchState ?? null, differs ? toPath(r.googleCanonical!) : null],
          );
          inspected++;
        } catch (err) {
          failures.push(`${path}: ${err instanceof Error ? err.message : err}`);
          // Out of daily quota: stop for today.
          if (/HTTP 429/.test(String(err))) queue.length = 0;
        }
      }
    }),
  );
  log(`inspected ${inspected} URLs${failures.length ? `, ${failures.length} failed (first: ${failures[0]})` : ""}`);
}

const INDEXED = new Set(["Submitted and indexed", "Indexed, not submitted in sitemap"]);

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

const STATE_LABEL: Record<string, string> = {
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
const TYPE_LABEL: Record<string, string> = { hub: "首页/频道", page: "其他页", topic: "专题", title: "作品", season: "分季", person: "影人" };

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

async function main() {
  const { values: args } = parseArgs({
    options: {
      inspect: { type: "string", default: "150" },
      report: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
  const db = openDb("remote");
  if (!args.report) {
    const gsc = new SearchConsole();
    await pullPerformance(db, gsc);
    const limit = Number(args.inspect);
    if (limit > 0) await inspectSample(db, gsc, limit);
  }
  const report = await gscReport(db);
  console.log(args.json ? JSON.stringify(report) : reportLines(report).join("\n"));
}

if (import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
