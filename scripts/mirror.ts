/**
 * Bulk ingest against a local copy of production D1, then one upsert push back.
 * Over HTTP, remote D1 resolves ~2.5 rows/s (every query is a round trip); the same work on
 * a local SQLite file is bound only by TMDB and the CMS sources.
 *
 *   npx tsx scripts/mirror.ts pull            export remote D1 -> data/mirror/kanpp.sqlite + snapshot, take the lock
 *   npx tsx scripts/ingest.ts --db=file:data/mirror/kanpp.sqlite ...
 *   npx tsx scripts/mirror.ts push --dry-run  show what would be pushed
 *   npx tsx scripts/mirror.ts push [--keep]   upsert rows changed since the snapshot, notify the site,
 *                                             release the lock (--keep: keep it and re-snapshot)
 *   npx tsx scripts/mirror.ts push --keep --skip-pending   mid-run push of what is resolved so far
 *
 * While the lock exists nothing else may write remote D1 (ops/run-ingest.sh checks it): new
 * title ids are assigned locally and only line up if remote still equals the snapshot, which
 * push verifies before writing anything. Titles, slugs and aliases are never deleted, so
 * upserting the changed rows is the complete diff. Ingest runs still writing the mirror are
 * paused (SIGSTOP) during a push and resumed after it.
 */
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import type { SqlValue, Statement } from "@/lib/db/types";
import { personPath } from "@/lib/domain/slug";
import { loadEnv, openDb } from "./lib/open-db";
import { announceTitles, notifySite } from "./lib/revalidate";

loadEnv();

const ROOT = resolve(import.meta.dirname, "..");
const DIR = join(ROOT, "data/mirror");
const MIRROR = join(DIR, "kanpp.sqlite");
const SNAPSHOT = join(DIR, "snapshot.sqlite");
const LOCK = join(DIR, "checkout.lock");
const DB_NAME = "kanpp-db";

// Parents before children (foreign keys). `key` is the conflict target.
const TABLES: { name: string; key: string[]; insertOnly?: boolean }[] = [
  { name: "titles", key: ["id"] },
  { name: "seasons", key: ["title_id", "season_number"] },
  { name: "external_ids", key: ["provider", "external_id"] },
  { name: "slugs", key: ["slug"], insertOnly: true }, // permanent: triggers forbid edits
  { name: "aliases", key: ["title_id", "norm"] },
  { name: "source_items", key: ["source_id", "vod_id"] },
  { name: "sync_state", key: ["key"] },
  { name: "people", key: ["id"] }, // no foreign keys; slugs are permanent (trigger)
];
// Rows go over D1's HTTP API as bound parameters, one transaction per batch: unlike a SQL file
// import this never locks the database for the live site, and big rows are not limited by
// D1's 100 KB statement size. The Cloudflare API allows ~4 requests/s per user.
const BATCH_ROWS = 100;
const BATCH_BYTES = 2_000_000;
const PARALLEL = 2;

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean", default: false },
    keep: { type: "boolean", default: false },
    // Mid-run pushes: leave rows still waiting to be resolved for a later push.
    "skip-pending": { type: "boolean", default: false },
  },
});

const log = (...parts: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...parts);

function wrangler(argv: string[]) {
  execFileSync("npx", ["wrangler", ...argv], { cwd: ROOT, stdio: "inherit" });
}

