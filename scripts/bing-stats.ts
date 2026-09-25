/**
 * Bing Webmaster Tools numbers for kanpp.tv. Bing's index also feeds ChatGPT search and
 * Copilot, so this is the first GEO signal to watch.
 *
 *   npx tsx scripts/bing-stats.ts          summary
 *   npx tsx scripts/bing-stats.ts --json   machine-readable (for the daily report)
 *
 * Needs BING_WEBMASTER_API_KEY in .env.local (Bing Webmaster Tools > Settings > API access).
 * The key can see every site in that Bing account; this script only ever asks about ours.
 */
import { parseArgs } from "node:util";
import { site } from "@/lib/config/site";
import { loadEnv } from "./lib/open-db";

loadEnv();

const { values: args } = parseArgs({ options: { json: { type: "boolean", default: false } } });
const API = "https://ssl.bing.com/webmaster/api.svc/json/";
const SITE = `${site.url}/`;

async function call<T>(method: string, params: Record<string, string> = {}): Promise<T> {
  const key = process.env.BING_WEBMASTER_API_KEY;
  if (!key) throw new Error("BING_WEBMASTER_API_KEY is not set in .env.local");
  const url = new URL(API + method);
  for (const [k, v] of Object.entries({ ...params, siteUrl: SITE, apikey: key })) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Bing ${method}: HTTP ${res.status}`);
  return ((await res.json()) as { d: T }).d;
}

/** Bing dates come as "/Date(1790000000000-0700)/". */
const day = (raw: string) => new Date(Number(raw.match(/\d{10,}/)?.[0] ?? 0)).toISOString().slice(0, 10);

interface CrawlStat { Date: string; CrawledPages: number; InIndex: number; CrawlErrors: number; BlockedByRobotsTxt: number }
interface TrafficStat { Date: string; Impressions: number; Clicks: number }
interface QueryStat { Query: string; Impressions: number; Clicks: number; AvgImpressionPosition: number }

async function main() {
  const [crawl, traffic, queries, issues, quota] = await Promise.all([
    call<CrawlStat[]>("GetCrawlStats"),
    call<TrafficStat[]>("GetRankAndTrafficStats"),
    call<QueryStat[]>("GetQueryStats"),
    call<unknown[]>("GetCrawlIssues"),
    call<{ DailyQuota: number; MonthlyQuota: number }>("GetUrlSubmissionQuota"),
  ]);
  const last = crawl.at(-1);
  const week = traffic.slice(-7);
  const summary = {
    site: SITE,
    latestCrawlDay: last ? day(last.Date) : null,
    inIndex: last?.InIndex ?? 0,
    crawledPagesLast7d: crawl.slice(-7).reduce((n, s) => n + s.CrawledPages, 0),
    crawlErrorsLast7d: crawl.slice(-7).reduce((n, s) => n + s.CrawlErrors, 0),
    blockedByRobotsLast7d: crawl.slice(-7).reduce((n, s) => n + s.BlockedByRobotsTxt, 0),
    impressionsLast7d: week.reduce((n, s) => n + s.Impressions, 0),
    clicksLast7d: week.reduce((n, s) => n + s.Clicks, 0),
    topQueries: [...queries].sort((a, b) => b.Impressions - a.Impressions).slice(0, 10).map((q) => ({ query: q.Query, impressions: q.Impressions, clicks: q.Clicks, position: q.AvgImpressionPosition })),
    crawlIssues: issues.length,
    submissionQuota: { daily: quota.DailyQuota, monthly: quota.MonthlyQuota },
  };
  if (args.json) {
    console.log(JSON.stringify(summary));
    return;
  }
  console.log(`Bing · ${SITE}`);
  console.log(`  已收录        ${summary.inIndex}（最近抓取日 ${summary.latestCrawlDay ?? "暂无数据"}）`);
  console.log(`  近 7 天抓取    ${summary.crawledPagesLast7d} 页，错误 ${summary.crawlErrorsLast7d}，被 robots 拦截 ${summary.blockedByRobotsLast7d}`);
  console.log(`  近 7 天搜索    展示 ${summary.impressionsLast7d}，点击 ${summary.clicksLast7d}`);
  console.log(`  抓取问题      ${summary.crawlIssues}`);
  for (const q of summary.topQueries) console.log(`  · ${q.query}  展示 ${q.impressions} 点击 ${q.clicks} 平均排名 ${q.position}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
