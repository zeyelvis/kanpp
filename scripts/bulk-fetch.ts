/**
 * Fetches a source's whole catalogue quickly, for adding a new source: pages are fetched a few
 * at a time and written to a local mirror (scripts/mirror.ts pull first). Matching runs
 * afterwards: `npx tsx scripts/ingest.ts --db=file:data/mirror/kanpp.sqlite --resolve-only`.
 *
 *   npx tsx scripts/bulk-fetch.ts --db=file:data/mirror/kanpp.sqlite --source=juliang [--from=1] [--to=N] [--concurrency=8]
 *
 * The scheduled ingest then keeps the source current (recent updates every 4 hours).
 */
import { parseArgs } from "node:util";
import { upsertSourceRows } from "@/lib/ingest/source-rows";
import { fetchCmsPage } from "@/lib/sources/cms";
import { getSource } from "@/lib/sources/registry";
import { loadEnv, openDb, parseDbTarget } from "./lib/open-db";

loadEnv();

const { values: args } = parseArgs({
  options: {
    db: { type: "string" },
    source: { type: "string" },
    from: { type: "string", default: "1" },
    to: { type: "string" },
    concurrency: { type: "string", default: "8" },
  },
});

const log = (...parts: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...parts);

async function main() {
  const target = parseDbTarget(args.db);
  // Remote D1 takes a round trip per statement: a whole catalogue belongs in a local mirror.
  if (!target.startsWith("file:")) throw new Error("--db must be a local mirror file (file:data/mirror/kanpp.sqlite)");
  const source = args.source ? getSource(args.source) : undefined;
  if (!source) throw new Error(`unknown --source ${args.source}`);
  const db = openDb(target);

  const first = await fetchCmsPage(source, 1);
  const last = Math.min(Number(args.to ?? first.pageCount), first.pageCount);
  const pages = Array.from({ length: last - Number(args.from) + 1 }, (_, i) => Number(args.from) + i);
  log(`${source.id}: ${first.total} rows in ${first.pageCount} pages; fetching ${pages[0]}..${last}`);

  let done = 0;
  let written = 0;
  const skipped: Record<string, number> = {};
  const failed: number[] = [];
  await Promise.all(
    Array.from({ length: Number(args.concurrency) }, async () => {
      for (let page = pages.shift(); page != null; page = pages.shift()) {
        try {
          const res = page === 1 ? first : await fetchCmsPage(source, page);
          const stats = await upsertSourceRows(db, source.id, res.items);
          written += stats.written;
          for (const [k, v] of Object.entries(stats.skipped)) skipped[k] = (skipped[k] ?? 0) + (v ?? 0);
        } catch (err) {
          failed.push(page);
          log(`page ${page} failed: ${err instanceof Error ? err.message : err}`);
        }
        if (++done % 250 === 0) log(`${done} pages, wrote ${written}, skipped ${JSON.stringify(skipped)}`);
      }
    }),
  );
  log(`done: ${done} pages, wrote ${written}, skipped ${JSON.stringify(skipped)}${failed.length ? `, failed pages: ${failed.sort((a, b) => a - b).join(",")}` : ""}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
