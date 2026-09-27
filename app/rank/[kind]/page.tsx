import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RankTable } from "@/components/home/RankTable";
import { Tabs } from "@/components/home/Tabs";
import { JsonLd } from "@/components/JsonLd";
import { absoluteUrl, DEFAULT_OG_IMAGE, site } from "@/lib/config/site";
import { chartData, hotListsUpdatedAt, SECTIONS, type ChartKind } from "@/lib/data/home";
import { KIND_LABEL, KIND_SEGMENT } from "@/lib/domain/kinds";
import { titlePath } from "@/lib/domain/slug";

// Charts follow the catalog job (every 4 hours): rendered on first request (the build has no
// data), cached briefly, rebuilt in the background.
export const revalidate = 900;
export function generateStaticParams() {
  return [];
}

const HEAT: Record<ChartKind, string> = { tv: "热播", movie: "热门", anime: "热门", variety: "热门" };

function chartKind(raw: string): ChartKind | null {
  return raw in SECTIONS ? (raw as ChartKind) : null;
}

function updatedLine(at: string | null): string | null {
  if (!at) return null;
  const d = new Date(Date.parse(at) + 8 * 3600_000);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}（北京时间）`;
}

export async function generateMetadata({ params }: PageProps<"/rank/[kind]">): Promise<Metadata> {
  const kind = chartKind((await params).kind);
  if (!kind) return {};
  const label = KIND_LABEL[kind];
  const { chart } = await chartData(kind);
  const top = chart.slice(0, 3).map((t) => `《${t.name}》`).join("");
  const title = `${label}排行榜 - ${HEAT[kind]}${label}排行榜前50名`;
  return {
    title,
    description: `${site.name}${label}排行榜：按豆瓣热门和各线路热度排序，每4小时更新${top ? `，目前前三名是${top}` : ""}，每部都能在线观看。`,
    alternates: { canonical: `/rank/${kind}` },
    openGraph: { url: `/rank/${kind}`, title, images: [DEFAULT_OG_IMAGE] },
  };
}

export default async function ChartPage({ params }: PageProps<"/rank/[kind]">) {
  const kind = chartKind((await params).kind);
  if (!kind) notFound();
  const label = KIND_LABEL[kind];
  const [{ chart, tabs }, at] = await Promise.all([chartData(kind), hotListsUpdatedAt()]);
  const updated = updatedLine(at);
  const panels = [{ label: "总榜", titles: chart }, ...tabs.filter((t) => t.titles.length > 0)];
  const path = `/rank/${kind}`;
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 pt-4 sm:pt-6">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `${label}排行榜`,
          url: absoluteUrl(path),
          numberOfItems: chart.length,
          itemListElement: chart.map((t, i) => ({ "@type": "ListItem", position: i + 1, url: absoluteUrl(titlePath(t.kind, t.slug)), name: t.name })),
        }}
      />
      <header className="space-y-3">
        <Breadcrumbs items={[{ name: "首页", href: "/" }, { name: "排行榜", href: "/rank" }, { name: `${label}排行榜`, href: path }]} />
        <h1 className="text-2xl font-bold sm:text-3xl">{label}排行榜</h1>
        <p className="text-muted">
          按豆瓣热门和{site.name}各线路的热度排序（越多线路收录、越近有更新越靠前），每 4 小时更新{updated ? `，本次更新于${updated}` : ""}。
          想按类型或年份找片，可以去
          <Link href={`/${KIND_SEGMENT[kind]}`} className="text-accent hover:underline">
            {label}频道
          </Link>
          。
        </p>
      </header>
      <Tabs id={`chart-${kind}`} labels={panels.map((p) => p.label)}>
        {panels.map((p) => (
          <RankTable key={p.label} titles={p.titles} />
        ))}
      </Tabs>
      <nav aria-label="其他排行榜" className="flex flex-wrap gap-2 pt-2">
        {(Object.keys(SECTIONS) as ChartKind[])
          .filter((k) => k !== kind)
          .map((k) => (
            <Link key={k} href={`/rank/${k}`} className="rounded-full bg-surface px-3 py-1 text-sm ring-1 ring-line hover:text-accent">
              {KIND_LABEL[k]}排行榜
            </Link>
          ))}
      </nav>
    </div>
  );
}
