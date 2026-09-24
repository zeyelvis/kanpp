export type SqlValue = string | number | null;

export interface Statement {
  sql: string;
  params?: SqlValue[];
}

export interface RunResult {
  changes: number;
  lastRowId: number | null;
}

/**
 * The one database interface used everywhere. Implemented over the D1 Worker binding
 * (web runtime), the D1 HTTP API (scripts against production) and node:sqlite
 * (local dev database and tests). Keeps domain code identical across all three.
 */
export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T | null>;
  run(sql: string, params?: SqlValue[]): Promise<RunResult>;
  /** Executes statements atomically, in order. */
  batch(statements: Statement[]): Promise<RunResult[]>;
}
