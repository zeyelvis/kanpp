/**
 * Warms the ISR cache after a deploy. Every deploy starts with an empty cache (entries are
 * keyed by build), and D1 runs one query at a time: crawlers fetching several sitemaps at
 * once right after a deploy made the heavy ones time out. Requesting them one by one here
 * means the first crawler after a deploy gets a cached page.
 *
 * Then the title pages most likely to be requested soon, a few at a time: those in the recent
 * sitemap (updated in the last two weeks: airing series, re-crawled first for their lastmod)
 * and those the home and channel pages show.
 *
 *   node scripts/warm-cache.mjs [--base=https://kanpp.tv]
 */
const base = (process.argv.find((a) => a.startsWith("--base="))?.slice(7) ?? "https://kanpp.tv").replace(/\/$/, "");

async function get(path) {
  const started = Date.now();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(base + path, { headers: { "User-Agent": "kanpp-warm-cache" }, signal: AbortSignal.timeout(90_000) });
      const body = await res.text();
      if (res.ok) return { status: res.status, body, ms: Date.now() - started };
      if (attempt === 3) return { status: res.status, body, ms: Date.now() - started };
    } catch (err) {
      if (attempt === 3) return { status: String(err?.name ?? err), body: "", ms: Date.now() - started };
    }
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
}

const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);

// A new version takes a few seconds to reach every location.
await new Promise((r) => setTimeout(r, 15_000));

const failed = [];
async function warm(path) {
  const r = await get(path);
  if (r.status !== 200) failed.push(`${path} ${r.status}`);
  return r;
}

const HUBS = ["/", "/movie", "/tv", "/anime", "/variety", "/documentary"];
const titleLinks = new Set();
const TITLE_HREF = /href="(\/(?:movie|tv|anime|variety|documentary)\/[^"/?#]+)"/g;
for (const p of [...HUBS, "/schedule", "/topic", "/llms.txt"]) {
  const r = await warm(p);
  if (HUBS.includes(p)) for (const m of r.body.matchAll(TITLE_HREF)) titleLinks.add(m[1]);
}
const index = await warm("/sitemap.xml");
let topics = [];
let recent = [];
for (const sitemap of locs(index.body)) {
  const r = await warm(sitemap);
  if (sitemap.endsWith("/topics.xml")) topics = locs(r.body);
  if (sitemap.endsWith("/recent.xml")) recent = locs(r.body);
}
for (const p of topics) await warm(p);

// Hrefs in the HTML are percent-encoded like the sitemap's, so the two sets dedupe.
const titles = [...new Set([...recent, ...titleLinks])];
const queue = [...titles];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) await warm(queue.shift());
  }),
);

console.log(`warmed ${base}: ${9 + 1 + locs(index.body).length + topics.length} pages and sitemaps, ${titles.length} title pages${failed.length ? `, failed: ${failed.join("; ")}` : ""}`);
