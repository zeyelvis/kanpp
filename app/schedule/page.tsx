import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/config/site";
import { upcomingEpisodes, type UpcomingCard } from "@/lib/data/titles";
import { KIND_LABEL } from "@/lib/domain/kinds";
import { titlePath } from "@/lib/domain/slug";
import { tmdbImage } from "@/lib/images";

export const dynamic = "force-dynamic";

const DAYS = 14;
const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export const metadata: Metadata = {
  title: "追剧日历 - 未来两周剧集更新时间表",
  description: `${site.name}追剧日历：按日期列出未来两周将要播出新一集的电视剧、动漫和综艺，标明季数和集数，方便提前安排追剧。`,
  alternates: { canonical: "/schedule" },
  openGraph: { url: "/schedule" },
};

function dayLabel(date: string, today: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const md = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  const diff = Math.round((d.getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);
  const rel = diff === 0 ? "今天" : diff === 1 ? "明天" : WEEKDAY[d.getUTCDay()];
  return `${md} · ${rel}`;
}

export default async function SchedulePage() {
  const items = await upcomingEpisodes(DAYS, 300);
  const today = new Date().toISOString().slice(0, 10);
  const byDate = new Map<string, UpcomingCard[]>();
  for (const it of items) byDate.set(it.next_episode_date, [...(byDate.get(it.next_episode_date) ?? []), it]);

  return (
    <div className="mx-auto max-w-5xl px-4 pt-8">
      <h1 className="text-2xl font-bold">追剧日历</h1>
      <p className="mt-2 text-sm text-muted">未来 {DAYS} 天将要更新的剧集，播出时间来自 TMDB，以各平台实际上线为准。</p>

      {byDate.size === 0 ? <p className="mt-10 text-muted">最近没有收录到即将播出的剧集。</p> : null}

      <div className="mt-8 space-y-10">
        {[...byDate.entries()].map(([date, list]) => (
          <section key={date} aria-labelledby={`d-${date}`}>
            <h2 id={`d-${date}`} className="mb-3 border-l-4 border-accent pl-3 text-lg font-semibold">
              {dayLabel(date, today)}
              <span className="ml-2 text-sm font-normal text-muted">{list.length} 部</span>
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {list.map((t) => (
                <li key={t.id}>
                  <Link href={titlePath(t.kind, t.slug)} className="flex gap-3 rounded-xl bg-surface p-2 ring-1 ring-line hover:ring-accent/60">
                    {t.poster_path ? (
                      <img src={tmdbImage(t.poster_path, "w185")!} alt={`${t.name}海报`} width={56} height={84} loading="lazy" className="h-[84px] w-14 shrink-0 rounded-md object-cover" />
                    ) : null}
                    <div className="min-w-0 py-1">
                      <p className="truncate font-medium">{t.name}</p>
                      <p className="mt-1 text-sm text-accent">
                        {t.next_episode_season && t.next_episode_season > 1 ? `第${t.next_episode_season}季 ` : ""}
                        {t.next_episode_number ? `第${t.next_episode_number}集` : "新一集"}
                      </p>
                      <p className="text-xs text-faint">
                        {KIND_LABEL[t.kind]}
                        {t.latest_label ? ` · 已有：${t.latest_label}` : ""}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
