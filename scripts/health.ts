/**
 * Daily health report for kanpp.tv: traffic and errors, crawler activity, D1 load (with the
 * heaviest queries), the SEO check, Bing, catalog/playback numbers from the last 24 hours,
 * and last week's searches that found nothing, with the reason (the catalog's to-do list).
 *
 *   npx tsx scripts/health.ts [--notify] [--skip-seo]
 *
 * Writes data/health/{date}.json and data/health/latest.json. Problems (error rate, D1 load,
 * a query reading too many rows, a failed SEO check) are listed as alerts; with --notify
 * (ops/run-health.sh) they also raise a macOS notification.
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import type { Db } from "@/lib/db/types";
import { normalizeKey } from "@/lib/domain/normalize";
import { cloudflareApiToken, loadEnv, openDb, parseDbTarget } from "./lib/open-db";

loadEnv();

const { values: args } = parseArgs({
  options: {
    notify: { type: "boolean", default: false },
    "skip-seo": { type: "boolean", default: false },
    // Catalog numbers from another database (a local copy for testing); analytics are always live.
    db: { type: "string", default: "remote" },
  },
});
const ROOT = resolve(import.meta.dirname, "..");
const SITE = "kanpp.tv";
const SCRIPT = "kanpp";
const run = promisify(execFile);

/** Alert thresholds. */
const LIMITS = {
  errorRate: 0.005, // 5xx share of all requests
  errorCount: 200,
  d1RowsPerDay: 20_000_000,
  queryAvgRows: 5_000, // a query averaging more rows than this, and
  querySumRows: 3_000_000, // reading more than this in total, is worth fixing
  crawlerFailShare: 0.05, // non-2xx/3xx share of a search crawler's requests
};

/** Crawlers worth watching: search engines and AI search/assistants. GraphQL aliases must be identifiers. */
const CRAWLERS: { alias: string; label: string; like: string; search?: boolean }[] = [
  { alias: "googlebot", label: "Googlebot", like: "%Googlebot%", search: true },
  { alias: "bingbot", label: "Bingbot", like: "%bingbot%", search: true },
  { alias: "baidu", label: "Baiduspider", like: "%Baiduspider%", search: true },
  { alias: "yandex", label: "YandexBot", like: "%YandexBot%", search: true },
  { alias: "applebot", label: "Applebot", like: "%Applebot%", search: true },
  { alias: "oaiSearch", label: "OAI-SearchBot", like: "%OAI-SearchBot%" },
  { alias: "chatgptUser", label: "ChatGPT-User", like: "%ChatGPT-User%" },
  { alias: "gptbot", label: "GPTBot", like: "%GPTBot%" },
  { alias: "claudebot", label: "ClaudeBot", like: "%ClaudeBot%" },
  { alias: "claudeUser", label: "Claude-User/SearchBot", like: "%Claude-%" },
  { alias: "perplexity", label: "Perplexity", like: "%Perplexity%" },
  { alias: "bytespider", label: "Bytespider", like: "%Bytespider%" },
];

type Groups = { count: number; dimensions: Record<string, string | number> }[];

async function graphql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] | null };
  if (body.errors?.length) throw new Error(`GraphQL: ${body.errors.map((e) => e.message).join("; ")}`);
  if (!body.data) throw new Error(`GraphQL: HTTP ${res.status}`);
  return body.data;
}

async function zoneId(token: string): Promise<string> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${SITE}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as { result?: { id: string }[] };
  const id = body.result?.[0]?.id;
  if (!id) throw new Error(`zone ${SITE} not found`);
  return id;
}

const okStatus = (s: number) => s >= 200 && s < 400;