function ingestRunning(pattern: string): boolean {
  try {
    execFileSync("pgrep", ["-f", pattern], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function counts(db: DatabaseSync, schema = "main") {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t.name] = (db.prepare(`SELECT COUNT(*) AS n FROM ${schema}.${t.name}`).get() as { n: number }).n;
  return out;
}

function pull() {
  if (existsSync(LOCK)) throw new Error(`${LOCK} exists: a mirror is already checked out (push it first)`);
  if (ingestRunning("scripts/ingest.ts --db=remote")) throw new Error("a remote ingest run is active: wait for it to finish");
  mkdirSync(DIR, { recursive: true });
  // Lock first so the scheduler stops writing before the export starts.
  closeSync(openSync(LOCK, "w"));
  const dump = join(DIR, "remote.sql");
  log("exporting remote D1");
  wrangler(["d1", "export", DB_NAME, "--remote", `--output=${dump}`]);
  for (const f of [MIRROR, `${MIRROR}-wal`, `${MIRROR}-shm`, SNAPSHOT]) rmSync(f, { force: true });
  const db = new DatabaseSync(MIRROR);
  db.exec(readFileSync(dump, "utf8"));
  db.exec(`VACUUM INTO '${SNAPSHOT}'`);
  log(`mirror ready: ${JSON.stringify(counts(db))}`);
  db.close();
}

/**
 * Runs up to `parallel` async tasks at once; the first failure stops further tasks and is
 * rethrown by add() or drain().
 */
class Pipeline {
  private inflight = new Set<Promise<void>>();
  private failure: unknown = null;
  constructor(private readonly parallel: number) {}

  async add(task: () => Promise<void>) {
    while (this.inflight.size >= this.parallel) await Promise.race(this.inflight);
    if (this.failure) throw this.failure;
    const p: Promise<void> = task()
      .catch((err: unknown) => {
        this.failure ??= err;
      })
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  async drain() {
    await Promise.all(this.inflight);
    if (this.failure) throw this.failure;
  }
}

function sqlBytes(values: SqlValue[]): number {
  return values.reduce<number>((n, v) => n + (typeof v === "string" ? Buffer.byteLength(v) : 8), 0);
}

/** Every row that differs from the snapshot, as upserts with bound parameters. */
function* changedRows(db: DatabaseSync, t: (typeof TABLES)[number]): Generator<{ statement: Statement; row: Record<string, SqlValue> }> {
  const cols = (db.prepare(`PRAGMA main.table_info(${t.name})`).all() as { name: string }[]).map((c) => c.name);
  const set = cols.filter((c) => !t.key.includes(c)).map((c) => `${c} = excluded.${c}`);
  const sql =
    `INSERT INTO ${t.name} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) ` +
    `ON CONFLICT (${t.key.join(", ")}) ${t.insertOnly ? "DO NOTHING" : `DO UPDATE SET ${set.join(", ")}`}`;
  const where = t.name === "source_items" && args["skip-pending"] ? "WHERE match_status <> 'pending'" : "";
  const rows = db.prepare(`SELECT * FROM main.${t.name} ${where} EXCEPT SELECT * FROM snap.${t.name}`).iterate() as Iterable<
    Record<string, SqlValue>
  >;
  for (const row of rows) yield { statement: { sql, params: cols.map((c) => row[c]) }, row };
}

/** SIGSTOP the ingest processes writing the mirror (so the diff is one consistent state). */
function pauseWriters(): number[] {
  let pids: number[] = [];
  try {
    pids = execFileSync("pgrep", ["-f", "scripts/ingest.ts --db=file:"], { encoding: "utf8" }).split("\n").filter(Boolean).map(Number);
  } catch {
    return [];
  }
  for (const pid of pids) process.kill(pid, "SIGSTOP");
  return pids;
}

function resumeWriters(pids: number[]) {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGCONT");
    } catch {
      // Already gone.
    }
  }
}

async function push() {
  if (!existsSync(LOCK) || !existsSync(SNAPSHOT)) throw new Error("no mirror checked out: run `mirror.ts pull` first");
  const paused = pauseWriters();
  if (paused.length) log(`paused ${paused.length} ingest processes writing the mirror`);
  try {
    await pushPaused();
  } finally {
    resumeWriters(paused);
    if (paused.length) log("resumed them");
  }
}

async function pushPaused() {
  const db = new DatabaseSync(MIRROR);
  db.exec(`ATTACH '${SNAPSHOT}' AS snap`);
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const snapMaxId = one("SELECT COALESCE(MAX(id), 0) AS n FROM snap.titles");
  const mirrorMaxId = one("SELECT COALESCE(MAX(id), 0) AS n FROM main.titles");
  // Pages worth announcing: newly indexable, or showing a new episode label.
  const announce = (
    db
      .prepare(
        `SELECT m.id FROM main.titles m LEFT JOIN snap.titles s ON s.id = m.id
         WHERE m.indexable = 1 AND (s.id IS NULL OR s.indexable <> 1 OR s.latest_label IS NOT m.latest_label)`,
      )
      .all() as { id: number }[]
  ).map((r) => r.id);
  const announcePeople = (
    db
      .prepare(
        `SELECT m.slug FROM main.people m LEFT JOIN snap.people s ON s.id = m.id
         WHERE m.indexable = 1 AND (s.id IS NULL OR s.indexable <> 1)`,
      )
      .all() as { slug: string }[]
  ).map((r) => personPath(r.slug));

  if (args["dry-run"]) {
    for (const t of TABLES) {
      let n = 0;
      for (const _ of changedRows(db, t)) n++;
      log(`${t.name}: ${n} changed rows`);
    }
    log(`titles: ${mirrorMaxId - snapMaxId} new, ${announce.length} titles and ${announcePeople.length} people to announce`);
    return;
  }

  const remote = openDb("remote");
  // Remote must not have moved past the snapshot except by an earlier, interrupted push of
  // this same mirror; otherwise locally assigned title ids could collide.
  const remoteMaxId = (await remote.first<{ n: number }>("SELECT COALESCE(MAX(id), 0) AS n FROM titles"))?.n ?? 0;
  if (remoteMaxId < snapMaxId || remoteMaxId > mirrorMaxId) {
    throw new Error(`remote changed since pull (max title id ${remoteMaxId}, snapshot ${snapMaxId}, mirror ${mirrorMaxId})`);
  }

  const changedTitleIds: number[] = [];
  for (const t of TABLES) {
    const pipeline = new Pipeline(PARALLEL);
    let batch: Statement[] = [];
    let bytes = 0;
    let rows = 0;
    const flush = async () => {
      const statements = batch;
      batch = [];
      bytes = 0;
      if (statements.length) await pipeline.add(async () => void (await remote.batch(statements)));
    };
    for (const { statement, row } of changedRows(db, t)) {
      if (t.name === "titles") changedTitleIds.push(row.id as number);
      batch.push(statement);
      bytes += sqlBytes(statement.params ?? []);
      rows++;
      if (batch.length >= BATCH_ROWS || bytes >= BATCH_BYTES) await flush();
      if (rows % 20_000 === 0) log(`${t.name}: ${rows} rows sent`);
    }
    await flush();
    await pipeline.drain();
    log(`${t.name}: ${rows} changed rows pushed`);
  }

  const mirrorCounts = counts(db);
  for (const t of TABLES) {
    const n = (await remote.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t.name}`))?.n;
    log(`${t.name}: remote ${n}, mirror ${mirrorCounts[t.name]}${n === mirrorCounts[t.name] ? "" : "  MISMATCH"}`);
  }

  // New titles were never cached (only as 404s, which `created` clears); updated ones were.
  const updated = changedTitleIds.filter((id) => id <= snapMaxId);
  log(`revalidate: ${await notifySite({ titleIds: updated, created: mirrorMaxId > snapMaxId, catalog: true })}`);
  log(`indexnow: ${await announceTitles(remote, announce, announcePeople)}`);

  db.exec("DETACH snap");
  if (args.keep) {
    rmSync(SNAPSHOT, { force: true });
    db.exec(`VACUUM INTO '${SNAPSHOT}'`);
    if (args["skip-pending"]) {
      // The snapshot must not claim rows that were not pushed: forgetting all pending rows
      // only means some get upserted again later.
      const snap = new DatabaseSync(SNAPSHOT);
      snap.exec("DELETE FROM source_items WHERE match_status = 'pending'");
      snap.close();
    }
    log("pushed; mirror stays checked out with a fresh snapshot");
  } else {
    rmSync(LOCK, { force: true });
    log("pushed; lock released");
  }
  db.close();
}

async function main() {
  const command = positionals[0];
  if (command === "pull") return pull();
  if (command === "push") return push();
  throw new Error("usage: mirror.ts pull | push [--dry-run] [--keep] [--skip-pending]");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
