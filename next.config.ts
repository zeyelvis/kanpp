import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Always emit <title>/<meta>/canonical in <head> for every client, not streamed into
  // <body>: not every crawler reads body-appended metadata, and our D1 reads are fast.
  htmlLimitedBots: /.*/,
  images: {
    // Posters come straight from the TMDB CDN at pre-sized widths; no optimizer needed.
    unoptimized: true,
  },
  async redirects() {
    const www = [{ type: "host" as const, value: "www.kanpp.tv" }];
    return [
      // The root needs its own rule: an empty wildcard match is left unexpanded in the target.
      { source: "/", has: www, destination: "https://kanpp.tv/", permanent: true },
      { source: "/:path+", has: www, destination: "https://kanpp.tv/:path+", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;

initOpenNextCloudflareForDev();
