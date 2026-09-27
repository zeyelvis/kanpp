/**
 * Refreshes Douban's hot lists now (the catalog job does it every 4 hours; lib/ingest/hot-lists.ts).
 *
 *   npx tsx scripts/hot-lists.ts [--db=remote]
 */
import { parseArgs } from "node:util";
import { readHotLists, storeHotLists } from "@/lib/ingest/hot-lists";
import { loadEnv, openDb, parseDbTarget } from "./lib/open-db";

loadEnv();

const { values: args } = parseArgs({ options: { db: { type: "string", default: "remote" } } });

async function main() {
  const db = openDb(parseDbTarget(args.db));
  console.log(await storeHotLists(db));
  const lists = await readHotLists(db);
  for (const [key, ids] of Object.entries(lists?.lists ?? {})) console.log(key, ids.slice(0, 10).join(","));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
