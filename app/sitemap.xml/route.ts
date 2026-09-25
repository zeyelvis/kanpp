import { absoluteUrl } from "@/lib/config/site";
import { countPeople } from "@/lib/data/people";
import { countIndexable } from "@/lib/data/titles";
import { sitemapIndex, TITLES_PER_SITEMAP, XML_HEADERS } from "@/lib/seo/sitemap";

export const revalidate = 3600;

export async function GET() {
  const [titles, people] = await Promise.all([countIndexable(), countPeople()]);
  const chunks = Math.max(1, Math.ceil(titles / TITLES_PER_SITEMAP));
  const personChunks = Math.ceil(people / TITLES_PER_SITEMAP);
  const locs = [
    absoluteUrl("/sitemaps/pages.xml"),
    // Recently updated titles first (also listed in titles-N): fresh episodes get re-crawled.
    absoluteUrl("/sitemaps/recent.xml"),
    absoluteUrl("/sitemaps/topics.xml"),
    ...Array.from({ length: chunks }, (_, i) => absoluteUrl(`/sitemaps/titles-${i}.xml`)),
    ...Array.from({ length: personChunks }, (_, i) => absoluteUrl(`/sitemaps/people-${i}.xml`)),
  ];
  return new Response(sitemapIndex(locs), { headers: XML_HEADERS });
}
