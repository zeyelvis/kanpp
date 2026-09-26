import type { Kind } from "@/lib/domain/kinds";
import { updateMessage } from "@/lib/domain/push";
import { titlePath } from "@/lib/domain/slug";
import { updateTimeline, type UpdateRow } from "@/lib/domain/updates";
import { sendWebPush, type VapidKeys } from "@/lib/push/webpush";
import type { JobContext } from "./pipeline";

const CURSOR = "push:last_update_id";

/**
 * Update reminders: for titles whose episode label moved forward since the last run
 * (title_updates, migrations/0007), one notification per subscribed device that follows them.
 * Subscriptions the push service reports gone (404/410) are deleted. The first run only sets
 * the cursor, so the backlog is never announced.
 */
export async function runPushUpdates(ctx: JobContext, vapid: VapidKeys | null, opts: { dryRun?: boolean } = {}) {
  const { db, log } = ctx;
  if (!vapid) {
    log("VAPID keys missing: reminders skipped");
    return { skipped: true };
  }
  const max = (await db.first<{ id: number | null }>("SELECT MAX(id) AS id FROM title_updates"))?.id ?? 0;
  const cursorRow = await db.first<{ value: string }>("SELECT value FROM sync_state WHERE key = ?", [CURSOR]);
  const saveCursor = () =>
    db.run(
      "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
      [CURSOR, String(max)],
    );
  if (!cursorRow) {
    if (!opts.dryRun) await saveCursor();
    log(`cursor initialised at ${max}`);
    return { sent: 0 };
  }
  const since = Number(cursorRow.value);
  const changed = await db.all<{ title_id: number }>("SELECT DISTINCT title_id FROM title_updates WHERE id > ?", [since]);

  // A title counts when its update history moved forward (a new episode, a finish), not when
  // sources merely relabelled the same episode.
  const updates = new Map<number, { name: string; label: string; path: string }>();
  for (const { title_id } of changed) {
    const rows = await db.all<UpdateRow & { id: number }>(
      "SELECT id, label, source_time, seen_at FROM title_updates WHERE title_id = ? ORDER BY id DESC LIMIT 60",
      [title_id],
    );
    const before = updateTimeline(rows.filter((r) => r.id <= since), rows.length);
    const after = updateTimeline(rows, rows.length);
    if (after.length <= before.length) continue;
    const t = await db.first<{ name: string; kind: Kind; slug: string }>(
      `SELECT t.name, t.kind, s.slug FROM titles t JOIN slugs s ON s.title_id = t.id AND s.is_canonical = 1
       WHERE t.id = ? AND t.indexable = 1`,
      [title_id],
    );
    if (t) updates.set(title_id, { name: t.name, label: rows[0].label, path: titlePath(t.kind, t.slug) });
  }
  log(`${changed.length} titles with new labels since #${since}, ${updates.size} moved forward`);

  let sent = 0;
  let gone = 0;
  let failed = 0;
  if (updates.size) {
    const subs = await db.all<{ endpoint: string; p256dh: string; auth: string; follows: string }>("SELECT endpoint, p256dh, auth, follows FROM push_subscriptions");
    for (const sub of subs) {
      const message = updateMessage((JSON.parse(sub.follows) as number[]).map((id) => updates.get(id)).filter((u) => u != null));
      if (!message) continue;
      if (opts.dryRun) {
        log(`would send "${message.title}" to ${new URL(sub.endpoint).hostname}`);
        continue;
      }
      const status = await sendWebPush({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(message), vapid, { ttl: 24 * 3600 }).catch(() => 0);
      if (status >= 200 && status < 300) {
        sent++;
        await db.run("UPDATE push_subscriptions SET last_sent_at = datetime('now') WHERE endpoint = ?", [sub.endpoint]);
      } else if (status === 404 || status === 410) {
        gone++;
        await db.run("DELETE FROM push_subscriptions WHERE endpoint = ?", [sub.endpoint]);
      } else {
        failed++;
        log(`push failed (${status || "network"}) for ${new URL(sub.endpoint).hostname}`);
      }
    }
  }
  if (!opts.dryRun) await saveCursor();
  log(`sent ${sent}, removed ${gone} expired subscriptions, failed ${failed}`);
  return { sent, gone, failed };
}
