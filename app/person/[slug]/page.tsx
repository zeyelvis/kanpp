import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { PosterCard } from "@/components/PosterCard";
import { ScrollRail } from "@/components/ScrollRail";
import { absoluteUrl, site } from "@/lib/config/site";
import { loadPersonPage } from "@/lib/data/people";
import { KIND_LABEL } from "@/lib/domain/kinds";
import { decodeSlugParam, personPath, titlePath } from "@/lib/domain/slug";
import { tmdbImage, tmdbImageUrl } from "@/lib/images";
import { creditNote, creditsByYear, describePerson, knownFor, personFacts, personTitle, roleSummary } from "@/lib/seo/person";

// Rendered on first request, then served from the edge cache; each ingest marks it stale.
export const revalidate = 86400;
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: PageProps<"/person/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadPersonPage(decodeSlugParam(slug));
  if (!data) return {};
  const { person, credits, billing } = data;
  const path = personPath(person.slug);
  const title = personTitle(person, credits);
  const image = tmdbImage(person.profile_path, "w185");
  return {
    title,
    description: describePerson(person, credits, billing),
    alternates: { canonical: path },
    robots: person.indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { type: "profile", url: path, title, ...(image ? { images: [{ url: image, alt: person.name }] } : {}) },
  };
}

export default async function PersonPage({ params }: PageProps<"/person/[slug]">) {
  const { slug } = await params;
  const data = await loadPersonPage(decodeSlugParam(slug));
  if (!data) notFound();
  const { person, credits, collaborators, billing } = data;
  const photo = tmdbImage(person.profile_path, "w185");
  const roles = roleSummary(credits);
  const path = personPath(person.slug);
  const years = credits.map((c) => c.year).filter((y): y is number => y != null);
  const facts = personFacts(person, credits, collaborators, billing);
  const known = knownFor(credits, 12, billing);

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Person",
        "@id": `${absoluteUrl(path)}#person`,
        name: person.name,
        url: absoluteUrl(path),
        description: facts,
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
    <article className="pb-4">
      <JsonLd data={jsonLd} />
      <div className="mx-auto max-w-7xl px-4 pt-4 sm:pt-6">
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

        <section aria-labelledby="facts" className="mt-6 max-w-4xl">
          <h2 id="facts" className="mb-2 text-lg font-semibold">
            影人速览
          </h2>
          <p className="leading-7 text-ink/85">{facts}</p>
        </section>
      </div>

      {known.length > 1 ? (
        <ScrollRail id="known-for" title="代表作">
          {known.map((c, i) => (
            <li key={c.id} className="w-[30%] shrink-0 snap-start sm:w-40 lg:w-[calc((100%-5*0.75rem)/6)]">
              <PosterCard title={c} eager={i < 6} note={creditNote(c)} />
            </li>
          ))}
        </ScrollRail>
      ) : null}

      <section aria-labelledby="timeline" className="mx-auto max-w-7xl px-4 pt-8 sm:pt-10">
        <h2 id="timeline" className="mb-4 text-lg font-semibold sm:text-xl">
          作品年表
          <span className="ml-2 text-sm font-normal text-muted">{credits.length}部</span>
        </h2>
        <div className="space-y-5">
          {creditsByYear(credits).map((g) => (
            <div key={g.year ?? "unknown"} className="grid gap-x-6 sm:grid-cols-[4rem_minmax(0,1fr)]">
              <h3 className="mb-1.5 text-sm font-semibold tabular-nums text-muted sm:mb-0 sm:pt-0.5">{g.year ?? "年份未知"}</h3>
              <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {g.credits.map((c) => {
                  const note = creditNote(c);
                  return (
                    <li key={c.id} className="min-w-0 truncate text-sm">
                      <Link href={titlePath(c.kind, c.slug)} className="font-medium hover:text-accent">
                        {c.name}
                      </Link>
                      <span className="text-muted">
                        {" · "}
                        {KIND_LABEL[c.kind]}
                        {note ? ` · ${note}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {collaborators.length ? (
        <section aria-labelledby="collaborators" className="mx-auto max-w-7xl px-4 pt-8 sm:pt-10">
          <h2 id="collaborators" className="mb-3 text-lg font-semibold sm:text-xl">
            常合作的影人
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {collaborators.map((c) => {
              const avatar = tmdbImage(c.profile_path, "w185");
              return (
                <li key={c.id}>
                  <Link href={personPath(c.slug)} className="flex items-center gap-3 rounded-xl bg-surface/60 p-2.5 ring-1 ring-line hover:ring-accent/60">
                    <span className="size-11 shrink-0 overflow-hidden rounded-full bg-surface-2">
                      {avatar ? <img src={avatar} alt="" loading="lazy" width={44} height={44} className="size-full object-cover" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {c.role} · 合作 {c.shared} 部
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
