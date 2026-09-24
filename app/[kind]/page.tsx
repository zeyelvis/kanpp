import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Pagination, pageHref } from "@/components/Pagination";
import { PosterGrid } from "@/components/PosterCard";
import { site } from "@/lib/config/site";
import { countByKind, latestByKind, PAGE_SIZE } from "@/lib/data/titles";
import { KIND_LABEL, KIND_SEGMENT, kindFromSegment } from "@/lib/domain/kinds";

export const dynamic = "force-dynamic";

function parsePage(raw: string | string[] | undefined): number | null {
  if (raw === undefined) return 1;
  const s = Array.isArray(raw) ? raw[0] : raw;
  return /^[1-9]\d{0,4}$/.test(s) ? Number(s) : null;
}

export async function generateMetadata({ params, searchParams }: PageProps<"/[kind]">): Promise<Metadata> {
  const kind = kindFromSegment((await params).kind);
  if (!kind) return {};
  const page = parsePage((await searchParams).page) ?? 1;
  const label = KIND_LABEL[kind];
  const total = await countByKind(kind);
  const path = pageHref(`/${KIND_SEGMENT[kind]}`, page);
  return {
    title: page > 1 ? `${label}在线观看 - 第${page}页` : `${label}在线观看 - 最近更新`,
    description: `${site.name}${label}频道，共收录${total}部${label}，按更新时间排列，每部都有简介、演职员和可播放线路。`,
    alternates: { canonical: path },
    openGraph: { url: path },
  };
}

export default async function ChannelPage({ params, searchParams }: PageProps<"/[kind]">) {
  const kind = kindFromSegment((await params).kind);
  if (!kind) notFound();
  const page = parsePage((await searchParams).page);
  const basePath = `/${KIND_SEGMENT[kind]}`;
  if (page === null) permanentRedirect(basePath);

  const total = await countByKind(kind);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > totalPages) notFound();
  const titles = await latestByKind(kind, PAGE_SIZE, (page - 1) * PAGE_SIZE);

  return (
    <div className="mx-auto max-w-7xl px-4 pt-8">
      <h1 className="text-2xl font-bold">
        {KIND_LABEL[kind]}
        <span className="ml-3 text-sm font-normal text-muted">共 {total} 部 · 按更新时间</span>
      </h1>
      <div className="mt-6">
        <PosterGrid titles={titles} eagerCount={12} />
      </div>
      <Pagination basePath={basePath} page={page} totalPages={totalPages} />
    </div>
  );
}
