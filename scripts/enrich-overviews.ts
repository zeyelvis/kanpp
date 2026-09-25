/**
 * Replaces one-line synopses with fuller ones: TMDB's other Chinese translations (Taiwan and
 * Hong Kong ones are often a whole paragraph) and the matched sources' own synopses.
 *
 *   npx tsx scripts/enrich-overviews.ts --db=remote [--below=80] [--dry-run]
 *
 * Only indexable titles whose synopsis is shorter than --below characters are looked at, and
 * a candidate is used only when it is clean (lib/ingest/overview.ts) and at least 20
 * characters longer. Later TMDB refreshes never shorten it again (upsertTitleFromTmdb).
 */
import { parseArgs } from "node:util";
import type { Db, Statement } from "@/lib/db/types";
import { bestSynopsis } from "@/lib/ingest/overview";
import { bestTmdbOverview } from "@/lib/ingest/titles";
import { cleanContent, fetchCmsByIds } from "@/lib/sources/cms";
import { getSource } from "@/lib/sources/registry";
import { TmdbClient, type TmdbType } from "@/lib/tmdb/client";
import { loadEnv, openDb, parseDbTarget } from "./lib/open-db";
import { notifySite } from "./lib/revalidate";

loadEnv();

const { values: args } = parseArgs({
  options: {
    db: { type: "string", default: "local" },
    below: { type: "string", default: "80" },
    "dry-run": { type: "boolean", default: false },
  },
});

const log = (...parts: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...parts);

interface Target {
  id: number;
  tmdb_type: TmdbType | null;
  tmdb_id: number | null;
  overview: string | null;
}
interface Row {
  title_id: number;
  source_id: string;
  vod_id: string;
  content: string | null;
}

async function chunks<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  }));
}

async function targets(db: Db, below: number): Promise<Target[]> {
  const out: Target[] = [];
  for (let after = 0; ; ) {
    const page = await db.all<Target>(
      `SELECT id, tmdb_type, tmdb_id, overview FROM titles
       WHERE id > ? AND indexable = 1 AND LENGTH(COALESCE(overview, '')) < ? ORDER BY id LIMIT 2000`,
      [after, below],
    );
    out.push(...page);
    if (page.length < 2000) return out;
    after = page.at(-1)!.id;
  }
}

/** Matched source rows of the targets, with synopses fetched for rows that have none yet. */
async function sourceSynopses(db: Db, ids: number[]): Promise<Map<number, string[]>> {
  const rows: Row[] = [];
  await chunks(ids, 90, async (chunk) => {
    rows.push(
      ...(await db.all<Row>(
        `SELECT title_id, source_id, vod_id, content FROM source_items
         WHERE title_id IN (${chunk.map(() => "?").join(",")}) AND match_status = 'matched'`,
        chunk,
      )),
    );
  });
  const missing = rows.filter((r) => r.content == null && getSource(r.source_id));
  log(`source rows ${rows.length}, fetching synopses for ${missing.length}`);
  const bySource = new Map<string, Row[]>();
  for (const r of missing) bySource.set(r.source_id, [...(bySource.get(r.source_id) ?? []), r]);
  await Promise.all(
    [...bySource.entries()].map(async ([sourceId, list]) => {
      await chunks(list, 20, async (chunk) => {
        const items = await fetchCmsByIds(getSource(sourceId)!, chunk.map((r) => r.vod_id)).catch(() => []);
        const byId = new Map(items.map((i) => [String(i.vod_id), i]));
        const updates: Statement[] = [];
        for (const r of chunk) {
          const item = byId.get(r.vod_id);
          if (!item) continue;
          // "" marks "fetched, the source has none".
          r.content = cleanContent(item.vod_content) ?? "";
          updates.push({
            sql: "UPDATE source_items SET content = ?, classes = COALESCE(classes, ?) WHERE source_id = ? AND vod_id = ?",
            params: [r.content, item.vod_class?.trim() || null, r.source_id, r.vod_id],
          });
        }
        if (updates.length && !args["dry-run"]) await db.batch(updates);
      });
    }),
  );
  const out = new Map<number, string[]>();
  for (const r of rows) if (r.content) out.set(r.title_id, [...(out.get(r.title_id) ?? []), r.content]);
  return out;
}

async function main() {
  const target = parseDbTarget(args.db);
  const db = openDb(target);
  const tmdb = new TmdbClient(process.env.TMDB_API_KEY ?? "", Number(process.env.TMDB_CONCURRENCY ?? 16));
  const list = await targets(db, Number(args.below));
  log(`${list.length} indexable titles with a synopsis under ${args.below} characters`);

  const fromTmdb = new Map<number, string>();
  let done = 0;
  await pool(list.filter((t) => t.tmdb_id && t.tmdb_type), 16, async (t) => {
    const d = await tmdb.details(t.tmdb_type!, t.tmdb_id!).catch(() => null);
    const best = d ? bestTmdbOverview(d) : null;
    if (best) fromTmdb.set(t.id, best);
    if (++done % 1000 === 0) log(`TMDB ${done}`);
  });
  const fromSources = await sourceSynopses(db, list.map((t) => t.id));

  const updates: Statement[] = [];
  const changed: number[] = [];
  let viaTmdb = 0;
  for (const t of list) {
    const current = t.overview ?? "";
    const tmdbText = fromTmdb.get(t.id);
    const best = bestSynopsis([current, tmdbText, ...(fromSources.get(t.id) ?? [])]);
    if (!best || best.length < current.length + 20) continue;
    if (tmdbText && best === bestSynopsis([tmdbText])) viaTmdb++;
    changed.push(t.id);
    updates.push({ sql: "UPDATE titles SET overview = ?, updated_at = datetime('now') WHERE id = ?", params: [best, t.id] });
  }
  log(`fuller synopsis for ${changed.length} of ${list.length} titles (${viaTmdb} from TMDB translations, the rest from sources)`);
  if (args["dry-run"]) return;
  await chunks(updates, 50, async (chunk) => void (await db.batch(chunk)));

  const left = await db.first<{ under30: number; under60: number }>(
    `SELECT SUM(LENGTH(COALESCE(overview, '')) < 30) AS under30, SUM(LENGTH(COALESCE(overview, '')) < 60) AS under60
     FROM titles WHERE indexable = 1`,
  );
  log(`still short: under 30 chars ${left?.under30}, under 60 chars ${left?.under60}`);
  if (target === "remote") log(`revalidate: ${await notifySite({ titleIds: changed, created: false, catalog: true })}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
