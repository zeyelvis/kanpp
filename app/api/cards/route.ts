import { titlesByIds } from "@/lib/data/titles";

export const dynamic = "force-dynamic";

/** Current card data for the viewer's followed titles (ids come from their localStorage). */
export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 90);
  const rows = ids.length ? await titlesByIds(ids) : [];
  return Response.json(rows, { headers: { "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" } });
}
