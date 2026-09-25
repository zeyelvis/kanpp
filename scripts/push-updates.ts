/**
 * Sends update reminders: for titles whose episode label moved forward since the last run
 * (title_updates, migrations/0007), one notification per subscribed device that follows them.
 * Runs after each ingest (ops/run-ingest.sh).
 *
 *   npx tsx scripts/push-updates.ts [--dry-run]
 *
 * Needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env.local. Subscriptions the push service
 * reports gone (404/410) are deleted.
 */
import { parseArgs } from "node:util";
import webpush from "web-push";
import { site } from "@/lib/config/site";
import { VAPID_PUBLIC_KEY, updateMessage } from "@/lib/domain/push";
import { titlePath } from "@/lib/domain/slug";
import type { Kind } from "@/lib/domain/kinds";
import { updateTimeline, type UpdateRow } from "@/lib/domain/updates";
import { loadEnv, openDb } from "./lib/open-db";

loadEnv();

const { values: args } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const log = (...parts: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const CURSOR = "push:last_update_id";

async function main() {
  if (!process.env.VAPID_PRIVATE_KEY || process.env.VAPID_PUBLIC_KEY !== VAPID_PUBLIC_KEY) {
    log("VAPID keys missing or not matching lib/domain/push.ts: skipped");
    return;
  }
  webpush.setVapidDetails(site.url, VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const db = openDb("remote");

  const max = (await db.first<{ id: number | null }>("SELECT MAX(id) AS id FROM title_updates"))?.id ?? 0;
  const cursorRow = await db.first<{ value: string }>("SELECT value FROM sync_state WHERE key = ?", [CURSOR]);
  const saveCursor = () =>
    db.run(
      "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
      [CURSOR, String(max)],
    );
  // First run: start from now, never announce the backlog.
  if (!cursorRow) {
    if (!args["dry-run"]) await saveCursor();
    log(`cursor initialised at ${max}`);
    return;
  }
  const since = Number(cursorRow.value);
  const changed = await db.all<{ title_id: number }>("SELECT DISTINCT title_id FROM title_updates WHERE id > ?", [since]);
  log(`${changed.length} titles with new labels since #${since}`);

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
  log(`${updates.size} of them moved forward`);

  let sent = 0;
  let gone = 0;
  if (updates.size) {
    const subs = await db.all<{ endpoint: string; p256dh: string; auth: string; follows: string }>(
      "SELECT endpoint, p256dh, auth, follows FROM push_subscriptions",
    );
    for (const sub of subs) {
      const followed = (JSON.parse(sub.follows) as number[]).map((id) => updates.get(id)).filter((u) => u != null);
      const message = updateMessage(followed);
      if (!message) continue;
      if (args["dry-run"]) {
        log(`would send "${message.title}" to ${new URL(sub.endpoint).hostname}`);
        continue;
      }
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(message), {
          TTL: 24 * 3600,
          urgency: "normal",
        });
        sent++;
        await db.run("UPDATE push_subscriptions SET last_sent_at = datetime('now') WHERE endpoint = ?", [sub.endpoint]);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          gone++;
          await db.run("DELETE FROM push_subscriptions WHERE endpoint = ?", [sub.endpoint]);
        } else log(`push failed (${status ?? (err as Error).message}) for ${new URL(sub.endpoint).hostname}`);
      }
    }
  }
  if (!args["dry-run"]) await saveCursor();
  log(`sent ${sent}, removed ${gone} expired subscriptions`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // A reminder run must never fail the ingest job.
    console.error(err);
    process.exit(0);
  });
