import type { Db } from "@/lib/db/types";

/**
 * One writer at a time for catalog jobs, wherever they run (the ingest Worker's cron jobs,
 * scripts on this Mac). The lease is a sync_state row "ingest:lease" = "{expires ISO}|{holder}";
 * an expired lease (a crashed run) is simply taken over.
 */
const LEASE = "ingest:lease";
/** Set by scripts/mirror.ts while a local mirror is checked out: remote D1 must not change. */
export const MIRROR_CHECKOUT = "mirror:checkout";

export async function acquireLease(db: Db, holder: string, minutes: number): Promise<boolean> {
  const now = new Date();
  const until = new Date(now.getTime() + minutes * 60_000).toISOString();
  const res = await db.run(
    `INSERT INTO sync_state (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
     WHERE sync_state.value < ?`,
    [LEASE, `${until}|${holder}`, now.toISOString()],
  );
  return res.changes > 0;
}

export async function releaseLease(db: Db, holder: string): Promise<void> {
  // Exact comparison: D1 caps LIKE patterns at 50 bytes, shorter than a holder id.
  await db.run(
    "UPDATE sync_state SET value = '', updated_at = datetime('now') WHERE key = ? AND substr(value, instr(value, '|') + 1) = ?",
    [LEASE, holder],
  );
}

/** Who holds the lease and until when, or null. */
export async function currentLease(db: Db): Promise<{ until: string; holder: string } | null> {
  const value = (await db.first<{ value: string }>("SELECT value FROM sync_state WHERE key = ?", [LEASE]))?.value ?? "";
  const [until, holder] = value.split("|");
  return until && until > new Date().toISOString() ? { until, holder } : null;
}

export async function mirrorCheckedOut(db: Db): Promise<boolean> {
  const value = (await db.first<{ value: string }>("SELECT value FROM sync_state WHERE key = ?", [MIRROR_CHECKOUT]))?.value;
  return Boolean(value);
}

/**
 * Runs `job` holding the lease; null when another run holds it or a mirror is checked out.
 * `minutes` should exceed the job's worst case (the lease is not renewed).
 */
export async function withLease<T>(db: Db, holder: string, minutes: number, job: () => Promise<T>): Promise<T | null> {
  if (await mirrorCheckedOut(db)) return null;
  if (!(await acquireLease(db, holder, minutes))) return null;
  try {
    return await job();
  } finally {
    await releaseLease(db, holder);
  }
}
