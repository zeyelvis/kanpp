import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // /watch stays crawlable so its noindex is seen; /search is an infinite URL space.
    rules: [{ userAgent: "*", allow: "/", disallow: ["/search"] }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
