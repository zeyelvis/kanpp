import { site } from "@/lib/config/site";

/**
 * Tells the live site which cached pages/data are stale after an ingest run. Skipped when no
 * secret is configured (e.g. local runs against the dev database).
 */
export async function notifySite(payload: { titleIds: number[]; created: boolean; catalog: boolean }): Promise<string> {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return "skipped (REVALIDATE_SECRET not set)";
  const base = process.env.SITE_URL ?? site.url;
  const results: string[] = [];
  // Chunked so a large backfill stays within request limits.
  for (let i = 0; i === 0 || i < payload.titleIds.length; i += 1000) {
    const chunk = payload.titleIds.slice(i, i + 1000);
    const first = i === 0;
    const res = await fetch(`${base}/api/revalidate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ titleIds: chunk, created: first && payload.created, catalog: first && payload.catalog }),
    });
    results.push(`${res.status}`);
    if (!res.ok) break;
  }
  return results.join(",");
}
