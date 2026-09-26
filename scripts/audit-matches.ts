/**
 * Re-checks matched source rows against their titles with the match guard
 * (lib/domain/match-guard.ts): a film carrying a many-episode row, a series row on a film
 * under another name, or a row whose name and year both differ. Such rows go back to
 * 'pending', so the next ingest matches them again (by name, since the guard now refuses the
 * douban id), and the titles they left are refreshed.
 *
 *   npx tsx scripts/audit-matches.ts --db=remote [--apply]
 */
import { parseArgs } from "node:util";
import type { Kind } from "@/lib/domain/kinds";
import { matchConflict } from "@/lib/domain/match-guard";
import { refreshTitles } from "@/lib/ingest/publish";
import { sourceSignal } from "@/lib/ingest/resolve";
import { classifyCategory } from "@/lib/sources/categories";
import { loadEnv, openDb, parseDbTarget } from "./lib/open-db";
import { notifySite } from "./lib/revalidate";

loadEnv();

const { values: args } = parseArgs({ options: { db: { type: "string", default: "local" }, apply: { type: "boolean", default: false } } });
const STEP = 2000;

interface Row {
  source_id: string;
  vod_id: string;
  vod_name: string;
  vod_year: number | null;
  type_name: string | null;
  episode_count: number | null;
  match_note: string | null;
  title_id: number;
  kind: Kind;
  tmdb_type: string;
  year: number | null;
  name: string;
  indexable: number;
}

async function main() {
  const target = parseDbTarget(args.db);
  const db = openDb(target);
  const max = (await db.first<{ id: number }>("SELECT MAX(id) AS id FROM titles"))?.id ?? 0;
  const found: (Row & { reason: string })[] = [];
  for (let from = 0; from < max; from += STEP) {
    const rows = await db.all<Row>(
      `SELECT s.source_id, s.vod_id, s.vod_name, s.vod_year, s.type_name, s.episode_count, s.match_note, s.title_id,
              t.kind, t.tmdb_type, t.year, t.name, t.indexable
       FROM source_items s JOIN titles t ON t.id = s.title_id
       WHERE s.title_id > ? AND s.title_id <= ? AND s.match_status = 'matched'`,
      [from, from + STEP],
    );
    const aliases = await db.all<{ title_id: number; norm: string }>("SELECT title_id, norm FROM aliases WHERE title_id > ? AND title_id <= ?", [from, from + STEP]);
    const keys = new Map<number, Set<string>>();
    for (const a of aliases) keys.set(a.title_id, (keys.get(a.title_id) ?? new Set()).add(a.norm));
    for (const r of rows) {
      const category = classifyCategory(r.type_name, r.vod_name);
      if (!category) continue;
      const { signal } = sourceSignal({ ...r, douban_id: null, actor: null, director: null }, category);
      const reason = matchConflict(
        { name: r.name, film: r.tmdb_type === "movie", year: r.year, keys: keys.get(r.title_id) ?? new Set() },
        { kind: category.kind, name: r.vod_name, keys: signal.keys, year: r.vod_year, episodes: r.episode_count },
      );
      if (reason) found.push({ ...r, reason });
    }
  }

  const titles = new Set(found.map((r) => r.title_id));
  const byReason = new Map<string, number>();
  for (const r of found) byReason.set(r.reason.replace(/\(.*\)|-\d+-/, "-N-"), (byReason.get(r.reason.replace(/\(.*\)|-\d+-/, "-N-")) ?? 0) + 1);
  console.log(`${found.length} rows on ${titles.size} titles (${found.filter((r) => r.indexable).length} rows on published titles)`);
  for (const [reason, n] of byReason) console.log(`  ${reason}: ${n}`);
  for (const r of found.filter((x) => x.indexable).slice(0, 40)) {
    console.log(`  #${r.title_id} ${r.name} (${r.kind} ${r.year}) <- ${r.source_id} ${r.vod_name} ${r.vod_year} ${r.type_name} ${r.episode_count}集 [${r.reason}] ${r.match_note ?? ""}`);
  }
  if (!args.apply || found.length === 0) return;

  for (let i = 0; i < found.length; i += 50) {
    await db.batch(
      found.slice(i, i + 50).map((r) => ({
        sql: `UPDATE source_items SET match_status = 'pending', title_id = NULL, season_number = NULL, match_score = NULL,
                match_note = ? WHERE source_id = ? AND vod_id = ?`,
        params: [`audit ${r.reason} (was #${r.title_id})`.slice(0, 300), r.source_id, r.vod_id],
      })),
    );
  }
  const refreshed = await refreshTitles(db, titles);
  console.log(`reset ${found.length} rows to pending; refreshed ${refreshed.refreshed} titles (${refreshed.indexable} still published)`);
  if (target === "remote") console.log(`revalidate: ${await notifySite({ titleIds: [...titles], created: false, catalog: true })}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
