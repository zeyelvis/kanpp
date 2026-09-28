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
import { gscReport, reportLines } from "@/lib/seo/gsc-report";
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
    // The recent sitemap lists titles with new episodes or new on the site: resubmitting it
    // daily asks Google to re-read it soon, so they are discovered faster.
    await gsc.submitSitemap(`${site.url}/sitemaps/recent.xml`).catch((err) => log(`sitemap submit failed: ${err instanceof Error ? err.message : err}`));
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
