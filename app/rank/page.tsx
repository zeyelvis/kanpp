import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RankList } from "@/components/home/RankList";
import { DEFAULT_OG_IMAGE, site } from "@/lib/config/site";
import { hotTitles, SECTIONS, type ChartKind } from "@/lib/data/home";
import { KIND_LABEL } from "@/lib/domain/kinds";

export const revalidate = 900;

export const metadata: Metadata = {
  title: "热播排行榜 - 电视剧、电影、动漫、综艺排行榜",
  description: `${site.name}热播排行榜：电视剧、电影、动漫、综艺各自的热度榜，按豆瓣热门和各线路热度排序，每4小时更新，每部都能在线观看。`,
  alternates: { canonical: "/rank" },
  openGraph: { url: "/rank", images: [DEFAULT_OG_IMAGE] },
};

export default async function RankIndexPage() {
  const kinds = Object.keys(SECTIONS) as ChartKind[];
  const charts = await Promise.all(kinds.map((k) => hotTitles(SECTIONS[k].chart, 10)));
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 pt-4 sm:pt-6">
      <header className="space-y-3">
        <Breadcrumbs items={[{ name: "首页", href: "/" }, { name: "排行榜", href: "/rank" }]} />
        <h1 className="text-2xl font-bold sm:text-3xl">热播排行榜</h1>
        <p className="max-w-3xl text-muted">电视剧、电影、动漫、综艺各一份热度榜，按豆瓣热门和各线路热度排序，每 4 小时更新。</p>
      </header>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {kinds.map((k, i) => (
          <section key={k} aria-labelledby={`chart-${k}`} className="rounded-xl bg-surface p-3 ring-1 ring-line">
            <div className="mb-2 flex items-baseline justify-between px-2">
              <h2 id={`chart-${k}`} className="font-semibold">
                {KIND_LABEL[k]}排行榜
              </h2>
              <Link href={`/rank/${k}`} className="text-xs text-muted hover:text-accent">
                前50名 ›
              </Link>
            </div>
            <RankList titles={charts[i]} />
          </section>
        ))}
      </div>
    </div>
  );
}