async function traffic(token: string, zone: string, since: string, until: string) {
  // Only requests from outside ("eyeball"): the worker's own Cache API lookups are logged as
  // requests too, and every cache miss among them shows up as a 504.
  const window = 'datetime_geq:$s,datetime_leq:$u,requestSource:"eyeball"';
  const query = `query($z:String!,$s:Time!,$u:Time!){viewer{zones(filter:{zoneTag:$z}){
    status: httpRequestsAdaptiveGroups(limit:100,filter:{${window}},orderBy:[count_DESC]){count dimensions{edgeResponseStatus}}
    errors: httpRequestsAdaptiveGroups(limit:8,filter:{${window},edgeResponseStatus_geq:500},orderBy:[count_DESC]){count dimensions{clientRequestPath edgeResponseStatus}}
    ${CRAWLERS.map((c) => `${c.alias}: httpRequestsAdaptiveGroups(limit:30,filter:{${window},userAgent_like:"${c.like}"},orderBy:[count_DESC]){count dimensions{edgeResponseStatus}}`).join("\n    ")}
  }}}`;
  const data = await graphql<{ viewer: { zones: Record<string, Groups>[] } }>(token, query, { z: zone, s: since, u: until });
  const z = data.viewer.zones[0];
  const total = z.status.reduce((n, g) => n + g.count, 0);
  const errors = z.status.filter((g) => Number(g.dimensions.edgeResponseStatus) >= 500).reduce((n, g) => n + g.count, 0);
  const crawlers = CRAWLERS.map((c) => {
    const groups = z[c.alias] ?? [];
    const requests = groups.reduce((n, g) => n + g.count, 0);
    const failed = groups.filter((g) => !okStatus(Number(g.dimensions.edgeResponseStatus))).reduce((n, g) => n + g.count, 0);
    const notFound = groups.filter((g) => Number(g.dimensions.edgeResponseStatus) === 404).reduce((n, g) => n + g.count, 0);
    return { label: c.label, search: Boolean(c.search), requests, failed, notFound };
  });
  return {
    requests: total,
    errors5xx: errors,
    topErrors: z.errors.map((g) => ({ path: String(g.dimensions.clientRequestPath), status: Number(g.dimensions.edgeResponseStatus), count: g.count })),
    crawlers,
  };
}

async function workerAndD1(token: string, since: string, until: string) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID!;
  const database = process.env.D1_DATABASE_ID!;
  const query = `query($a:String!,$s:Time!,$u:Time!,$db:String!){viewer{accounts(filter:{accountTag:$a}){
    worker: workersInvocationsAdaptive(limit:1,filter:{scriptName:"${SCRIPT}",datetime_geq:$s,datetime_leq:$u}){
      sum{requests errors} quantiles{cpuTimeP50 cpuTimeP99 wallTimeP50 wallTimeP99}}
    d1: d1AnalyticsAdaptiveGroups(limit:1,filter:{databaseId:$db,datetimeHour_geq:$s,datetimeHour_leq:$u}){
      sum{readQueries writeQueries rowsRead rowsWritten}}
    queries: d1QueriesAdaptiveGroups(limit:12,filter:{databaseId:$db,datetime_geq:$s,datetime_leq:$u},orderBy:[sum_rowsRead_DESC]){
      count sum{rowsRead} dimensions{query}}
  }}}`;
  type Acc = {
    worker: { sum: { requests: number; errors: number }; quantiles: Record<string, number> }[];
    d1: { sum: { readQueries: number; writeQueries: number; rowsRead: number; rowsWritten: number } }[];
    queries: { count: number; sum: { rowsRead: number }; dimensions: { query: string } }[];
  };
  const data = await graphql<{ viewer: { accounts: Acc[] } }>(token, query, { a: account, db: database, s: since, u: until });
  const acc = data.viewer.accounts[0];
  const w = acc.worker[0];
  const ms = (us: number | undefined) => (us == null ? null : Math.round(us / 100) / 10);
  return {
    worker: w
      ? {
          requests: w.sum.requests,
          errors: w.sum.errors,
          cpuMsP50: ms(w.quantiles.cpuTimeP50),
          cpuMsP99: ms(w.quantiles.cpuTimeP99),
          wallMsP50: ms(w.quantiles.wallTimeP50),
          wallMsP99: ms(w.quantiles.wallTimeP99),
        }
      : null,
    d1: acc.d1[0]?.sum ?? { readQueries: 0, writeQueries: 0, rowsRead: 0, rowsWritten: 0 },
    queries: acc.queries.map((q) => ({
      runs: q.count,
      rowsRead: q.sum.rowsRead,
      avgRows: Math.round(q.sum.rowsRead / Math.max(1, q.count)),
      query: q.dimensions.query.replace(/\s+/g, " ").slice(0, 240),
    })),
  };
}

