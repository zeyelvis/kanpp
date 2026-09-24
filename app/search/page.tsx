import type { Metadata } from "next";
import Link from "next/link";
import { SearchBox } from "@/components/nav/SearchBox";
import { PosterGrid } from "@/components/PosterCard";
import { featuredTitles, searchTitles } from "@/lib/data/titles";
import { titlePath } from "@/lib/domain/slug";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "搜索",
  robots: { index: false, follow: true },
};

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw ?? "").trim().slice(0, 50);
  const [results, hot] = await Promise.all([q ? searchTitles(q) : Promise.resolve([]), q ? Promise.resolve([]) : featuredTitles(12)]);

  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 sm:pt-8">
      <h1 className="sr-only">搜索</h1>
      <SearchBox key={q} defaultValue={q} autoFocus={!q} className="max-w-2xl" />
      {q ? (
        <>
          <p className="mt-6 text-sm text-muted">
            “{q}”找到 {results.length} 部
          </p>
          <div className="mt-4">
            {results.length ? (
              <PosterGrid titles={results} />
            ) : (
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
