/**
 * Removes build-time prerenders from the OpenNext cache before deploy, so the first real
 * request renders each of these pages and caches the result:
 *
 * - Database-backed pages: the build renders them with an empty database (lib/db/server.ts).
 * - Every other page (/about, /topic, …): a build-time entry carries `x-nextjs-prerender` and
 *   per-segment prefetch data that OpenNext does not serve when Next's prefetch inlining is
 *   on (the default since Next 16.3). Browsers then re-prefetch every visible link to such a
 *   page without end (each footer link ~10 times a second while the footer is on screen).
 *   Pages rendered at runtime (/ and /schedule, dropped above) prefetch once.
 *
 * Route handlers (robots.txt, llms.txt, icons) and Next's own _not-found/_global-error stay.
 */
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
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

const pages = readdirSync(dir).filter((f) => {
  if (!f.endsWith(".cache") || f.startsWith("_")) return false;
  return JSON.parse(readFileSync(join(dir, f), "utf8")).type === "app";
});
if (!pages.includes("about.cache")) throw new Error(`no build-time entry for about in ${dir}: did Next change its cache layout?`);
for (const f of pages) rmSync(join(dir, f));
console.log(`dropped static pages ${pages.join(", ")}`);
