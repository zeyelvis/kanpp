import Link from "next/link";
import { PosterCard } from "@/components/PosterCard";
import type { TitleCard } from "@/lib/data/titles";
import { RankList } from "./RankList";
import { Tabs } from "./Tabs";

/**
 * A home page section the way Chinese streaming sites lay it out: region/genre tabs of posters
 * on the left, the kind's chart on the right (below on phones).
 */
export function HotSection({
  id,
  title,
  href,
  tabs,
  chart,
  eager = false,
}: {
  id: string;
  title: string;
  href: string;
  tabs: { label: string; titles: TitleCard[] }[];
  chart: { title: string; href: string; titles: TitleCard[] };
  eager?: boolean;
}) {
  const shown = tabs.filter((t) => t.titles.length > 0);
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby={id} className="mx-auto max-w-7xl px-4 pt-10">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id={id} className="text-xl font-semibold">
          {title}
        </h2>
        <Link href={href} className="text-sm text-muted hover:text-accent">
          查看全部 ›
        </Link>
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <Tabs id={`${id}-tabs`} labels={shown.map((t) => t.label)}>
          {shown.map((tab, ti) => (
            <ul key={tab.label} className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-6">
              {tab.titles.slice(0, 12).map((t, i) => (
                <li key={t.id}>
                  <PosterCard title={t} eager={eager && ti === 0 && i < 6} />
                </li>
              ))}
            </ul>
          ))}
        </Tabs>
        {chart.titles.length > 0 ? (
          <aside aria-label={chart.title} className="rounded-xl bg-surface p-3 ring-1 ring-line">
            <div className="mb-2 flex items-baseline justify-between px-2">
              <h3 className="font-semibold">{chart.title}</h3>
              <Link href={chart.href} className="text-xs text-muted hover:text-accent">
                完整榜单 ›
              </Link>
            </div>
            <RankList titles={chart.titles.slice(0, 10)} />
          </aside>
        ) : null}
      </div>
    </section>
  );
}
