import { NextResponse, type NextRequest } from "next/server";
import { KIND_SEGMENT } from "@/lib/domain/kinds";
import { decodeSlugParam, isOverEncoded, parseWatchState, playFragment } from "@/lib/domain/slug";
import { prefersMarkdown } from "@/lib/seo/negotiate";

const TITLE_SEGMENTS = new Set(Object.values(KIND_SEGMENT));

/**
 * Runs before the ISR cache, so these are real 308s:
 * - /watch/{kind}/{slug}: the player moved onto the title page. Old links (and their
 *   ?s=&ep=&line= query) go to the title page with the selection in the fragment. A fragment
 *   already on the old URL is carried over by the browser.
 * - Over-encoded title URLs (e.g. "%25E5%2585...") go to their clean form; the cache would
 *   otherwise serve the canonical page with a 200 under the duplicate URL.
 * - Title pages as Markdown for AI agents: "{title URL}.md", or the title URL itself with
 *   Accept: text/markdown, is rewritten to app/api/md.
 */
export function proxy(request: NextRequest) {
  const segments = request.nextUrl.pathname.split("/");
  const clean = (s: string) => (s ? encodeURIComponent(decodeSlugParam(s)) : s);

  if (segments[1] === "watch") {
    const url = request.nextUrl.clone();
    url.pathname = ["", ...segments.slice(2, 4)].map(clean).join("/");
    const state = parseWatchState(request.nextUrl.searchParams);
    url.search = "";
    // Only a query to convert gets an explicit fragment; otherwise the browser keeps its own.
    url.hash = state.season || state.ep || state.line ? playFragment(state) : "";
    return NextResponse.redirect(url, 308);
  }

  // ["", kind, slug]: a title page, not a season page or a list.
  if (segments.length === 3 && segments[2] && TITLE_SEGMENTS.has(segments[1])) {
    const suffix = segments[2].endsWith(".md");
    if (suffix || prefersMarkdown(request.headers.get("accept"))) {
      const url = request.nextUrl.clone();
      url.pathname = `/api/md/${segments[1]}/${suffix ? segments[2].slice(0, -3) : segments[2]}`;
      url.search = suffix ? "?via=md" : "";
      return NextResponse.rewrite(url);
    }
  }

  if (!segments.some((s) => s && isOverEncoded(s))) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = segments.map(clean).join("/");
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: ["/movie/:path+", "/tv/:path+", "/anime/:path+", "/variety/:path+", "/documentary/:path+", "/watch/:path*", "/person/:path+", "/topic/:path+"],
};
