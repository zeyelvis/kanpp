import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { after } from "next/server";
import { SearchBox } from "@/components/nav/SearchBox";
import { PosterGrid } from "@/components/PosterCard";
import { loadPersonPage, searchPeople } from "@/lib/data/people";
import { recordSearch } from "@/lib/data/search-log";
import { featuredTitles, searchTitles } from "@/lib/data/titles";
import { personPath, titlePath } from "@/lib/domain/slug";
import { tmdbImage } from "@/lib/images";
import { knownFor } from "@/lib/seo/person";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "搜索",
  robots: { index: false, follow: true },
};

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw ?? "").trim().slice(0, 50);
  const [results, people, hot] = await Promise.all([
    q ? searchTitles(q, 48, { inside: true }) : Promise.resolve([]),
    q ? searchPeople(q) : Promise.resolve([]),
    q ? Promise.resolve([]) : featuredTitles(12),
  ]);
  // A person's name and no title by that name: show the person's best-known works.
  const exact = people.find((p) => p.name === q);
  const person = exact && results.length === 0 ? await loadPersonPage(exact.slug) : null;
  const works = person ? knownFor(person.credits, 24, person.billing) : [];
  // Count searches people make (browsers send Sec-Fetch-Mode; crawlers and scripts mostly do
  // not): the ones with no results are the catalog's to-do list. After the response is sent.
  if (q && (await headers()).get("sec-fetch-mode") === "navigate") {
    after(() => recordSearch(q, results.length + people.length).catch(() => undefined));
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 sm:pt-8">
      <h1 className="sr-only">搜索</h1>
      <SearchBox key={q} defaultValue={q} autoFocus={!q} className="max-w-2xl" />
      {q ? (
        <>
          <p className="mt-6 text-sm text-muted">
            “{q}”找到 {[results.length || !people.length ? `${results.length} 部作品` : null, people.length ? `${people.length} 位影人` : null].filter(Boolean).join("、")}
          </p>
          {people.length ? (
            <section aria-labelledby="people" className="mt-4">
              <h2 id="people" className="sr-only">
                影人
              </h2>
              <ul className="flex flex-wrap gap-2">
                {people.map((p) => {
                  const avatar = tmdbImage(p.profile_path, "w185");
                  return (
                    <li key={p.slug}>
                      <Link href={personPath(p.slug)} className="flex items-center gap-2 rounded-full bg-surface py-1 pl-1 pr-3 ring-1 ring-line hover:ring-accent/60">
                        <span className="size-8 overflow-hidden rounded-full bg-surface-2">
                          {avatar ? <img src={avatar} alt="" width={32} height={32} className="size-full object-cover" /> : null}
                        </span>
                        <span className="text-sm">{p.name}</span>
                        <span className="text-xs text-muted">{p.title_count}部</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          <div className="mt-4">
            {results.length ? (
              <PosterGrid titles={results} />
            ) : works.length ? (
              <section aria-labelledby="works">
                <h2 id="works" className="mb-3 mt-2 text-base font-semibold">
                  {person!.person.name}的代表作
                </h2>
                <PosterGrid titles={works} />
              </section>
            ) : people.length ? null : (
              <p className="py-12 text-muted">没有找到相关作品。试试更短的片名，或者换成简体、繁体再搜一次。</p>
            )}
          </div>
        </>
      ) : hot.length ? (
        <section aria-labelledby="hot" className="mt-8">
          <h2 id="hot" className="mb-3 text-base font-semibold">
            大家在看
          </h2>
          <ol className="grid gap-x-6 sm:grid-cols-2">
            {hot.map((t, i) => (
              <li key={t.id}>
                <Link href={titlePath(t.kind, t.slug)} className="flex items-center gap-3 border-b border-line py-2.5 hover:text-accent">
                  <span className={`w-5 text-center text-sm font-bold ${i < 3 ? "text-accent" : "text-faint"}`}>{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {t.latest_label ? <span className="shrink-0 text-xs text-faint">{t.latest_label}</span> : null}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
