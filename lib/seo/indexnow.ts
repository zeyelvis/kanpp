import { absoluteUrl, site } from "@/lib/config/site";

/**
 * IndexNow ownership key. Not a secret: engines verify it by fetching the key file this site
 * serves at /{key}.txt (public/).
 */
export const INDEXNOW_KEY = "5c85f9f9e854e15611ce77e62ac5270d";
/**
 * Any participating engine shares a submission with the others. api.indexnow.org answers 429
 * to the ingest Worker (shared Cloudflare egress) while accepting the same batch from
 * elsewhere, so a refused batch goes to the engines' own endpoints next.
 */
const ENDPOINTS = ["https://api.indexnow.org/indexnow", "https://www.bing.com/indexnow", "https://yandex.com/indexnow"];
// The protocol allows 10,000 URLs per request, but percent-encoded Chinese URLs make that a
// ~1.5 MB body, which the endpoint drops. 2,000 keeps each request around 300 KB.
const MAX_URLS = 2_000;

/**
 * Tells IndexNow engines (Bing, Yandex, Naver, Seznam, Yep) which pages are new or changed.
 * Google does not use IndexNow; it finds changes through the sitemaps' lastmod.
 */
export async function submitIndexNow(paths: string[], fetcher: typeof fetch = fetch, pauseMs = 2000): Promise<string> {
  if (paths.length === 0) return "nothing to submit";
  if (new URL(site.url).host !== site.domain) return `skipped (site url ${site.url})`;
  const results: string[] = [];
  const via = new Set<string>();
  for (let i = 0; i < paths.length; i += MAX_URLS) {
    const body = JSON.stringify({
      host: site.domain,
      key: INDEXNOW_KEY,
      keyLocation: absoluteUrl(`/${INDEXNOW_KEY}.txt`),
      urlList: paths.slice(i, i + MAX_URLS).map(absoluteUrl),
    });
    let status = "failed";
    for (const endpoint of ENDPOINTS) {
      // Server errors and network failures are retried once; a 429 moves on to the next engine.
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetcher(endpoint, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body }).catch(() => null);
        status = res ? String(res.status) : "network-error";
        await res?.body?.cancel();
        if (res && res.status < 500) break;
        await new Promise((r) => setTimeout(r, pauseMs));
      }
      if (/^2/.test(status)) {
        if (endpoint !== ENDPOINTS[0]) via.add(new URL(endpoint).host);
        break;
      }
      // Any other 4xx means the request itself is wrong (key, host): no engine will take it.
      if (/^4/.test(status) && status !== "429") break;
    }
    results.push(status);
    if (!/^2/.test(status)) break;
  }
  return `${paths.length} urls: ${results.join(",")}${via.size ? ` via ${[...via].join(",")}` : ""}`;
}
