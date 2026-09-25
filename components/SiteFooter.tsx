import Link from "next/link";
import { site } from "@/lib/config/site";
import { KIND_LABEL, KIND_SEGMENT, KINDS } from "@/lib/domain/kinds";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 text-sm text-muted sm:grid-cols-[2fr_1fr]">
        <div className="space-y-2">
          <p className="text-base font-semibold text-ink">
            {site.name} · {site.tagline}
          </p>
          <p className="max-w-xl leading-relaxed">{site.description}</p>
          <p className="text-xs text-faint">
            影视资料（片名、简介、海报、演职员）来自 TMDB。本站使用 TMDB API，但未获 TMDB 认可或认证。
          </p>
        </div>
        <nav aria-label="频道" className="flex flex-wrap content-start gap-x-4 gap-y-2">
          {KINDS.map((kind) => (
            <Link key={kind} href={`/${KIND_SEGMENT[kind]}`} className="hover:text-ink">
              {KIND_LABEL[kind]}
            </Link>
          ))}
        </nav>
      </div>
      <nav aria-label="站点信息" className="flex flex-wrap justify-center gap-x-4 gap-y-1 pb-8 text-xs text-faint">
        <span>
          © {new Date().getFullYear()} {site.domain}
        </span>
        <Link href="/topic" className="hover:text-ink">
          全部专题
        </Link>
        <Link href="/about" className="hover:text-ink">
          关于我们
        </Link>
        <Link href="/privacy" className="hover:text-ink">
          隐私政策
        </Link>
        <Link href="/terms" className="hover:text-ink">
          使用条款
        </Link>
        <Link href="/dmca" className="hover:text-ink">
          版权投诉 / DMCA
        </Link>
      </nav>
    </footer>
  );
}
