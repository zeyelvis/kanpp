import { searchTitles } from "@/lib/data/titles";
import { KIND_LABEL } from "@/lib/domain/kinds";
import { titlePath } from "@/lib/domain/slug";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 40);
  const titles = q ? await searchTitles(q, 8) : [];
  return Response.json(
    titles.map((t) => ({ name: t.name, year: t.year, kindLabel: KIND_LABEL[t.kind], href: titlePath(t.kind, t.slug), poster: t.poster_path })),
    { headers: { "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" } },
  );
}
