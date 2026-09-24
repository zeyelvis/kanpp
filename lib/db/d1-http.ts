import type { Db, RunResult, SqlValue, Statement } from "./types";

interface D1HttpOptions {
  accountId: string;
  databaseId: string;
  /** A fixed API token, or a getter for short-lived tokens that are refreshed elsewhere. */
  apiToken: string | (() => string);
}

interface QueryResult<T> {
  success: boolean;
  results: T[];
  meta: { changes?: number; last_row_id?: number };
}

/** D1 REST API adapter for scripts that write to the production database. */
export function d1HttpDb({ accountId, databaseId, apiToken }: D1HttpOptions): Db {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  async function post<T>(body: unknown): Promise<QueryResult<T>[]> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${typeof apiToken === "function" ? apiToken() : apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { success: boolean; result: QueryResult<T>[]; errors: unknown[] };
      if (res.ok && json.success) return json.result;
      // 401/403 also retry: a short-lived OAuth token may have just been refreshed on disk.
      const retryable = res.status === 429 || res.status >= 500 || ((res.status === 401 || res.status === 403) && typeof apiToken === "function");
      if (!retryable || attempt >= 3) {
        throw new Error(`D1 HTTP ${res.status}: ${JSON.stringify(json.errors)}`);
      }
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }

  const toRun = (r: QueryResult<unknown>): RunResult => ({
    changes: r.meta.changes ?? 0,
    lastRowId: r.meta.last_row_id ?? null,
  });

  return {
    async all<T>(sql: string, params: SqlValue[] = []) {
      return (await post<T>({ sql, params }))[0].results;
    },
    async first<T>(sql: string, params: SqlValue[] = []) {
      return (await post<T>({ sql, params }))[0].results[0] ?? null;
    },
    async run(sql: string, params: SqlValue[] = []) {
      return toRun((await post({ sql, params }))[0]);
    },
    async batch(statements: Statement[]) {
      if (statements.length === 0) return [];
      const results = await post({ batch: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })) });
      return results.map(toRun);
    },
  };
}
