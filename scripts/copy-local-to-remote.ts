/**
 * Copies the local dev database into remote D1 with bound parameters (so large rows are
 * not limited by D1's 100 KB SQL-statement size). Idempotent: rows that already exist remotely
 * are left alone (INSERT OR IGNORE), and slugs can never be rewritten anyway.
 *
 *   npx tsx scripts/copy-local-to-remote.ts
 */
import type { SqlValue, Statement } from "@/lib/db/types";
import { pickHlsGroup, serializeGroup } from "@/lib/sources/playurl";
import { loadEnv, openDb } from "./lib/open-db";

loadEnv();

// Parents before children (foreign keys).
const TABLES = ["titles", "slugs", "aliases", "seasons", "external_ids", "source_items"] as const;
const BATCH = 40;

async function main() {
  const local = openDb("local");
  const remote = openDb("remote");
  for (const table of TABLES) {
    const rows = await local.all<Record<string, SqlValue>>(`SELECT * FROM ${table}`);
    if (rows.length === 0) continue;
    const columns = Object.keys(rows[0]);
    const sql = `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
    let copied = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const statements: Statement[] = rows.slice(i, i + BATCH).map((row) => {
        if (table === "source_items" && row.play_url) {
          const group = pickHlsGroup(row.play_from as string, row.play_url as string);
          const play = group ? serializeGroup(group) : null;
          row = { ...row, play_from: play?.playFrom ?? null, play_url: play?.playUrl ?? null, episode_count: group?.episodes.length ?? 0 };
        }
        return { sql, params: columns.map((c) => row[c]) };
      });
      const results = await remote.batch(statements);
      copied += results.reduce((n, r) => n + r.changes, 0);
    }
    console.log(`${table}: ${rows.length} local rows, ${copied} inserted remotely`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