async function analyticsSql<T>(token: string, sql: string): Promise<T[]> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: sql,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Analytics Engine: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { data: T[] }).data;
}

/**
 * People's page views from our own counter (lib/edge/pageview.ts): what they open, where they
 * come from (search engines and AI assistants are the SEO/GEO result), and AI agents reading
 * the Markdown versions and llms.txt.
 */
async function visitors(token: string) {
  const day = "timestamp > NOW() - INTERVAL '1' DAY";
  const human = `${day} AND blob4 = 'human'`;
  type Row = { key: string; n: string };
  const [pages, sources, landings, agents, unknown] = await Promise.all([
    analyticsSql<Row>(token, `SELECT blob1 AS key, SUM(_sample_interval) AS n FROM kanpp_pageviews WHERE ${human} GROUP BY key ORDER BY n DESC`),
    analyticsSql<Row>(token, `SELECT blob5 AS key, SUM(_sample_interval) AS n FROM kanpp_pageviews WHERE ${human} AND blob3 = 'document' GROUP BY key ORDER BY n DESC`),
    analyticsSql<{ ref: string; path: string; n: string }>(
      token,
      `SELECT blob5 AS ref, blob2 AS path, SUM(_sample_interval) AS n FROM kanpp_pageviews
       WHERE ${human} AND (blob5 LIKE 'search:%' OR blob5 LIKE 'ai:%') GROUP BY ref, path ORDER BY n DESC LIMIT 10`,
    ),
    analyticsSql<Row>(token, `SELECT blob4 AS key, SUM(_sample_interval) AS n FROM kanpp_pageviews WHERE ${day} AND blob3 = 'agent' GROUP BY key ORDER BY n DESC`),
    analyticsSql<{ n: string }>(token, `SELECT SUM(_sample_interval) AS n FROM kanpp_pageviews WHERE ${day} AND blob4 = 'unknown'`),
  ]);
  const num = (rows: Row[]) => rows.map((r) => ({ key: r.key, n: Number(r.n) }));
  const byPage = num(pages);
  const bySource = num(sources);
  return {
    pageViews: byPage.reduce((t, r) => t + r.n, 0),
    byPage,
    bySource,
    fromSearch: bySource.filter((r) => r.key.startsWith("search:")).reduce((t, r) => t + r.n, 0),
    fromAi: bySource.filter((r) => r.key.startsWith("ai:")).reduce((t, r) => t + r.n, 0),
    landings: landings.map((r) => ({ source: r.ref, path: r.path, n: Number(r.n) })),
    agentReads: num(agents),
    unknownViews: Number(unknown[0]?.n ?? 0),
  };
}

