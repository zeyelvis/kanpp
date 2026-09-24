import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="text-6xl font-bold text-accent">404</p>
      <h1 className="mt-4 text-xl font-semibold">这个页面不存在</h1>
      <p className="mt-2 text-muted">作品可能已下架，或者链接有误。</p>
      <div className="mt-8 flex justify-center gap-3">
        <Link href="/" className="rounded-full bg-accent px-6 py-2.5 font-medium text-white">
          回首页
        </Link>
        <Link href="/search" className="rounded-full bg-surface px-6 py-2.5 ring-1 ring-line">
          搜索片名
        </Link>
      </div>
    </div>
  );
}
