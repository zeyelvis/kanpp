import { getCloudflareContext } from "@opennextjs/cloudflare";
import { revalidateTag } from "next/cache";
import { TAG } from "@/lib/data/cache";

export const dynamic = "force-dynamic";

interface Body {
  /** Titles whose record, seasons or lines changed. */
  titleIds?: number[];
  /** New titles (or slugs) were created: drop cached slug lookups, including cached 404s. */
  created?: boolean;
  /** Lists, counts and sitemaps changed. */
  catalog?: boolean;
}

async function secret(): Promise<string | undefined> {
  const { env } = await getCloudflareContext({ async: true });
  return (env as unknown as { REVALIDATE_SECRET?: string }).REVALIDATE_SECRET ?? process.env.REVALIDATE_SECRET;
}

/** Called by the ingest job after it writes to D1. */
export async function POST(req: Request) {
  const expected = await secret();
  if (!expected || req.headers.get("authorization") !== `Bearer ${expected}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  const ids = [...new Set((body.titleIds ?? []).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 5000);
  // Title data: serve stale while the next visit refreshes it.
  for (const id of ids) revalidateTag(TAG.title(id), "max");
  // Slug lookups: expire now, so a title that was a cached 404 appears on the next request.
  if (body.created) revalidateTag(TAG.slugs, { expire: 0 });
  if (body.catalog) revalidateTag(TAG.catalog, "max");
  return Response.json({ ok: true, titles: ids.length, created: Boolean(body.created), catalog: Boolean(body.catalog) });
}
