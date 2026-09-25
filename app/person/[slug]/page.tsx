import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { PosterCard } from "@/components/PosterCard";
import { absoluteUrl, site } from "@/lib/config/site";
import { getPersonBySlug, personCredits, type PersonCredit, type PersonDetail } from "@/lib/data/people";
import { KIND_LABEL, KINDS } from "@/lib/domain/kinds";
import { decodeSlugParam, personPath } from "@/lib/domain/slug";
import { tmdbImage, tmdbImageUrl } from "@/lib/images";

// Rendered on first request, then served from the edge cache; each ingest marks it stale.
export const revalidate = 86400;
export async function generateStaticParams() {
  return [];
}

const HAN = /\p{Script=Han}/u;

/** "演员", "导演 · 演员": the person's roles, most frequent first. */
function roleSummary(credits: PersonCredit[]): string[] {
  const counts = new Map<string, number>();
  for (const c of credits) for (const r of c.roles) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
}

async function load(slugParam: string): Promise<{ person: PersonDetail; credits: PersonCredit[] }> {
  const person = await getPersonBySlug(decodeSlugParam(slugParam));
  if (!person) notFound();
  const credits = await personCredits(person.id);
  // No indexable titles left: nothing to show (the slug stays reserved).
  if (credits.length === 0) notFound();
  return { person, credits };
}

function verbOf(credits: PersonCredit[]): string {
  const role = roleSummary(credits)[0];
  return role === "演员" ? "参演" : role === "导演" ? "执导" : "参与";
}

/** "电影和电视剧": the two kinds the person has most titles in. */
function kindsOf(credits: PersonCredit[]): string {
  const counts = KINDS.map((k) => [k, credits.filter((c) => c.kind === k).length] as const).filter(([, n]) => n > 0);
  return counts
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => KIND_LABEL[k])
    .join("和");
}

function describe(person: PersonDetail, credits: PersonCredit[]): string {
  const verb = verbOf(credits);
  const top = [...credits]
    .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))
    .slice(0, 3)
    .map((c) => `《${c.name}》`)
    .join("");
  return `${person.name}${verb}的${credits.length}部${kindsOf(credits)}，包括${top}等。在${site.name}查看每部作品的简介、分集更新并在线观看。`;
}

export async function generateMetadata({ params }: PageProps<"/person/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const person = await getPersonBySlug(decodeSlugParam(slug));
  if (!person) return {};
  const credits = await personCredits(person.id);
  const path = personPath(person.slug);
  const title = `${person.name}${verbOf(credits)}的${kindsOf(credits)}（${credits.length}部）`;
  const image = tmdbImage(person.profile_path, "w185");
  return {
    title,
    description: describe(person, credits),
    alternates: { canonical: path },
    robots: person.indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { type: "profile", url: path, title, ...(image ? { images: [{ url: image, alt: person.name }] } : {}) },
  };
}

export default async function PersonPage({ params }: PageProps<"/person/[slug]">) {
  const { slug } = await params;
  const { person, credits } = await load(slug);
  const photo = tmdbImage(person.profile_path, "w185");
  const roles = roleSummary(credits);
  const path = personPath(person.slug);
  const years = credits.map((c) => c.year).filter((y): y is number => y != null);

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Person",
        "@id": `${absoluteUrl(path)}#person`,
        name: person.name,
        url: absoluteUrl(path),
        ...(person.profile_path ? { image: tmdbImageUrl(person.profile_path, "w185") } : {}),
        ...(roles.length ? { jobTitle: roles.join("、") } : {}),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: site.name, item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name: person.name, item: absoluteUrl(path) },
        ],
      },
    ],
  };

  return (
    <article className="mx-auto max-w-7xl px-4 pt-4 sm:pt-6">
      <JsonLd data={jsonLd} />
      <Breadcrumbs items={[{ name: "首页", href: "/" }, { name: person.name, href: path }]} />

      <header className="mt-4 flex items-center gap-4 sm:gap-6">
        <div className="size-20 shrink-0 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line sm:size-28">
          {photo ? <img src={photo} alt={person.name} width={112} height={112} className="size-full object-cover" /> : null}
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold sm:text-3xl">{person.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {roles.join(" · ")}
            <span className="mx-2 text-faint">|</span>
            {credits.length}部作品
            {years.length ? (
              <span className="ml-2 text-faint">
                {Math.min(...years)}–{Math.max(...years)}
              </span>
            ) : null}
          </p>
        </div>
      </header>

      {KINDS.map((kind) => {
        const list = credits.filter((c) => c.kind === kind);
        if (list.length === 0) return null;
        return (
          <section key={kind} className="mt-8">
            <h2 className="mb-3 text-lg font-semibold">
              {KIND_LABEL[kind]}
              <span className="ml-2 text-sm font-normal text-muted">{list.length}</span>
            </h2>
            <ul className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {list.map((c) => (
                <li key={c.id}>
                  <PosterCard title={c} note={c.character && HAN.test(c.character) ? `饰 ${c.character}` : c.roles.filter((r) => r !== "演员").join(" · ") || null} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </article>
  );
}
