export const TITLES_PER_SITEMAP = 20_000;

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

export function urlset(entries: { loc: string; lastmod?: string }[]): string {
  const body = entries
    .map((e) => `<url><loc>${escapeXml(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}</url>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

export function sitemapIndex(locs: string[]): string {
  const body = locs.map((l) => `<sitemap><loc>${escapeXml(l)}</loc></sitemap>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`;
}

/**
 * SQLite datetime('now') values are UTC; CMS vod_time values are China time (UTC+8).
 * Returns the later of the two as an ISO-8601 UTC timestamp.
 */
export function lastModified(updatedAtUtc: string | null, sourceTimeCst: string | null): string | undefined {
  const times = [
    updatedAtUtc ? Date.parse(`${updatedAtUtc.replace(" ", "T")}Z`) : NaN,
    sourceTimeCst ? Date.parse(`${sourceTimeCst.replace(" ", "T")}+08:00`) : NaN,
  ].filter((t) => Number.isFinite(t));
  return times.length ? new Date(Math.max(...times)).toISOString() : undefined;
}

export const XML_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=3600",
};
