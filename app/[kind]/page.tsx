import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Pagination } from "@/components/Pagination";
import { TopicChips } from "@/components/TopicChips";
import { topicsForKind } from "@/lib/domain/topics";
import { PosterGrid } from "@/components/PosterCard";
import { site } from "@/lib/config/site";
import { browseTitles, countByKind, PAGE_SIZE } from "@/lib/data/titles";
import { browseHref, GENRES, isDefaultBrowse, parseFilters, REGIONS, SORTS, yearOptions, type BrowseFilters } from "@/lib/domain/filters";
import { KIND_LABEL, KIND_SEGMENT, kindFromSegment, type Kind } from "@/lib/domain/kinds";

export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;

function parsePage(raw: string | string[] | undefined): number | null {
  if (raw === undefined) return 1;
  const s = Array.isArray(raw) ? raw[0] : raw;
  return /^[1-9]\d{0,4}$/.test(s) ? Number(s) : null;
}

function filterSummary(kind: Kind, f: BrowseFilters): string {
  const region = REGIONS.find((r) => r.value === f.region)?.label;
  const year = yearOptions().find((y) => y.value === f.year)?.label;
  return [year, region, f.genre].filter(Boolean).join(" · ") + (isDefaultBrowse(f) ? "" : KIND_LABEL[kind]);
}

export async function generateMetadata({ params, searchParams }: PageProps<"/[kind]">): Promise<Metadata> {
  const kind = kindFromSegment((await params).kind);
  if (!kind) return {};
  const q = await searchParams;
  const f = parseFilters(kind, q);
  const page = parsePage(q.page) ?? 1;
  const label = KIND_LABEL[kind];
  const base = `/${KIND_SEGMENT[kind]}`;
  if (!isDefaultBrowse(f)) {
    // Filter combinations are for people, not for the index: many thin near-duplicates.
    return {
      title: `${filterSummary(kind, f)} - ${SORTS.find((s) => s.value === f.sort)?.label}`,
      robots: { index: false, follow: true },
      alternates: { canonical: browseHref(base, f, page) },
    };
  }
  const total = await countByKind(kind);
  return {
    title: page > 1 ? `${label}在线观看 - 第${page}页` : `${label}在线观看 - 最近更新`,
    description: `${site.name}${label}频道，共收录${total}部${label}，可按类型、地区、年份筛选，每部都有简介、演职员和可播放线路。`,
    alternates: { canonical: browseHref(base, f, page) },
    openGraph: { url: browseHref(base, f, page) },
  };
}

function ChipRow({ label, options, active, hrefFor }: { label: string; options: { value: string | null; label: string }[]; active: string | null; hrefFor: (v: string | null) => string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="shrink-0 pt-1.5 text-xs text-faint">{label}</span>
      <div className="scrollbar-none -mr-4 flex gap-1.5 overflow-x-auto pr-4 sm:flex-wrap sm:overflow-visible">
        {options.map((o) => (
          <Link
            key={o.label}
            href={hrefFor(o.value)}
            rel="nofollow"
            aria-current={o.value === active ? "true" : undefined}
            className={`shrink-0 rounded-full px-3 py-1 text-sm transition ${o.value === active ? "bg-accent text-white" : "text-muted hover:bg-surface-2 hover:text-ink"}`}
          >
            {o.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default async function ChannelPage({ params, searchParams }: PageProps<"/[kind]">) {
  const kind = kindFromSegment((await params).kind);
  if (!kind) notFound();
  const q: Query = await searchParams;
  const f = parseFilters(kind, q);
  const page = parsePage(q.page);
  const basePath = `/${KIND_SEGMENT[kind]}`;
  // Unknown or invalid parameters (and page=1) collapse onto the clean URL with a real 308.
  const canonical = browseHref(basePath, f, page ?? 1);
  const requested = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) for (const x of v === undefined ? [] : Array.isArray(v) ? v : [v]) requested.append(k, x);
  const sorted = (s: URLSearchParams) => (s.sort(), s.toString());
  if (page === null || sorted(requested) !== sorted(new URLSearchParams(canonical.split("?")[1] ?? ""))) {
    permanentRedirect(canonical);
  }

  const { titles, hasMore } = await browseTitles(kind, f, PAGE_SIZE, ((page ?? 1) - 1) * PAGE_SIZE);
  const total = isDefaultBrowse(f) ? await countByKind(kind) : null;
  if (titles.length === 0 && (page ?? 1) > 1) notFound();
  const patch = (p: Partial<BrowseFilters>) => browseHref(basePath, { ...f, ...p });

  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 sm:pt-8">
      <h1 className="text-2xl font-bold">
        {isDefaultBrowse(f) ? KIND_LABEL[kind] : filterSummary(kind, f)}
        {total != null ? <span className="ml-3 text-sm font-normal text-muted">共 {total} 部</span> : null}
      </h1>

      {isDefaultBrowse(f) && (page ?? 1) === 1 ? (
        <div className="mt-4">
          <TopicChips title="热门专题" topics={topicsForKind(kind)} compact />
        </div>
      ) : null}

      <div className="mt-5 space-y-2 rounded-xl bg-surface/60 p-3 ring-1 ring-line sm:p-4">
        <ChipRow label="类型" active={f.genre} options={[{ value: null, label: "全部" }, ...GENRES[kind].map((g) => ({ value: g, label: g }))]} hrefFor={(v) => patch({ genre: v })} />
        <ChipRow label="地区" active={f.region} options={[{ value: null, label: "全部" }, ...REGIONS]} hrefFor={(v) => patch({ region: v })} />
        <ChipRow label="年份" active={f.year} options={[{ value: null, label: "全部" }, ...yearOptions()]} hrefFor={(v) => patch({ year: v })} />
        <ChipRow label="排序" active={f.sort} options={SORTS} hrefFor={(v) => patch({ sort: (v as BrowseFilters["sort"]) ?? "latest" })} />
      </div>

      <div className="mt-6">
        {titles.length ? <PosterGrid titles={titles} eagerCount={12} /> : <p className="py-16 text-center text-muted">没有符合条件的作品，换个条件试试。</p>}
      </div>

      {total != null ? (
        <Pagination basePath={basePath} page={page ?? 1} totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))} />
      ) : (
        <nav aria-label="分页" className="mt-10 flex justify-center gap-3">
          {(page ?? 1) > 1 ? (
            <Link href={browseHref(basePath, f, (page ?? 1) - 1)} rel="prev nofollow" className="rounded-md bg-surface px-4 py-2 text-sm hover:bg-surface-2">
              上一页
            </Link>
          ) : null}
          {hasMore ? (
            <Link href={browseHref(basePath, f, (page ?? 1) + 1)} rel="next nofollow" className="rounded-md bg-surface px-4 py-2 text-sm hover:bg-surface-2">
              下一页
            </Link>
          ) : null}
        </nav>
      )}
    </div>
  );
}
