import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { site } from "@/lib/config/site";
import { KIND_LABEL, KINDS } from "@/lib/domain/kinds";
import { allTopics, topicPath, type Topic } from "@/lib/domain/topics";

// No database: the list is code; year topics follow the calendar.
export const revalidate = 86400;

export const metadata: Metadata = {
  title: "全部专题 - 按地区、类型、年份找片",
  description: `${site.name}的影视专题：韩剧、美剧、日剧、国产剧，动作、喜剧、科幻电影，${new Date().getFullYear()}年新片新剧，日本动漫、国产动漫与热门综艺，按热度排行并可在线观看。`,
  alternates: { canonical: "/topic" },
};

const GROUP_LABEL: Record<Topic["group"], string> = { region: "按地区", genre: "按类型", year: "按年份" };

export default function TopicIndexPage() {
  const topics = allTopics();
  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 pt-4 sm:pt-6">
      <header className="space-y-3">
        <Breadcrumbs items={[{ name: "首页", href: "/" }, { name: "专题", href: "/topic" }]} />
        <h1 className="text-2xl font-bold sm:text-3xl">全部专题</h1>
        <p className="max-w-3xl text-muted">按地区、类型和年份整理的片单，每个专题按热度排行，也列出近期更新和高分作品。</p>
      </header>
      {KINDS.map((kind) => {
        const mine = topics.filter((t) => t.kind === kind);
        if (mine.length === 0) return null;
        return (
          <section key={kind} aria-labelledby={`k-${kind}`} className="space-y-3">
            <h2 id={`k-${kind}`} className="text-lg font-semibold sm:text-xl">
              {KIND_LABEL[kind]}
            </h2>
            {(["region", "genre", "year"] as const).map((group) => {
              const list = mine.filter((t) => t.group === group);
              if (list.length === 0) return null;
              return (
                <div key={group} className="flex flex-wrap items-center gap-2">
                  <span className="w-14 shrink-0 text-sm text-muted">{GROUP_LABEL[group]}</span>
                  {list.map((t) => (
                    <Link key={t.name} href={topicPath(t)} className="rounded-full bg-surface px-3 py-1 text-sm ring-1 ring-line hover:text-accent hover:ring-accent/60">
                      {t.name}
                    </Link>
                  ))}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
