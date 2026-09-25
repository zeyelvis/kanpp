import { absoluteUrl } from "@/lib/config/site";
import { loadPersonPage } from "@/lib/data/people";
import { decodeSlugParam, personPath } from "@/lib/domain/slug";
import { personMarkdown } from "@/lib/seo/person";

/**
 * Markdown version of a person page. Reached only through proxy.ts: "/person/{slug}.md" or
 * the page URL with Accept: text/markdown. Not indexed; the HTML page is canonical.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/md-person/[slug]">) {
  const data = await loadPersonPage(decodeSlugParam((await params).slug));
  const headers = {
    "Content-Type": "text/markdown; charset=utf-8",
    "Cache-Control": "public, max-age=1800",
    "X-Robots-Tag": "noindex",
    Vary: "Accept",
  };
  if (!data) return new Response("# 404\n\n没有这位影人。\n", { status: 404, headers });
  const canonical = absoluteUrl(personPath(data.person.slug));
  return new Response(personMarkdown(data.person, data.credits, data.collaborators, data.billing), {
    headers: { ...headers, Link: `<${canonical}>; rel="canonical"` },
  });
}
