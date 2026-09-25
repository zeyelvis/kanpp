import { absoluteUrl } from "@/lib/config/site";

// Content Signals (Cloudflare's robots.txt extension): may content be used for search results,
// as input to AI answers (with attribution/links), and for model training.
// Flip AI_TRAIN to "yes" to opt in to training use.
const AI_TRAIN = "no";

const body = `# Content signals: search = building a search index and showing links/snippets;
# ai-input = using content as input to AI answers; ai-train = training or fine-tuning models.
User-Agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=${AI_TRAIN}
Allow: /
Disallow: /search
Disallow: /me
Disallow: /api/
# Filtered channel listings are noindex; crawling them only spends the crawl budget.
# Plain pagination (?page=N) stays crawlable.
Disallow: /*?*genre=
Disallow: /*?*region=
Disallow: /*?*year=
Disallow: /*?*sort=

# SEO-tool crawlers: no search or AI-answer value for visitors, only load.
User-Agent: AhrefsBot
User-Agent: SemrushBot
User-Agent: MJ12bot
User-Agent: DotBot
User-Agent: BLEXBot
User-Agent: DataForSeoBot
User-Agent: Barkrowler
User-Agent: serpstatbot
User-Agent: SeekportBot
Disallow: /

Sitemap: ${absoluteUrl("/sitemap.xml")}
`;

export const dynamic = "force-static";

export function GET() {
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
