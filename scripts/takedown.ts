/**
 * Copyright notices and takedowns. Every takedown belongs to a notice record
 * (copyright_notices, migrations/0011), so each notice can be shown handled, and when.
 * Titles are only status-changed, never deleted: a removed title answers 404, leaves sitemaps
 * and lists, the edge cache is told, and search engines are told through IndexNow.
 *
 *   npx tsx scripts/takedown.ts list
 *   npx tsx scripts/takedown.ts record --sender "某公司（代理：某律所）" --received 2026-09-26T08:00Z --works "某剧" --url https://kanpp.tv/tv/某剧-2026 ...
 *   npx tsx scripts/takedown.ts remove --notice 3            act on a recorded notice
 *   npx tsx scripts/takedown.ts remove --sender ... --received ... --url ...   record and act at once
 *   npx tsx scripts/takedown.ts reject --notice 3 --note "不完整：缺少签名"
 *   npx tsx scripts/takedown.ts restore --notice 3 --note "counter-notice accepted"
 *
 * The 24-hour handling target is checked by scripts/health.ts (open notices past 24 hours).
 */
import { parseArgs } from "node:util";
import type { Db } from "@/lib/db/types";
import type { Kind } from "@/lib/domain/kinds";
import { decodeSlugParam, titlePath } from "@/lib/domain/slug";
import { submitIndexNow } from "@/lib/seo/indexnow";
import { loadEnv, openDb, parseDbTarget } from "./lib/open-db";
import { notifySite } from "./lib/revalidate";

loadEnv();

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    notice: { type: "string" },
    sender: { type: "string" },
    received: { type: "string" },
    works: { type: "string" },
    url: { type: "string", multiple: true },
    id: { type: "string", multiple: true },
    note: { type: "string" },
    db: { type: "string", default: "remote" },
  },
});

interface Notice {
  id: number;
  received_at: string;
  sender: string;
  works: string | null;
  urls: string;
  title_ids: string;
  status: string;
  handled_at: string | null;
  note: string | null;
}

/** Title ids behind our URLs (a title, season or Markdown URL of a title). */
async function titleIdsFor(db: Db, urls: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (const u of urls) {
    const segment = new URL(u).pathname.split("/").filter(Boolean)[1] ?? "";
    const slug = decodeSlugParam(segment.replace(/\.md$/, ""));
    const hit = await db.first<{ title_id: number }>("SELECT title_id FROM slugs WHERE slug = ?", [slug]);
    if (!hit) throw new Error(`no title for ${u}`);
    ids.push(hit.title_id);
  }
  return [...new Set(ids)];
}

async function getNotice(db: Db, id: string | undefined): Promise<Notice> {
  if (!id) throw new Error("--notice is required");
  const n = await db.first<Notice>("SELECT * FROM copyright_notices WHERE id = ?", [Number(id)]);
  if (!n) throw new Error(`no notice #${id}`);
  return n;
}

async function recordNotice(db: Db): Promise<Notice> {
  if (!args.sender || !args.received) throw new Error("--sender and --received are required");
  const received = new Date(args.received);
  if (Number.isNaN(received.getTime())) throw new Error(`--received is not a date: ${args.received}`);
  const urls = args.url ?? [];
  const ids = [...new Set([...(await titleIdsFor(db, urls)), ...(args.id ?? []).map(Number)])];
  if (ids.length === 0) throw new Error("give the notice's --url (or --id)");
  const row = await db.first<{ id: number }>(
    "INSERT INTO copyright_notices (received_at, sender, works, urls, title_ids, note) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    [received.toISOString().slice(0, 19).replace("T", " "), args.sender, args.works ?? null, JSON.stringify(urls), JSON.stringify(ids), args.note ?? null],
  );
  console.log(`recorded notice #${row!.id}: ${ids.length} title(s)`);
  return getNotice(db, String(row!.id));
}

async function setStatus(db: Db, ids: number[], status: "removed" | "active", reason: string) {
  const paths: string[] = [];
  for (const id of ids) {
    const t = await db.first<{ name: string; status: string; kind: Kind; slug: string }>(
      "SELECT t.name, t.status, t.kind, s.slug FROM titles t JOIN slugs s ON s.title_id = t.id AND s.is_canonical = 1 WHERE t.id = ?",
      [id],
    );
    if (!t) throw new Error(`no title ${id}`);
    if (status === "removed") {
      await db.run("UPDATE titles SET status = 'removed', status_reason = ?, indexable = 0, updated_at = datetime('now') WHERE id = ?", [reason, id]);
    } else {
      // Regains indexable status on the next ingest run's publish gate.
      await db.run("UPDATE titles SET status = 'active', status_reason = ?, updated_at = datetime('now') WHERE id = ?", [reason, id]);
    }
    paths.push(titlePath(t.kind, t.slug));
    console.log(`${status === "removed" ? "removed" : "restored"} #${id} ${t.name} (was ${t.status})`);
  }
  if (args.db !== "remote") return;
  console.log(`revalidate: ${await notifySite({ titleIds: ids, created: false, catalog: true })}`);
  // Engines recrawl the URLs and drop them (404), or pick them up again after a restore.
  console.log(`IndexNow: ${await submitIndexNow(paths).catch((err) => `failed (${err})`)}`);
}

const hoursBetween = (from: string, to: string | null) =>
  Math.round((Date.parse(`${(to ?? new Date().toISOString().slice(0, 19)).replace(" ", "T")}Z`) - Date.parse(`${from.replace(" ", "T")}Z`)) / 3600_000);

async function main() {
  const db = openDb(parseDbTarget(args.db));
  const command = positionals[0];

  if (command === "list") {
    const rows = await db.all<Notice>("SELECT * FROM copyright_notices ORDER BY id DESC LIMIT 50");
    for (const n of rows) {
      const age = n.handled_at ? `handled in ${hoursBetween(n.received_at, n.handled_at)}h` : `open for ${hoursBetween(n.received_at, null)}h`;
      console.log(`#${n.id} ${n.status.padEnd(8)} received ${n.received_at} · ${age} · ${n.sender} · ${n.works ?? ""} · titles ${n.title_ids}${n.note ? ` · ${n.note}` : ""}`);
    }
    if (rows.length === 0) console.log("no notices");
    return;
  }

  if (command === "record") {
    await recordNotice(db);
    return;
  }

  if (command === "remove") {
    const notice = args.notice ? await getNotice(db, args.notice) : await recordNotice(db);
    await setStatus(db, JSON.parse(notice.title_ids) as number[], "removed", `notice #${notice.id} ${notice.sender}`);
    await db.run("UPDATE copyright_notices SET status = 'actioned', handled_at = datetime('now') WHERE id = ?", [notice.id]);
    console.log(`notice #${notice.id} actioned`);
    return;
  }

  if (command === "reject" || command === "restore") {
    const notice = await getNotice(db, args.notice);
    if (!args.note) throw new Error("--note is required (why)");
    if (command === "restore") await setStatus(db, JSON.parse(notice.title_ids) as number[], "active", `notice #${notice.id} restored: ${args.note}`);
    await db.run("UPDATE copyright_notices SET status = ?, handled_at = datetime('now'), note = ? WHERE id = ?", [
      command === "reject" ? "rejected" : "restored",
      args.note,
      notice.id,
    ]);
    console.log(`notice #${notice.id} ${command === "reject" ? "rejected" : "restored"}`);
    return;
  }

  throw new Error("command: list | record | remove | reject | restore");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
