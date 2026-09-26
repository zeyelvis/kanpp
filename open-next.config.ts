import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import d1NextTagCache from "@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache";
import { softTagFilter, withFilter } from "@opennextjs/cloudflare/overrides/tag-cache/tag-cache-filter";
import { withCacheTimeouts, withTagTimeouts } from "./lib/edge/cache-timeouts";

// ISR pages and unstable_cache data live in R2, fronted by the per-region Cache API.
// Time-based revalidation runs through a Durable Object queue; revalidateTag timestamps
// live in a dedicated D1 database (never the catalog database).
// Every cache call is time-limited (lib/edge/cache-timeouts.ts): the outer limit covers the
// Cache API and R2 together; the inner R2 one only logs, to tell which of the two was slow.
export default defineCloudflareConfig({
  incrementalCache: withCacheTimeouts(
    withRegionalCache(withCacheTimeouts(r2IncrementalCache, "r2", { getMs: 30_000, setMs: 30_000 }), { mode: "long-lived" }),
    "cache",
    { getMs: 2500, setMs: 10_000 },
  ),
  queue: doQueue,
  // We only ever call revalidateTag, never revalidatePath: skip Next's implicit path tags.
  // Tag checks normally take ~10 ms; after one times out the next 10 s skip the database.
  tagCache: withFilter({ tagCache: withTagTimeouts(d1NextTagCache, 500, 10_000), filterFn: softTagFilter }),
  // Serve cached ISR pages before Next runs. Besides skipping a render setup per hit, this
  // judges staleness by the revalidate stored with each entry: Next itself only knows it for
  // pages generated in the same isolate and assumes 1 second otherwise, so on Workers every
  // on-demand ISR page (all title pages) looked stale and was re-rendered on most requests.
  enableCacheInterception: true,
});