async function catalog() {
  const db = openDb(parseDbTarget(args.db));
  const [jobRows, notices, search, counts, published, updates, playback, sources] = await Promise.all([
    db.all<{ key: string; value: string; updated_at: string }>("SELECT key, value, updated_at FROM sync_state WHERE key LIKE 'job:%'"),
    db.all<{ id: number; sender: string; received_at: string; status: string; handled_at: string | null }>(
      `SELECT id, sender, received_at, status, handled_at FROM copyright_notices
       WHERE status = 'open' OR received_at >= datetime('now', '-30 days') ORDER BY id DESC`,
    ),
    searchGaps(db),
    db.all<{ key: string; value: string }>("SELECT key, value FROM sync_state WHERE key IN ('count:all', 'count:people')"),
    db.first<{ n: number }>("SELECT COUNT(*) AS n FROM titles WHERE published_at >= datetime('now', '-1 day')"),
    db.first<{ n: number; titles: number }>(
      "SELECT COUNT(*) AS n, COUNT(DISTINCT title_id) AS titles FROM title_updates WHERE seen_at >= datetime('now', '-1 day')",
    ),
    db.first<{ ok: number | null; fail: number | null; ttff: number | null }>(
      "SELECT SUM(ok) AS ok, SUM(fail) AS fail, SUM(ttff_ms_sum) AS ttff FROM playback_daily WHERE day = date('now', '-1 day')",
    ),
    db.all<{ source_id: string; ok: number; fail: number }>(
      `SELECT source_id, SUM(ok) AS ok, SUM(fail) AS fail FROM playback_daily WHERE day = date('now', '-1 day')
       GROUP BY source_id ORDER BY SUM(ok) + SUM(fail) DESC`,
    ),
  ]);
  const value = (k: string) => Number(counts.find((c) => c.key === k)?.value ?? 0);
  const ok = playback?.ok ?? 0;
  const fail = playback?.fail ?? 0;
  const hours = (from: string, to: string | null) => (Date.parse(`${(to ?? new Date().toISOString().slice(0, 19)).replace(" ", "T")}Z`) - Date.parse(`${from.replace(" ", "T")}Z`)) / 3600_000;
  const handled = notices.filter((x) => x.handled_at);
  const jobs = jobRows.map((r) => {
    const v = JSON.parse(r.value) as { ok: boolean; skipped?: string; error?: string; startedAt?: string; ms?: number };
    return { job: r.key.slice(4), ok: v.ok, skipped: v.skipped ?? null, error: v.error?.split("\n")[0] ?? null, startedAt: v.startedAt ?? r.updated_at, seconds: v.ms ? Math.round(v.ms / 1000) : null };
  });
  return {
    jobs,
    copyright: {
      last30d: notices.length,
      handled: handled.length,
      avgHandlingHours: handled.length ? Math.round(handled.reduce((t, x) => t + hours(x.received_at, x.handled_at), 0) / handled.length) : null,
      open: notices.filter((x) => x.status === "open").map((x) => ({ id: x.id, sender: x.sender, hoursOpen: Math.round(hours(x.received_at, null)) })),
    },
    search,
    indexableTitles: value("count:all"),
    people: value("count:people"),
    publishedLast24h: published?.n ?? 0,
    episodeUpdatesLast24h: updates?.n ?? 0,
    titlesUpdatedLast24h: updates?.titles ?? 0,
    playbackYesterday: {
      loads: ok + fail,
      successRate: ok + fail ? ok / (ok + fail) : null,
      avgFirstFrameMs: ok ? Math.round((playback?.ttff ?? 0) / ok) : null,
      bySource: sources.map((s) => ({ source: s.source_id, loads: s.ok + s.fail, successRate: s.ok + s.fail ? s.ok / (s.ok + s.fail) : null })),
    },
  };
}

interface SearchGap {
  term: string;
  searches: number;
  /** Why the search found nothing, and what would fix it. */
  finding: string;
}

/**
 * Last week's searches, and the terms that found nothing with the reason: the title is in the
 * catalog but not published, it is live but the term is not the start of its name, the term
 * is a person, the sources carry it unmatched, or nobody has it. Also deletes rows past 90 days.
 */
