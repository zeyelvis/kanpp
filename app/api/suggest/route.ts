import { searchPeople } from "@/lib/data/people";
import { searchTitles } from "@/lib/data/titles";
import { KIND_LABEL } from "@/lib/domain/kinds";
import { personPath, titlePath } from "@/lib/domain/slug";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 40);
  const [titles, people] = q ? await Promise.all([searchTitles(q, 8), searchPeople(q, 3)]) : [[], []];
  // People after the titles unless the query is exactly a person's name.
  const personRows = people.map((p) => ({ name: p.name, year: null, kindLabel: `影人 · ${p.title_count}部作品`, href: personPath(p.slug), poster: p.profile_path }));
  const titleRows = titles.map((t) => ({ name: t.name, year: t.year, kindLabel: KIND_LABEL[t.kind], href: titlePath(t.kind, t.slug), poster: t.poster_path }));
  const exactPerson = people[0]?.name === q;
  return Response.json(
    (exactPerson ? [...personRows.slice(0, 1), ...titleRows, ...personRows.slice(1)] : [...titleRows, ...personRows]).slice(0, 10),
    { headers: { "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" } },
  );
}
