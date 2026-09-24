import type { Db, RunResult, SqlValue, Statement } from "./types";

/** Minimal structural type for the D1 binding, so this file has no runtime deps. */
interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes?: number; last_row_id?: number } }>;
}
export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<{ meta: { changes?: number; last_row_id?: number } }[]>;
}

function toRunResult(meta: { changes?: number; last_row_id?: number }): RunResult {
  return { changes: meta.changes ?? 0, lastRowId: meta.last_row_id ?? null };
}

export function d1Db(binding: D1DatabaseLike): Db {
  const prep = (sql: string, params: SqlValue[] = []) => binding.prepare(sql).bind(...params);
  return {
    async all<T>(sql: string, params?: SqlValue[]) {
      return (await prep(sql, params).all<T>()).results;
    },
    async first<T>(sql: string, params?: SqlValue[]) {
      return prep(sql, params).first<T>();
    },
    async run(sql: string, params?: SqlValue[]) {
      return toRunResult((await prep(sql, params).run()).meta);
    },
    async batch(statements: Statement[]) {
      if (statements.length === 0) return [];
      const results = await binding.batch(statements.map((s) => prep(s.sql, s.params)));
      return results.map((r) => toRunResult(r.meta));
    },
  };
}
