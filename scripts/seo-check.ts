/**
 * Live SEO contract check. Crawls a running site and asserts what search engines see:
 *
 *   npm run seo:check -- --base=https://kanpp.tv --sample=200
 *   npm run seo:check -- --base=http://localhost:3100
 *
 * Exits non-zero on any failure, so it can gate a deploy or run on a schedule.
 */
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3100" },
    sample: { type: "string", default: "100" },
    // Canonicals are absolute on the production origin; locally they will not match the base.
    origin: { type: "string" },
  },
});

const BASE = args.base!.replace(/\/+$/, "");
const ORIGIN = (args.origin ?? BASE).replace(/\/+$/, "");
const UA = "Mozilla/5.0 (compatible; kanpp-seo-check/1.0; +https://kanpp.tv)";

interface Failure {
  url: string;
  check: string;
  detail: string;
}
const failures: Failure[] = [];
const fail = (url: string, check: string, detail: string) => failures.push({ url, check, detail });

async function get(path: string, redirect: RequestRedirect = "manual") {
  const res = await fetch(BASE + path, { redirect, headers: { "User-Agent": UA } });
  return { status: res.status, location: res.headers.get("location"), body: redirect === "manual" && res.status >= 300 && res.status < 400 ? "" : await res.text() };
}

function head(html: string): string {
  const end = html.indexOf("</head>");
  return end > 0 ? html.slice(0, end) : html;
}

const attr = (html: string, re: RegExp) => html.match(re)?.[1]?.replace(/&amp;/g, "&") ?? null;

interface PageFacts {
  title: string | null;
  description: string | null;
}

/** Checks one indexable page; returns title/description for uniqueness checks. */
async function checkIndexablePage(path: string, opts: { jsonLd: boolean }): Promise<PageFacts | null> {
  const { status, location, body } = await get(path);
  if (status !== 200) {
    fail(path, "status", `expected 200, got ${status}${location ? ` -> ${location}` : ""}`);
    return null;
  }
  const h = head(body);
  const titles = body.match(/<title>/g)?.length ?? 0;
  if (titles !== 1) fail(path, "title-count", `${titles} <title> tags`);
  const title = attr(h, /<title>([^<]*)<\/title>/);
  if (!title) fail(path, "title", "missing <title> in <head>");
  const description = attr(h, /<meta name="description" content="([^"]*)"/);
  if (!description || description.length < 30) fail(path, "description", `missing or short: ${description ?? "(none)"}`);
  const canonical = attr(h, /<link rel="canonical" href="([^"]*)"/);
  if (!canonical) fail(path, "canonical", "missing");
  else if (decodeURI(new URL(canonical).href) !== decodeURI(new URL(ORIGIN + path).href)) fail(path, "canonical", `points to ${canonical}`);
  const robots = attr(h, /<meta name="robots" content="([^"]*)"/);
  if (robots && /noindex/.test(robots)) fail(path, "robots", `sitemap page is noindex: ${robots}`);
  if (/http-equiv="refresh"/i.test(body)) fail(path, "meta-refresh", "page redirects via <meta refresh>");
  const h1 = body.match(/<h1[\s>]/g)?.length ?? 0;
  if (h1 !== 1) fail(path, "h1", `${h1} <h1> elements`);
  if (opts.jsonLd) {
    const blocks = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    if (blocks.length === 0) fail(path, "json-ld", "missing");
    for (const b of blocks) {
      try {
        const data = JSON.parse(b[1]);
        const types = (data["@graph"] ?? [data]).map((n: { "@type": string }) => n["@type"]);
        const expected = path.startsWith("/person/") ? ["Person"] : path.startsWith("/topic/") ? ["CollectionPage"] : ["Movie", "TVSeries"];
        if (!types.some((t: string) => expected.includes(t))) fail(path, "json-ld", `no ${expected.join("/")} node (${types.join(",")})`);
      } catch (err) {
        fail(path, "json-ld", `invalid JSON: ${(err as Error).message}`);
      }
    }
  }
  return { title, description };
}

async function checkRedirect(from: string, to: string) {
  const { status, location } = await get(from);
  if (status !== 308) return fail(from, "redirect", `expected 308, got ${status}`);
  const target = location ? new URL(location, BASE) : null;
  if (!target || decodeURI(target.pathname + target.search) !== decodeURI(to)) fail(from, "redirect", `-> ${location}, expected ${to}`);
  else {
    const next = await get(to);
    if (next.status !== 200) fail(from, "redirect-chain", `target answered ${next.status}`);
  }
}

