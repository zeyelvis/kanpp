/**
 * Removes build-time prerenders of database-backed pages from the OpenNext cache before
 * deploy. The build renders them with an empty database (lib/db/server.ts); without their
 * cache entries the first real request renders them from D1 and caches the result.
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const DB_BACKED = ["index", "schedule", "sitemap.xml"];
const root = ".open-next/cache";
const builds = existsSync(root) ? readdirSync(root) : [];
if (builds.length !== 1) throw new Error(`expected one build in ${root}, found ${builds.length}`);
const dir = join(root, builds[0]);
const files = readdirSync(dir);
for (const route of DB_BACKED) {
  const hits = files.filter((f) => f === `${route}.cache` || f.startsWith(`${route}.`));
  if (hits.length === 0) throw new Error(`no build-time entry for ${route} in ${dir}: did Next change its cache layout?`);
  for (const f of hits) rmSync(join(dir, f));
  console.log(`dropped ${hits.join(", ")}`);
}
