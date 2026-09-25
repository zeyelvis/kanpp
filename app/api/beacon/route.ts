import { recordPlayback, viewerCountry } from "@/lib/data/playback";
import { sentFromOwnPage } from "@/lib/edge/rate-limit";
import { getSource } from "@/lib/sources/registry";

export const dynamic = "force-dynamic";

/**
 * Player beacon (navigator.sendBeacon): did a line reach the first frame, and how fast?
 * Stored only as daily counts per country and line.
 */
export async function POST(req: Request) {
  // Reports only count from our own player; worker.ts also rate-limits this route per visitor.
  if (!sentFromOwnPage(req)) return new Response(null, { status: 403 });
  if (Number(req.headers.get("content-length") ?? 0) > 1024) return new Response(null, { status: 413 });
  let body: { line?: unknown; ok?: unknown; ms?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof body.line !== "string" || !getSource(body.line) || typeof body.ok !== "boolean") {
    return new Response(null, { status: 400 });
  }
  const ms = typeof body.ms === "number" && Number.isFinite(body.ms) ? Math.min(Math.max(Math.round(body.ms), 0), 120_000) : 0;
  await recordPlayback({ country: viewerCountry(req.headers.get("cf-ipcountry")), sourceId: body.line, ok: body.ok, ttffMs: ms });
  return new Response(null, { status: 204 });
}
