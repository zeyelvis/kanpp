import { absoluteUrl } from "@/lib/config/site";
import { sitemapPeople } from "@/lib/data/people";
import { sitemapTitles } from "@/lib/data/titles";
import { KIND_SEGMENT, KINDS } from "@/lib/domain/kinds";
import { personPath, titlePath } from "@/lib/domain/slug";
import { lastModified, TITLES_PER_SITEMAP, urlset, XML_HEADERS } from "@/lib/seo/sitemap";

export const revalidate = 3600;
export async function generateStaticParams() {
  return [];
}

export async function GET(_req: Request, ctx: RouteContext<"/sitemaps/[file]">) {
  const { file } = await ctx.params;

  if (file === "pages.xml") {
    const locs = ["/", "/schedule", ...KINDS.map((k) => `/${KIND_SEGMENT[k]}`)].map((p) => ({ loc: absoluteUrl(p) }));
    return new Response(urlset(locs), { headers: XML_HEADERS });
  }

  const people = file.match(/^people-(\d{1,4})\.xml$/);
  if (people) {
    const rows = await sitemapPeople(Number(people[1]) * TITLES_PER_SITEMAP, TITLES_PER_SITEMAP);
    if (rows.length === 0) return new Response("Not found", { status: 404 });
    const entries = rows.map((r) => ({ loc: absoluteUrl(personPath(r.slug)), lastmod: lastModified(r.updated_at, null) }));
    return new Response(urlset(entries), { headers: XML_HEADERS });
  }

  const m = file.match(/^titles-(\d{1,4})\.xml$/);
  if (!m) return new Response("Not found", { status: 404 });
  const rows = await sitemapTitles(Number(m[1]) * TITLES_PER_SITEMAP, TITLES_PER_SITEMAP);
  if (rows.length === 0 && m[1] !== "0") return new Response("Not found", { status: 404 });
  const entries = rows.map((r) => ({
    loc: absoluteUrl(titlePath(r.kind, r.slug)),
    lastmod: lastModified(r.updated_at, r.source_updated_at),
  }));
  return new Response(urlset(entries), { headers: XML_HEADERS });
}
