import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { DesktopNav, MobileChannelBar } from "@/components/nav/NavLinks";
import { SearchBox } from "@/components/nav/SearchBox";
import { site } from "@/lib/config/site";

export function SiteHeader() {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur supports-[backdrop-filter]:bg-bg/75">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2" aria-label={`${site.name}首页`}>
            <BrandMark className="size-8" />
            <span className="text-lg font-semibold tracking-wide">{site.name}</span>
          </Link>
          <DesktopNav />
          <div className="flex-1" />
          <SearchBox className="hidden w-56 sm:block lg:w-72" />
          <Link href="/search" aria-label="搜索" className="grid size-9 place-items-center rounded-lg text-muted hover:text-ink sm:hidden">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm9 16-4-4" />
            </svg>
          </Link>
          <Link href="/me" className="hidden shrink-0 rounded-lg px-3 py-1.5 text-sm text-muted ring-1 ring-line hover:text-ink md:block">
            我的追剧
          </Link>
        </div>
      </header>
      <MobileChannelBar />
    </>
  );
}