async function searchGaps(db: Db): Promise<{ searches: number; misses: number; gaps: SearchGap[] }> {
  await db.run("DELETE FROM search_terms WHERE day < date('now', '-90 days')");
  const totals = await db.first<{ searches: number | null; misses: number | null }>(
    `SELECT SUM(n) AS searches, SUM(CASE WHEN results = 0 THEN n ELSE 0 END) AS misses FROM search_terms WHERE day >= date('now', '-7 days')`,
  );
  const top = await db.all<{ term: string; n: number }>(
    `SELECT term, SUM(n) AS n FROM search_terms WHERE day >= date('now', '-7 days') AND results = 0
     GROUP BY term ORDER BY n DESC, term LIMIT 15`,
  );
  const gaps: SearchGap[] = [];
  if (top.length) {
    const like = top.map(() => "name LIKE ?").join(" OR ");
    const patterns = top.map((t) => `%${t.term.replace(/[%_]/g, "")}%`);
    // One scan each over titles and source rows for all terms together.
    const [live, sources, people] = await Promise.all([
      db.all<{ name: string }>(`SELECT name FROM titles WHERE indexable = 1 AND (${like}) LIMIT 300`, patterns),
      db.all<{ vod_name: string; match_status: string }>(
        `SELECT vod_name, match_status FROM source_items WHERE ${top.map(() => "vod_name LIKE ?").join(" OR ")} LIMIT 300`,
        patterns,
      ),
      db.all<{ name: string; indexable: number }>(`SELECT name, indexable FROM people WHERE slug IN (${top.map(() => "?").join(",")})`, top.map((t) => t.term)),
    ]);
    for (const t of top) {
      const key = normalizeKey(t.term);
      const inCatalog = key
        ? await db.all<{ name: string; status: string; indexable: number }>(
            `SELECT t.name, t.status, t.indexable FROM aliases a JOIN titles t ON t.id = a.title_id
             WHERE a.norm >= ? AND a.norm < ? LIMIT 3`,
            [key, `${key}\u{10FFFF}`],
          )
        : [];
      const contains = (name: string) => name.toLowerCase().includes(t.term);
      const liveHits = live.filter((r) => contains(r.name)).slice(0, 3);
      const person = people.find((p) => p.name.toLowerCase() === t.term);
      const hidden = inCatalog.filter((r) => r.indexable !== 1);
      const sourceHits = sources.filter((r) => contains(r.vod_name));
      let finding: string;
      if (liveHits.length) finding = `已上线，但搜索只认片名开头：${liveHits.map((r) => `《${r.name}》`).join("")}`;
      else if (person) finding = `是影人名${person.indexable ? "（有影人页）" : ""}，搜索还不支持按人名找作品`;
      else if (hidden.length) finding = `片库有但未上线：${hidden.map((r) => `《${r.name}》（${r.status === "active" ? "缺海报/简介/线路" : r.status}）`).join("")}`;
      else if (sourceHits.length) {
        const statuses = [...new Set(sourceHits.map((r) => r.match_status))].join("/");
        finding = `采集源有 ${sourceHits.length} 条（${statuses}），片库还没收：${[...new Set(sourceHits.map((r) => r.vod_name))].slice(0, 3).join("、")}`;
      } else finding = "片库和采集源都没有";
      gaps.push({ term: t.term, searches: t.n, finding });
    }
  }
  return { searches: totals?.searches ?? 0, misses: totals?.misses ?? 0, gaps };
}

async function seoCheck(): Promise<{ passed: boolean; summary: string }> {
  try {
    const { stdout } = await run("npx", ["tsx", "scripts/seo-check.ts", `--base=https://${SITE}`, "--sample=100"], { cwd: ROOT, timeout: 15 * 60_000, maxBuffer: 16 << 20 });
    return { passed: true, summary: stdout.trim().split("\n").at(-1) ?? "" };
  } catch (err) {
    const out = String((err as { stdout?: string }).stdout ?? err);
    return { passed: false, summary: out.trim().split("\n").filter((l) => !/experimental|trace-warnings/i.test(l)).slice(-12).join("\n") };
  }
}

async function bing(): Promise<Record<string, unknown> | null> {
  try {
    const { stdout } = await run("npx", ["tsx", "scripts/bing-stats.ts", "--json"], { cwd: ROOT, timeout: 120_000 });
    return JSON.parse(stdout.trim().split("\n").at(-1) ?? "null");
  } catch {
    return null;
  }
}

const n = (x: number) => x.toLocaleString("en-US");
const PAGE_LABEL: Record<string, string> = {
  home: "首页", channel: "频道", title: "作品页", season: "分季页", person: "影人页", topic: "专题",
  schedule: "放送表", search: "搜索", me: "我的", info: "说明页", markdown: "Markdown 版", llms: "llms.txt", other: "其他",
};
const SOURCE_LABEL = (key: string) =>
  ({ direct: "直接访问", internal: "站内", other: "其他网站" })[key] ??
  key.replace(/^search:/, "搜索·").replace(/^ai:/, "AI·").replace(/^social:/, "社交·");
const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);

