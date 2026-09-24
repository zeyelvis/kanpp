import { DatabaseSync } from "node:sqlite";
import type { Db, RunResult, SqlValue, Statement } from "./types";

/**
 * node:sqlite adapter. Used by tests (":memory:") and by scripts writing to the local
 * wrangler D1 file, so local dev and `next dev` share one database.
 */
export function sqliteDb(path: string): Db & { close(): void; exec(sql: string): void } {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  const toRun = (r: { changes: number | bigint; lastInsertRowid: number | bigint }): RunResult => ({
    changes: Number(r.changes),
    lastRowId: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid),
  });
  return {
    async all<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async first<T>(sql: string, params: SqlValue[] = []) {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async run(sql: string, params: SqlValue[] = []) {
      return toRun(db.prepare(sql).run(...params));
    },
    async batch(statements: Statement[]) {
      db.exec("BEGIN");
      try {
        const out = statements.map((s) => toRun(db.prepare(s.sql).run(...(s.params ?? []))));
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    exec(sql: string) {
      db.exec(sql);
    },
    close() {
      db.close();
    },
  };
}
