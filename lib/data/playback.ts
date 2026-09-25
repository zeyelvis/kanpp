import "server-only";
import { cachedQuery } from "@/lib/data/cache";
import { getDb } from "@/lib/db/server";
import type { LineStats } from "@/lib/domain/line-rank";

const WINDOW = "-7 days";

/** Cloudflare's cf-ipcountry value, or XX when missing or malformed. */
export function viewerCountry(raw: string | null): string {
  return raw && /^[A-Z][A-Z0-9]$/.test(raw) ? raw : "XX";
}

export async function recordPlayback(e: { country: string; sourceId: string; ok: boolean; ttffMs: number }) {
  await (await getDb()).run(
    `INSERT INTO playback_daily (day, country, source_id, ok, fail, ttff_ms_sum) VALUES (date('now'), ?, ?, ?, ?, ?)
     ON CONFLICT (day, country, source_id) DO UPDATE SET
       ok = ok + excluded.ok, fail = fail + excluded.fail, ttff_ms_sum = ttff_ms_sum + excluded.ttff_ms_sum`,
    [e.country, e.sourceId, e.ok ? 1 : 0, e.ok ? 0 : 1, e.ok ? e.ttffMs : 0],
  );
}

function statsQuery(country: string | null): Promise<Record<string, LineStats>> {
  return cachedQuery(["playback", country ?? "*"], [], 3600, async () => {
    const rows = await (await getDb()).all<{ source_id: string; ok: number; fail: number }>(
      `SELECT source_id, SUM(ok) AS ok, SUM(fail) AS fail FROM playback_daily
       WHERE day >= date('now', ?) ${country ? "AND country = ?" : ""} GROUP BY source_id`,
      country ? [WINDOW, country] : [WINDOW],
    );
    return Object.fromEntries(rows.map((r) => [r.source_id, { ok: r.ok, fail: r.fail }]));
  });
}

/** Last week's per-line outcomes in one country and in all countries (refreshed hourly). */
export async function playbackStats(country: string) {
  const [local, global] = await Promise.all([statsQuery(country), statsQuery(null)]);
  return { local, global };
}
