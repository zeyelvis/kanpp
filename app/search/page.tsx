import type { Metadata } from "next";
import { PosterGrid } from "@/components/PosterCard";
import { searchTitles } from "@/lib/data/titles";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "搜索",
  robots: { index: false, follow: true },
};

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw ?? "").trim().slice(0, 50);
  const results = q ? await searchTitles(q) : [];

  return (
    <div className="mx-auto max-w-7xl px-4 pt-8">
      <form action="/search" method="get" role="search" className="flex gap-2">
        <input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="输入片名，简体繁体都可以"
          aria-label="搜索片名"
          autoFocus={!q}
          className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-4 outline-none placeholder:text-faint focus:border-accent"
        />
        <button type="submit" className="h-11 rounded-lg bg-accent px-5 font-medium text-white">
          搜索
        </button>
      </form>
      {q ? (
        <>
          <h1 className="mt-8 text-lg">
            “{q}”的搜索结果 <span className="text-sm text-muted">{results.length} 部</span>
          </h1>
          <div className="mt-4">
            {results.length ? <PosterGrid titles={results} /> : <p className="text-muted">没有找到相关作品，换个片名试试。</p>}
          </div>
        </>
      ) : null}
    </div>
  );
}