async function main() {
  const now = new Date();
  // Analytics datasets allow at most one day per query.
  const since = new Date(now.getTime() - 24 * 3600_000 + 60_000).toISOString().slice(0, 19) + "Z";
  const until = now.toISOString().slice(0, 19) + "Z";
  const token = cloudflareApiToken();
  const zone = await zoneId(token);

  const [web, platform, cat, seo, bingStats, people] = await Promise.all([
    traffic(token, zone, since, until),
    workerAndD1(token, since, until),
    catalog(),
    args["skip-seo"] ? Promise.resolve(null) : seoCheck(),
    bing(),
    visitors(token).catch((err) => ({ error: String(err instanceof Error ? err.message : err) })),
  ]);

  const alerts: string[] = [];
  const errorRate = web.requests ? web.errors5xx / web.requests : 0;
  if (errorRate > LIMITS.errorRate || web.errors5xx > LIMITS.errorCount) {
    alerts.push(`5xx 错误 ${n(web.errors5xx)} 次（${pct(errorRate)}），最多的：${web.topErrors.slice(0, 3).map((e) => `${decodeURI(e.path)} ${e.status}×${e.count}`).join("，")}`);
  }
  if (platform.d1.rowsRead > LIMITS.d1RowsPerDay) alerts.push(`数据库一天读取 ${n(platform.d1.rowsRead)} 行，超过 ${n(LIMITS.d1RowsPerDay)}`);
  const heavy = platform.queries.filter((q) => q.avgRows >= LIMITS.queryAvgRows && q.rowsRead >= LIMITS.querySumRows);
  for (const q of heavy) alerts.push(`重查询：平均每次读 ${n(q.avgRows)} 行，共 ${n(q.runs)} 次（${n(q.rowsRead)} 行）：${q.query.slice(0, 120)}`);
  for (const c of web.crawlers) {
    if (c.search && c.requests >= 50 && c.failed / c.requests > LIMITS.crawlerFailShare) {
      alerts.push(`${c.label} 的请求有 ${pct(c.failed / c.requests)} 未成功（共 ${n(c.requests)} 次，其中 404 ${n(c.notFound)} 次）`);
    }
  }
  // The ingest Worker's jobs (ingest/worker.ts) run every 4 hours.
  for (const j of cat.jobs) {
    const hours = (Date.now() - Date.parse(j.startedAt.includes("T") ? j.startedAt : `${j.startedAt.replace(" ", "T")}Z`)) / 3600_000;
    if (!j.ok) alerts.push(`入库任务 ${j.job} 上次失败：${j.error}`);
    else if (j.skipped && j.skipped !== "lease held or mirror checked out") alerts.push(`入库任务 ${j.job} 被跳过：${j.skipped}`);
    else if (hours > 9) alerts.push(`入库任务 ${j.job} 已 ${Math.round(hours)} 小时没有运行`);
  }
  for (const o of cat.copyright.open) {
    if (o.hoursOpen >= 24) alerts.push(`版权通知 #${o.id}（${o.sender}）已等待 ${o.hoursOpen} 小时未处理：npx tsx scripts/takedown.ts list`);
  }
  if (seo && !seo.passed) alerts.push(`SEO 巡检未通过：${seo.summary.split("\n").slice(-3).join(" / ")}`);

  const report = { generatedAt: now.toISOString(), window: { since, until }, alerts, visitors: people, web, platform, catalog: cat, seo, bing: bingStats };
  // Only real reports are kept: a run against a local copy (--db) is just printed.
  if (args.db === "remote") {
    const dir = join(ROOT, "data/health");
    mkdirSync(dir, { recursive: true });
    const day = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
    writeFileSync(join(dir, `${day}.json`), JSON.stringify(report, null, 1));
    writeFileSync(join(dir, "latest.json"), JSON.stringify(report, null, 1));
  }

  const w = platform.worker;
  const lines = [
    `看片片健康报告 · 过去 24 小时（截至 ${until.replace("T", " ").slice(0, 16)} UTC）`,
    alerts.length ? `⚠ ${alerts.length} 项需要处理：\n${alerts.map((a) => `  - ${a}`).join("\n")}` : "✓ 没有需要处理的问题",
    "error" in people
      ? `访客统计：读取失败（${people.error}）`
      : [
          `访客（真人，不含爬虫）：打开页面 ${n(people.pageViews)} 次${people.byPage.length ? `（${people.byPage.slice(0, 5).map((r) => `${PAGE_LABEL[r.key] ?? r.key} ${n(r.n)}`).join("，")}）` : ""}`,
          `  进站来源：${people.bySource.map((r) => `${SOURCE_LABEL(r.key)} ${n(r.n)}`).join("，") || "暂无"}；来自搜索引擎 ${n(people.fromSearch)}，来自 AI 助手 ${n(people.fromAi)}`,
          ...(people.landings.length ? [`  搜索/AI 带来的落地页：${people.landings.slice(0, 5).map((l) => `${l.path}（${SOURCE_LABEL(l.source)} ${l.n}）`).join("，")}`] : []),
          `  AI 智能体读取 Markdown / llms.txt：${people.agentReads.map((r) => `${r.key.replace(/^bot:/, "")} ${n(r.n)}`).join("，") || "暂无"}；身份不明的非浏览器访问 ${n(people.unknownViews)} 次`,
        ].join("\n"),
    `访问：${n(web.requests)} 次请求，5xx ${n(web.errors5xx)} 次（${pct(errorRate)}）${w ? `；Worker CPU 中位数 ${w.cpuMsP50}ms / P99 ${w.cpuMsP99}ms，总耗时中位数 ${w.wallMsP50}ms` : ""}`,
    `爬虫：${web.crawlers.filter((c) => c.requests > 0).map((c) => `${c.label} ${n(c.requests)}${c.failed ? `（未成功 ${n(c.failed)}）` : ""}`).join("，") || "无"}`,
    `数据库：读取 ${n(platform.d1.rowsRead)} 行（${n(platform.d1.readQueries)} 次查询），写入 ${n(platform.d1.rowsWritten)} 行`,
    `  读取最多：${platform.queries.slice(0, 3).map((q) => `${n(q.rowsRead)} 行 / ${n(q.runs)} 次（平均 ${n(q.avgRows)}）${q.query.slice(0, 70)}`).join("\n            ")}`,
    `片库：可收录 ${n(cat.indexableTitles)} 部，影人 ${n(cat.people)} 位；近 24 小时新上线 ${n(cat.publishedLast24h)} 部，${n(cat.titlesUpdatedLast24h)} 部有新集数`,
    `播放（昨天）：${n(cat.playbackYesterday.loads)} 次，成功率 ${pct(cat.playbackYesterday.successRate)}${cat.playbackYesterday.avgFirstFrameMs ? `，首帧平均 ${n(cat.playbackYesterday.avgFirstFrameMs)}ms` : ""}`,
    `入库任务（Cloudflare）：${cat.jobs.map((j) => `${j.job} ${j.ok ? (j.skipped ? `跳过（${j.skipped}）` : `成功，${j.seconds}秒`) : "失败"}，${j.startedAt.slice(5, 16).replace("T", " ")} UTC`).join("；") || "尚未运行"}`,
    `版权通知（近 30 天）：${cat.copyright.last30d} 件，已处理 ${cat.copyright.handled} 件${cat.copyright.avgHandlingHours != null ? `，平均 ${cat.copyright.avgHandlingHours} 小时` : ""}${cat.copyright.open.length ? `；待处理 ${cat.copyright.open.map((o) => `#${o.id} 已 ${o.hoursOpen} 小时`).join("、")}` : ""}`,
    `搜索（近 7 天）：${n(cat.search.searches)} 次，没结果 ${n(cat.search.misses)} 次${cat.search.gaps.length ? `；补片清单：\n${cat.search.gaps.slice(0, 10).map((g) => `  - 「${g.term}」${g.searches} 次：${g.finding}`).join("\n")}` : ""}`,
    seo ? `SEO 巡检：${seo.passed ? "通过" : "未通过"}（${seo.summary.split("\n").at(-1)}）` : "SEO 巡检：跳过",
    bingStats ? `Bing：已收录 ${bingStats.inIndex}，近 7 天抓取 ${bingStats.crawledPagesLast7d} 页，展示 ${bingStats.impressionsLast7d}，点击 ${bingStats.clicksLast7d}` : "Bing：读取失败",
  ];
  console.log(lines.join("\n"));

  if (args.notify && alerts.length) {
    const text = `${alerts.length} 项需要处理：${alerts[0].slice(0, 90)}`.replace(/["\\]/g, "");
    try {
      execFileSync("osascript", ["-e", `display notification "${text}" with title "看片片健康报告"`]);
    } catch {
      // Notifications are best-effort; the report file has everything.
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