async function sitemapUrls(): Promise<string[]> {
  const index = await get("/sitemap.xml", "follow");
  if (index.status !== 200) {
    fail("/sitemap.xml", "status", String(index.status));
    return [];
  }
  const children = [...index.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  const urls: string[] = [];
  for (const child of children) {
    const res = await get(child, "follow");
    if (res.status !== 200) fail(child, "status", String(res.status));
    urls.push(...[...res.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1].replace(/&amp;/g, "&")).pathname));
  }
  // recent.xml repeats titles that are also in titles-N.
  return [...new Set(urls)];
}

async function main() {
  const robots = await get("/robots.txt", "follow");
  if (!/Sitemap:\s*\S+\/sitemap\.xml/i.test(robots.body)) fail("/robots.txt", "sitemap", "no Sitemap line");

  const all = await sitemapUrls();
  const titlePages = all.filter((p) => p.split("/").length === 3 && p !== "/");
  const listPages = all.filter((p) => !titlePages.includes(p));
  const sample = titlePages.sort(() => Math.random() - 0.5).slice(0, Number(args.sample));
  console.log(`sitemap: ${all.length} urls (${titlePages.length} titles); checking ${listPages.length} list pages + ${sample.length} titles`);

  const seenTitles = new Map<string, string>();
  const seenDescriptions = new Map<string, string>();
  const queue = [...listPages.map((p) => ({ p, jsonLd: false })), ...sample.map((p) => ({ p, jsonLd: true }))];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const facts = await checkIndexablePage(item.p, { jsonLd: item.jsonLd });
      if (!facts) continue;
      if (facts.title) {
        const other = seenTitles.get(facts.title);
        if (other) fail(item.p, "duplicate-title", `same <title> as ${other}`);
        else seenTitles.set(facts.title, item.p);
      }
      if (facts.description && item.jsonLd) {
        const other = seenDescriptions.get(facts.description);
        if (other) fail(item.p, "duplicate-description", `same description as ${other}`);
        else seenDescriptions.set(facts.description, item.p);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  // Non-canonical forms of a real title URL must 308 once to the canonical one.
  const probe = sample.find((p) => !p.startsWith("/person/") && !p.startsWith("/topic/"));
  if (probe) {
    const [, segment, slug] = probe.split("/");
    const other = segment === "movie" ? "tv" : "movie";
    await checkRedirect(`/${other}/${slug}`, probe);
    await checkRedirect(`/${segment}/${encodeURIComponent(slug)}`, probe); // double-encoded
    // The player moved onto the title page: old /watch/ links land there, with a legacy
    // ?ep= selection carried in the fragment.
    await checkRedirect(`/watch${probe}`, probe);
    const legacy = await get(`/watch${probe}?ep=2`);
    const loc = legacy.location ? new URL(legacy.location, BASE) : null;
    if (legacy.status !== 308 || !loc || decodeURI(loc.pathname) !== decodeURI(probe) || loc.hash !== "#ep=2") {
      fail(`/watch${probe}?ep=2`, "redirect", `${legacy.status} -> ${legacy.location}, expected ${probe}#ep=2`);
    }
  }
  // Production only: www must 308 to the apex, root included.
  const baseUrl = new URL(BASE);
  if (!baseUrl.hostname.startsWith("www.") && baseUrl.hostname.split(".").length === 2 && baseUrl.protocol === "https:") {
    for (const p of ["/", "/tv"]) {
      const res = await fetch(`https://www.${baseUrl.hostname}${p}`, { redirect: "manual", headers: { "User-Agent": UA } }).catch(() => null);
      const loc = res?.headers.get("location");
      if (!res || res.status !== 308 || loc !== `${BASE}${p}`) fail(`www${p}`, "www-redirect", `${res?.status ?? "no response"} -> ${loc}`);
    }
  }

  for (const path of ["/movie/this-title-does-not-exist-1900", "/person/this-person-does-not-exist"]) {
    const missing = await get(path);
    if (missing.status !== 404) fail(path, "404", `got ${missing.status}`);
  }

  if (failures.length === 0) {
    console.log(`✓ all SEO checks passed (${seenTitles.size} pages)`);
    return;
  }
  const byCheck = new Map<string, Failure[]>();
  for (const f of failures) byCheck.set(f.check, [...(byCheck.get(f.check) ?? []), f]);
  for (const [check, list] of byCheck) {
    console.log(`✗ ${check}: ${list.length}`);
    for (const f of list.slice(0, 5)) console.log(`    ${decodeURI(f.url)}  ${f.detail}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
