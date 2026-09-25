import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Always emit <title>/<meta>/canonical in <head> for every client, not streamed into
  // <body>: not every crawler reads body-appended metadata, and our D1 reads are fast.
  htmlLimitedBots: /.*/,
  images: {
    // Images are served pre-sized from our own /img route (worker.ts); no optimizer needed.
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
  // Security headers are added to every response in worker.ts (lib/edge/security-headers.ts):
  // pages served from the ISR cache never pass through Next's header rules.
};

export default nextConfig;

initOpenNextCloudflareForDev();
