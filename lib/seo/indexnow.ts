import { absoluteUrl, site } from "@/lib/config/site";

/**
 * IndexNow ownership key. Not a secret: engines verify it by fetching the key file this site
 * serves at /{key}.txt (public/).
 */
export const INDEXNOW_KEY = "5c85f9f9e854e15611ce77e62ac5270d";
const ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS = 10_000;

/**
 * Tells IndexNow engines (Bing, Yandex, Naver, Seznam, Yep) which pages are new or changed.
 * Google does not use IndexNow; it finds changes through the sitemaps' lastmod.
 */
export async function submitIndexNow(paths: string[]): Promise<string> {
  if (paths.length === 0) return "nothing to submit";
  if (new URL(site.url).host !== site.domain) return `skipped (site url ${site.url})`;
  const results: string[] = [];
  for (let i = 0; i < paths.length; i += MAX_URLS) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: site.domain,
        key: INDEXNOW_KEY,
        keyLocation: absoluteUrl(`/${INDEXNOW_KEY}.txt`),
        urlList: paths.slice(i, i + MAX_URLS).map(absoluteUrl),
      }),
    });
    results.push(String(res.status));
    if (!res.ok) break;
  }
  return `${paths.length} urls: ${results.join(",")}`;
}
