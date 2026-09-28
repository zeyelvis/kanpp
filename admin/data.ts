import type { Db } from "@/lib/db/types";
import { readHotLists } from "@/lib/ingest/hot-lists";
import { gscReport } from "@/lib/seo/gsc-report";
import { SOURCES } from "@/lib/sources/registry";

/** The daily health report (scripts/health.ts), as stored in sync_state "health:latest". */
export interface HealthReport {
  generatedAt: string;
  alerts: string[];
  visitors: { pageViews: number; bySource: { key: string; n: number }[]; fromSearch: number; fromAi: number; landings: { source: string; path: string; n: number }[]; agentReads: { key: string; n: number }[] } | { error: string };
  web: { requests: number; errors5xx: number; top404: { path: string; count: number }[]; crawlers: { label: string; search: boolean; requests: number; failed: number }[] };
  platform: { worker: { cpuMsP50: number; wallMsP50: number; wallMsP90?: number; wallMsP99: number } | null; d1: { rowsRead: number; rowsWritten: number } };
  catalog: { search: { searches: number; misses: number; gaps: { term: string; searches: number; finding: string }[] } };
  bing: { inIndex: number; crawledPagesLast7d: number; impressionsLast7d: number; clicksLast7d: number; submissionQuota: { daily: number; monthly: number } } | null;
}

export async function healthReport(db: Db): Promise<HealthReport | null> {
  const row = await db.first<{ value: string }>("SELECT value FROM sync_state WHERE key = 'health:latest'");
  return row ? (JSON.parse(row.value) as HealthReport) : null;
}

export async function catalogStats(db: Db) {
  const [byKind, people, published, updated] = await Promise.all([
    db.all<{ kind: string; n: number }>("SELECT kind, COUNT(*) AS n FROM titles WHERE indexable = 1 GROUP BY kind ORDER BY n DESC"),
    db.first<{ n: number }>("SELECT COUNT(*) AS n FROM people WHERE indexable = 1"),
    db.first<{ n: number }>("SELECT COUNT(*) AS n FROM titles WHERE indexable = 1 AND published_at >= datetime('now', '-1 day')"),
    db.first<{ n: number }>("SELECT COUNT(DISTINCT title_id) AS n FROM title_updates WHERE seen_at >= datetime('now', '-1 day')"),
  ]);
  return { byKind, people: people?.n ?? 0, publishedLast24h: published?.n ?? 0, updatedLast24h: updated?.n ?? 0 };
}

export interface JobRecord {
  job: string;
  ok: boolean;
  skipped?: string;
  error?: string;
  startedAt: string;
  ms: number;
  summary?: Record<string, unknown>;
}

export async function jobs(db: Db): Promise<JobRecord[]> {
  const rows = await db.all<{ value: string }>("SELECT value FROM sync_state WHERE key LIKE 'job:%' ORDER BY key");
  return rows.map((r) => JSON.parse(r.value) as JobRecord);
}

/** Playback outcomes over the last `days` days, per line and per country. */
export async function playback(db: Db, days = 7) {
  const rows = await db.all<{ source_id: string; country: string; ok: number; fail: number; ttff: number }>(
    `SELECT source_id, country, SUM(ok) AS ok, SUM(fail) AS fail, SUM(ttff_ms_sum) AS ttff
     FROM playback_daily WHERE day >= date('now', ?) GROUP BY source_id, country`,
    [`-${days} days`],
  );
  const names = new Map(SOURCES.map((s) => [s.id, s]));
  const bySource = new Map<string, { ok: number; fail: number; ttff: number }>();
  const byCountry = new Map<string, { ok: number; fail: number }>();
  for (const r of rows) {
    const s = bySource.get(r.source_id) ?? { ok: 0, fail: 0, ttff: 0 };
    s.ok += r.ok;
    s.fail += r.fail;
    s.ttff += r.ttff;
    bySource.set(r.source_id, s);
    const c = byCountry.get(r.country) ?? { ok: 0, fail: 0 };
    c.ok += r.ok;
    c.fail += r.fail;
    byCountry.set(r.country, c);
  }
  return {
    lines: [...bySource.entries()]
      .map(([id, s]) => ({ id, name: names.get(id)?.name ?? id, region: names.get(id)?.region ?? null, ...s, avgFirstFrameMs: s.ok ? Math.round(s.ttff / s.ok) : null }))
      .sort((a, b) => b.ok + b.fail - (a.ok + a.fail)),
    countries: [...byCountry.entries()].map(([country, c]) => ({ country, ...c })).sort((a, b) => b.ok + b.fail - (a.ok + a.fail)),
  };
}

export async function seoState(db: Db) {
  const [google, queue, bing, hot] = await Promise.all([
    gscReport(db),
    db.first<{ value: string; updated_at: string }>("SELECT value, updated_at FROM sync_state WHERE key = 'indexnow:queue'"),
    db.first<{ value: string }>("SELECT value FROM sync_state WHERE key = 'bing:submitted'"),
    readHotLists(db),
  ]);
  return {
    google,
    indexNowQueued: queue?.value ? (JSON.parse(queue.value) as string[]).length : 0,
    bingSubmitted: bing?.value ? (JSON.parse(bing.value) as string[]).length : 0,
    hotListsAt: hot?.at ?? null,
  };
}
