"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KIND_LABEL, KIND_SEGMENT, KINDS } from "@/lib/domain/kinds";

const LINKS = [...KINDS.map((k) => ({ href: `/${KIND_SEGMENT[k]}`, label: KIND_LABEL[k] })), { href: "/schedule", label: "追剧日历" }];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop channel links in the header. */
export function DesktopNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="频道" className="hidden items-center gap-1 md:flex">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={isActive(pathname, l.href) ? "page" : undefined}
          className={`rounded-md px-3 py-1.5 text-sm transition hover:bg-surface-2 hover:text-ink ${isActive(pathname, l.href) ? "text-ink" : "text-muted"}`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

/** Phone channel chips under the header; scrolls horizontally with a fade hinting at more. */
export function MobileChannelBar() {
  const pathname = usePathname();
  if (pathname.startsWith("/watch/")) return null;
  return (
    <nav aria-label="频道" className="relative border-b border-line md:hidden">
      <div className="scrollbar-none flex gap-1 overflow-x-auto px-3 py-2 [mask-image:linear-gradient(to_right,black_85%,transparent)]">
        <Link href="/" aria-current={pathname === "/" ? "page" : undefined} className={`shrink-0 rounded-full px-3 py-1 text-sm ${pathname === "/" ? "bg-ink font-medium text-black" : "text-muted"}`}>
          推荐
        </Link>
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={isActive(pathname, l.href) ? "page" : undefined}
            className={`shrink-0 rounded-full px-3 py-1 text-sm ${isActive(pathname, l.href) ? "bg-ink font-medium text-black" : "text-muted"}`}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

const TABS = [
  { href: "/", label: "首页", icon: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { href: "/schedule", label: "日历", icon: "M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" },
  { href: "/search", label: "搜索", icon: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm9 16-4-4" },
  { href: "/me", label: "我的", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0" },
];

/** Phone bottom tab bar. */
export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav aria-label="主导航" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="grid grid-cols-4">
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : isActive(pathname, t.href);
          return (
            <li key={t.href}>
              <Link href={t.href} aria-current={active ? "page" : undefined} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${active ? "text-accent" : "text-muted"}`}>
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={t.icon} />
                </svg>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
