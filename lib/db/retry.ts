import type { Db } from "./types";

/** D1's transient failures: worth another try, unlike SQL or constraint errors. */
const TRANSIENT = /network connection lost|connection reset|object to be reset|internal error|timed? ?out|overloaded|try again/i;

/**
 * Retries statements that failed with a transient D1 error (Cloudflare's advice for D1 at
 * scale), up to `attempts` times with a short backoff. Catalog writes are upserts or updates,
 * so repeating one that did land is harmless.
 */
export function retryingDb(db: Db, attempts = 3): Db {
  const retry = async <T>(op: () => Promise<T>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await op();
      } catch (err) {
        if (attempt >= attempts || !TRANSIENT.test(err instanceof Error ? err.message : String(err))) throw err;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  };
  return {
    all: (sql, params) => retry(() => db.all(sql, params)),
    first: (sql, params) => retry(() => db.first(sql, params)),
    run: (sql, params) => retry(() => db.run(sql, params)),
    batch: (statements) => retry(() => db.batch(statements)),
  };
}
