import { absoluteUrl } from "@/lib/config/site";
import { personSlugs } from "@/lib/data/people";
import { resolveTitle } from "@/lib/data/resolve-page";
import { getLines, getSeasons, getUpdates, relatedTitles } from "@/lib/data/titles";
import { titlePath } from "@/lib/domain/slug";
import { topicsForTitle } from "@/lib/domain/topics";
import { updateTimeline } from "@/lib/domain/updates";
import { titleMarkdown } from "@/lib/seo/markdown";

/**
 * Markdown version of a title page. Reached only through proxy.ts: "{title URL}.md" (?via=md)
 * or the title URL itself with Accept: text/markdown. Not indexed; the HTML page is canonical.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/md/[kind]/[slug]">) {
  const result = await resolveTitle(await params);
  const viaSuffix = new URL(request.url).searchParams.get("via") === "md";
  if (!result) return new Response("# 404\n\n没有这部作品。\n", { status: 404, headers: headers() });
  if ("redirect" in result) {
    const location = absoluteUrl(viaSuffix ? `${result.redirect}.md` : result.redirect);
    return new Response(null, { status: 308, headers: { ...headers(), Location: location } });
  }

  const t = result.title;
  const [seasons, lines, related, people, updates] = await Promise.all([
    getSeasons(t.id),
    getLines(t.id, t.tmdb_type),
    relatedTitles(t, 12),
    personSlugs([...t.cast.slice(0, 8), ...t.crew].map((p) => p.id).filter((id): id is number => id != null)),
    getUpdates(t.id),
  ]);
  const body = titleMarkdown({ title: t, seasons, lines, timeline: updateTimeline(updates), related, topics: topicsForTitle(t), people });
  const canonical = absoluteUrl(titlePath(t.kind, t.slug));
  return new Response(body, { headers: { ...headers(), Link: `<${canonical}>; rel="canonical"` } });
}

function headers(): Record<string, string> {
  return {
    "Content-Type": "text/markdown; charset=utf-8",
    "Cache-Control": "public, max-age=1800",
    "X-Robots-Tag": "noindex",
    Vary: "Accept",
  };
}
