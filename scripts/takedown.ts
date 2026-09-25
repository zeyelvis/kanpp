/**
 * Takes titles down after a valid copyright notice. Status change only (titles are never
 * deleted): the page answers 404, drops out of sitemaps and lists, and the edge cache is told.
 *
 *   npx tsx scripts/takedown.ts --url "https://kanpp.tv/tv/某剧-2026" --reason "DMCA 2026-09-25 某公司"
 *   npx tsx scripts/takedown.ts --id 123 --reason "..."
 *   npx tsx scripts/takedown.ts --restore --id 123 --reason "counter-notice accepted"
 */
import { parseArgs } from "node:util";
import { decodeSlugParam } from "@/lib/domain/slug";
import { loadEnv, openDb, parseDbTarget } from "./lib/open-db";
import { notifySite } from "./lib/revalidate";

loadEnv();

const { values: args } = parseArgs({
  options: {
    url: { type: "string", multiple: true },
    id: { type: "string", multiple: true },
    reason: { type: "string" },
    restore: { type: "boolean", default: false },
    db: { type: "string", default: "remote" },
  },
});

async function main() {
  if (!args.reason) throw new Error("--reason is required (who sent the notice, when)");
  const db = openDb(parseDbTarget(args.db));
  const ids = new Set((args.id ?? []).map(Number));
  for (const u of args.url ?? []) {
    const slug = decodeSlugParam(new URL(u).pathname.split("/").filter(Boolean)[1] ?? "");
    const hit = await db.first<{ title_id: number }>("SELECT title_id FROM slugs WHERE slug = ?", [slug]);
    if (!hit) throw new Error(`no title for ${u}`);
    ids.add(hit.title_id);
  }
  if (ids.size === 0) throw new Error("give --url or --id");

  for (const id of ids) {
    const t = await db.first<{ name: string; status: string }>("SELECT name, status FROM titles WHERE id = ?", [id]);
    if (!t) throw new Error(`no title ${id}`);
    if (args.restore) {
      await db.run("UPDATE titles SET status = 'active', status_reason = ?, updated_at = datetime('now') WHERE id = ?", [args.reason, id]);
    } else {
      await db.run("UPDATE titles SET status = 'removed', status_reason = ?, indexable = 0, updated_at = datetime('now') WHERE id = ?", [args.reason, id]);
    }
    console.log(`${args.restore ? "restored" : "removed"} #${id} ${t.name} (was ${t.status})`);
  }
  // A restored title regains indexable status on the next ingest run's publish gate.
  if (args.db === "remote") console.log(`revalidate: ${await notifySite({ titleIds: [...ids], created: false, catalog: true })}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
