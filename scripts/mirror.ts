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
 *
 * While the lock exists nothing else may write remote D1 (ops/run-ingest.sh checks it): new
 * title ids are assigned locally and only line up if remote still equals the snapshot, which
 * push verifies before writing anything. Titles, slugs and aliases are never deleted, so
 * upserting the changed rows is the complete diff.
 */
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import type { SqlValue, Statement } from "@/lib/db/types";
import { loadEnv, openDb } from "./lib/open-db";
import { notifySite } from "./lib/revalidate";

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
];
const MAX_INLINE = 90_000; // D1 rejects SQL statements over 100 KB: bigger rows go over HTTP with bound params
const FILE_BYTES = 40_000_000;

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { "dry-run": { type: "boolean", default: false }, keep: { type: "boolean", default: false } },
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

function quote(v: SqlValue): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "string") return `'${v.replaceAll("'", "''")}'`;
  throw new Error(`unsupported value ${typeof v}`);
}

interface TablePlan {
  table: string;
  rows: number;
  files: string[];
  large: Statement[];
}

/** Writes upsert SQL for every row that differs from the snapshot, per table, in import-sized files. */
function planPush(db: DatabaseSync): { plans: TablePlan[]; changedTitleIds: number[] } {
  const outDir = join(DIR, "push");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const plans: TablePlan[] = [];
  let changedTitleIds: number[] = [];

  for (const t of TABLES) {
    const cols = (db.prepare(`PRAGMA main.table_info(${t.name})`).all() as { name: string }[]).map((c) => c.name);
    const set = cols.filter((c) => !t.key.includes(c)).map((c) => `${c} = excluded.${c}`);
    const tail = `) ON CONFLICT (${t.key.join(", ")}) ${t.insertOnly ? "DO NOTHING" : `DO UPDATE SET ${set.join(", ")}`};\n`;
    const head = `INSERT INTO ${t.name} (${cols.join(", ")}) VALUES (`;
    const plan: TablePlan = { table: t.name, rows: 0, files: [], large: [] };
    let fd = -1;
    let bytes = 0;
    const rows = db.prepare(`SELECT * FROM main.${t.name} EXCEPT SELECT * FROM snap.${t.name}`).iterate() as Iterable<Record<string, SqlValue>>;
    for (const row of rows) {
      plan.rows++;
      if (t.name === "titles") changedTitleIds.push(row.id as number);
      const values = cols.map((c) => row[c]);
      const sql = head + values.map(quote).join(", ") + tail;
      if (Buffer.byteLength(sql) > MAX_INLINE || sql.includes("\u0000")) {
        plan.large.push({ sql: head + cols.map(() => "?").join(", ") + tail.trimEnd(), params: values });
        continue;
      }
      if (fd < 0 || bytes > FILE_BYTES) {
        if (fd >= 0) closeSync(fd);
        const file = join(outDir, `${t.name}-${String(plan.files.length + 1).padStart(3, "0")}.sql`);
        plan.files.push(file);
        fd = openSync(file, "w");
        // Same header wrangler's own export uses; lets a title point at one later in the file.
        bytes = writeSync(fd, "PRAGMA defer_foreign_keys = TRUE;\n");
      }
      bytes += writeSync(fd, sql);
    }
    if (fd >= 0) closeSync(fd);
    plans.push(plan);
  }
  changedTitleIds = changedTitleIds.sort((a, b) => a - b);
  return { plans, changedTitleIds };
}

async function push() {
  if (!existsSync(LOCK) || !existsSync(SNAPSHOT)) throw new Error("no mirror checked out: run `mirror.ts pull` first");
  if (ingestRunning("scripts/ingest.ts --db=file:")) throw new Error("an ingest run is still writing the mirror: stop it first");

  const db = new DatabaseSync(MIRROR);
  db.exec(`ATTACH '${SNAPSHOT}' AS snap`);
  const snapCounts = counts(db, "snap");
  const snapMaxId = (db.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM snap.titles").get() as { n: number }).n;
  const { plans, changedTitleIds } = planPush(db);
  const created = changedTitleIds.filter((id) => id > snapMaxId).length;
  for (const p of plans) log(`${p.table}: ${p.rows} changed rows, ${p.files.length} files, ${p.large.length} large`);
  log(`titles: ${created} new, ${changedTitleIds.length - created} updated`);
  if (args["dry-run"]) return;

  const remote = openDb("remote");
  // Remote must still be the snapshot we pulled, or locally assigned ids would collide.
  const remoteMaxId = (await remote.first<{ n: number }>("SELECT COALESCE(MAX(id), 0) AS n FROM titles"))?.n;
  const remoteSources = (await remote.first<{ n: number }>("SELECT COUNT(*) AS n FROM source_items"))?.n;
  if (remoteMaxId !== snapMaxId || remoteSources !== snapCounts.source_items) {
    throw new Error(`remote changed since pull (max title id ${remoteMaxId} vs ${snapMaxId}, source rows ${remoteSources} vs ${snapCounts.source_items})`);
  }

  for (const p of plans) {
    for (const file of p.files) {
      log(`import ${file.slice(ROOT.length + 1)}`);
      wrangler(["d1", "execute", DB_NAME, "--remote", `--file=${file}`, "--yes"]);
    }
    for (let i = 0; i < p.large.length; i += 10) await remote.batch(p.large.slice(i, i + 10));
    if (p.large.length) log(`${p.table}: ${p.large.length} large rows over HTTP`);
  }

  const mirrorCounts = counts(db);
  for (const t of TABLES) {
    const n = (await remote.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t.name}`))?.n;
    log(`${t.name}: remote ${n}, mirror ${mirrorCounts[t.name]}${n === mirrorCounts[t.name] ? "" : "  MISMATCH"}`);
  }

  // New titles were never cached (only as 404s, which `created` clears); updated ones were.
  const updated = changedTitleIds.filter((id) => id <= snapMaxId);
  log(`revalidate: ${await notifySite({ titleIds: updated, created: created > 0, catalog: true })}`);

  db.exec("DETACH snap");
  if (args.keep) {
    rmSync(SNAPSHOT, { force: true });
    db.exec(`VACUUM INTO '${SNAPSHOT}'`);
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
  throw new Error("usage: mirror.ts pull | push [--dry-run] [--keep]");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
