import { absoluteUrl } from "@/lib/config/site";
import { sitemapPeople } from "@/lib/data/people";
import { maxTitleId, recentSitemapTitles, sitemapTitles } from "@/lib/data/titles";
import { topicCounts } from "@/lib/data/topics";
import { allTopics, MIN_TOPIC_TITLES, topicPath } from "@/lib/domain/topics";
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
    const locs = ["/", "/schedule", ...KINDS.map((k) => `/${KIND_SEGMENT[k]}`), "/topic", "/about", "/privacy", "/terms", "/dmca"].map((p) => ({ loc: absoluteUrl(p) }));
    return new Response(urlset(locs), { headers: XML_HEADERS });
  }

  if (file === "topics.xml") {
    // Only topics with enough titles to be indexed.
    const counts = await topicCounts();
    const entries = allTopics().filter((t) => (counts[t.name]?.count ?? 0) >= MIN_TOPIC_TITLES).map((t) => ({ loc: absoluteUrl(topicPath(t)) }));
    return new Response(urlset(entries), { headers: XML_HEADERS });
  }

  if (file === "recent.xml") {
    const rows = await recentSitemapTitles(5000);
    const entries = rows.map((r) => ({ loc: absoluteUrl(titlePath(r.kind, r.slug)), lastmod: lastModified(r.updated_at, r.source_updated_at) }));
    return new Response(urlset(entries), { headers: XML_HEADERS });
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
  const n = Number(m[1]);
  if (n > 0 && n * TITLES_PER_SITEMAP >= (await maxTitleId())) return new Response("Not found", { status: 404 });
  const rows = await sitemapTitles(n * TITLES_PER_SITEMAP, (n + 1) * TITLES_PER_SITEMAP);
  const entries = rows.map((r) => ({
    loc: absoluteUrl(titlePath(r.kind, r.slug)),
    lastmod: lastModified(r.updated_at, r.source_updated_at),
  }));
  return new Response(urlset(entries), { headers: XML_HEADERS });
}
