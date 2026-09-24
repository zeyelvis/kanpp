import { absoluteUrl } from "@/lib/config/site";
import { countIndexable } from "@/lib/data/titles";
import { sitemapIndex, TITLES_PER_SITEMAP, XML_HEADERS } from "@/lib/seo/sitemap";

export const dynamic = "force-dynamic";

export async function GET() {
  const chunks = Math.max(1, Math.ceil((await countIndexable()) / TITLES_PER_SITEMAP));
  const locs = [absoluteUrl("/sitemaps/pages.xml"), ...Array.from({ length: chunks }, (_, i) => absoluteUrl(`/sitemaps/titles-${i}.xml`))];
  return new Response(sitemapIndex(locs), { headers: XML_HEADERS });
}
