/**
 * Submits the site's most valuable URLs to Bing (URL Submission API). Bing's index also feeds
 * ChatGPT search and Copilot, and a new site's crawl budget there is tiny. The quota is small
 * (100 a day, 500 a month for now), so the order matters: home, channels and schedule, the
 * topic pages, then the most popular titles. Submitted URLs are remembered in sync_state
 * "bing:submitted" and never sent twice. Runs daily with the health report (ops/run-health.sh).
 *
 *   npx tsx scripts/bing-submit.ts [--dry-run]
 */
import { parseArgs } from "node:util";
import { absoluteUrl, site } from "@/lib/config/site";
import { KIND_SEGMENT, KINDS, type Kind } from "@/lib/domain/kinds";
import { titlePath } from "@/lib/domain/slug";
import { allTopics, topicPath } from "@/lib/domain/topics";
import { loadEnv, openDb } from "./lib/open-db";

loadEnv();

const { values: args } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const API = "https://ssl.bing.com/webmaster/api.svc/json/";
const SITE = `${site.url}/`;
const KEY = "bing:submitted";

async function bing<T>(method: string, body?: unknown): Promise<T> {
  const key = process.env.BING_WEBMASTER_API_KEY;
  if (!key) throw new Error("BING_WEBMASTER_API_KEY is not set in .env.local");
  const url = new URL(API + method);
  url.searchParams.set("apikey", key);
  if (!body) url.searchParams.set("siteUrl", SITE);
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json; charset=utf-8" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Bing ${method}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { d: T }).d;
}

async function main() {
  const db = openDb("remote");
  const quota = await bing<{ DailyQuota: number; MonthlyQuota: number }>("GetUrlSubmissionQuota");
  const room = Math.min(quota.DailyQuota, quota.MonthlyQuota);
  const submitted = new Set(JSON.parse((await db.first<{ value: string }>("SELECT value FROM sync_state WHERE key = ?", [KEY]))?.value || "[]") as string[]);

  const hubs = ["/", ...KINDS.map((k) => `/${KIND_SEGMENT[k]}`), "/schedule", "/topic"];
  const topics = allTopics().map((t) => topicPath(t));
  const popular = await db.all<{ kind: Kind; slug: string }>(
    `SELECT t.kind, s.slug FROM titles t JOIN slugs s ON s.title_id = t.id AND s.is_canonical = 1
     WHERE t.indexable = 1 ORDER BY t.popularity DESC LIMIT 1000`,
  );
  const candidates = [...hubs, ...topics, ...popular.map((t) => titlePath(t.kind, t.slug))].map(absoluteUrl).filter((u) => !submitted.has(u));
  const batch = candidates.slice(0, room);
  console.log(`quota today ${quota.DailyQuota}, this month ${quota.MonthlyQuota}; ${submitted.size} submitted before; sending ${batch.length}`);
  if (batch.length === 0 || args["dry-run"]) {
    for (const u of batch.slice(0, 10)) console.log(`  ${decodeURIComponent(u)}`);
    return;
  }
  await bing("SubmitUrlBatch", { siteUrl: SITE, urlList: batch });
  const all = [...submitted, ...batch];
  await db.run(
    "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    [KEY, JSON.stringify(all)],
  );
  console.log(`submitted ${batch.length} (total ${all.length}); next: ${candidates.length - batch.length} waiting`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
