import { NextResponse, type NextRequest } from "next/server";
import { decodeSlugParam, isOverEncoded } from "@/lib/domain/slug";

/**
 * Over-encoded title/watch URLs (e.g. "%25E5%2585...") 308 to their clean form. This must
 * run here, before the ISR cache: the cache normalizes the path and would otherwise serve
 * the canonical page with a 200 under the duplicate URL.
 */
export function proxy(request: NextRequest) {
  const segments = request.nextUrl.pathname.split("/");
  if (!segments.some((s) => s && isOverEncoded(s))) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = segments.map((s) => (s ? encodeURIComponent(decodeSlugParam(s)) : s)).join("/");
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: ["/movie/:path+", "/tv/:path+", "/anime/:path+", "/variety/:path+", "/documentary/:path+", "/watch/:path+"],
};
