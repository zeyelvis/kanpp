import Link from "next/link";
import { site } from "@/lib/config/site";
import { KIND_LABEL, KIND_SEGMENT, KINDS } from "@/lib/domain/kinds";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur supports-[backdrop-filter]:bg-bg/75">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label={`${site.name}首页`}>
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-base font-bold text-white">看</span>
          <span className="text-lg font-semibold tracking-wide">{site.name}</span>
        </Link>
        <nav aria-label="频道" className="scrollbar-none -mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {KINDS.map((kind) => (
            <Link
              key={kind}
              href={`/${KIND_SEGMENT[kind]}`}
              className="shrink-0 rounded-md px-3 py-1.5 text-sm text-muted transition hover:bg-surface-2 hover:text-ink"
            >
              {KIND_LABEL[kind]}
            </Link>
          ))}
        </nav>
        <form action="/search" method="get" role="search" className="hidden sm:block">
          <input
            name="q"
            type="search"
            placeholder="搜索片名"
            aria-label="搜索片名"
            className="h-9 w-44 rounded-lg border border-line bg-surface px-3 text-sm outline-none placeholder:text-faint focus:border-accent lg:w-60"
          />
        </form>
        <Link href="/search" className="rounded-md px-2 py-1.5 text-sm text-muted sm:hidden" aria-label="搜索">
          搜索
        </Link>
      </div>
    </header>
  );
}
