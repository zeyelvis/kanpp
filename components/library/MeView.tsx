"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { clearHistory, formatClock, removeHistory, toggleFollow, useFollows, useHistory } from "@/lib/client/library";
import { isNextEpisodeAhead, shortDate } from "@/lib/domain/labels";
import { titlePath, watchPath } from "@/lib/domain/slug";
import { tmdbImage } from "@/lib/images";

interface Card {
  id: number;
  latest_label: string | null;
  next_episode_date: string | null;
  next_episode_number: number | null;
  next_episode_season: number | null;
}

function FollowsTab() {
  const follows = useFollows();
  const [cards, setCards] = useState<Map<number, Card>>(new Map());
  const ids = follows.map((f) => f.id).join(",");

  useEffect(() => {
    if (!ids) return;
    const ctrl = new AbortController();
    fetch(`/api/cards?ids=${ids}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Card[]>) : []))
      .then((rows) => setCards(new Map(rows.map((c) => [c.id, c]))))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [ids]);

  const rows = useMemo(
    () =>
      follows
        .map((f) => {
          const c = cards.get(f.id);
          const updated = Boolean(c && c.latest_label && c.latest_label !== f.seenLabel);
          return { f, c, updated };
        })
        .sort((a, b) => Number(b.updated) - Number(a.updated) || b.f.at - a.f.at),
    [follows, cards],
  );

  if (follows.length === 0) {
    return (
      <div className="py-16 text-center text-muted">
        <p>还没有追的剧。在任意作品页点「＋ 追剧」，有新集数时这里会提醒你。</p>
        <Link href="/schedule" className="mt-4 inline-block rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-white">
          看看追剧日历
        </Link>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(({ f, c, updated }) => (
        <li key={f.id} className="flex gap-3 rounded-xl bg-surface p-2 ring-1 ring-line">
          <Link href={titlePath(f.kind, f.slug)} className="shrink-0">
            {f.poster ? <img src={tmdbImage(f.poster, "w185")!} alt="" className="h-28 w-[75px] rounded-md object-cover" /> : <span className="block h-28 w-[75px] rounded-md bg-surface-2" />}
          </Link>
          <div className="flex min-w-0 flex-1 flex-col py-1">
            <Link href={titlePath(f.kind, f.slug)} className="flex items-center gap-2">
              <span className="truncate font-medium hover:text-accent">{f.name}</span>
              {updated ? <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">有更新</span> : null}
            </Link>
            <p className="mt-1 truncate text-sm text-ink/80">{c?.latest_label ?? f.seenLabel ?? ""}</p>
            {c && isNextEpisodeAhead(c) ? (
              <p className="text-xs text-muted">
                下集 {shortDate(c.next_episode_date)}
                {c.next_episode_number ? ` · 第${c.next_episode_number}集` : ""}
              </p>
            ) : null}
            <div className="mt-auto flex gap-2 pt-2">
              <Link href={watchPath(f.kind, f.slug)} className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white">
                播放
              </Link>
              <button type="button" onClick={() => toggleFollow({ ...f, latestLabel: f.seenLabel })} className="rounded-md px-3 py-1 text-xs text-muted ring-1 ring-line hover:text-ink">
                取消追剧
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function HistoryTab() {
  const history = useHistory();
  if (history.length === 0) {
    return <p className="py-16 text-center text-muted">还没有观看记录。</p>;
  }
  return (
    <>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => {
            if (window.confirm("清空全部观看记录？")) clearHistory();
          }}
          className="text-sm text-muted hover:text-ink"
        >
          清空记录
        </button>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {history.map((h) => {
          const pct = h.duration ? Math.min(100, Math.round((h.t / h.duration) * 100)) : null;
          return (
            <li key={h.id} className="flex gap-3 rounded-xl bg-surface p-2 ring-1 ring-line">
              <Link href={watchPath(h.kind, h.slug, { season: h.season, ep: h.ep + 1 })} className="relative shrink-0">
                {h.poster ? <img src={tmdbImage(h.poster, "w185")!} alt="" className="h-28 w-[75px] rounded-md object-cover" /> : <span className="block h-28 w-[75px] rounded-md bg-surface-2" />}
                {pct != null ? (
                  <span className="absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-b-md bg-white/20">
                    <span className="block h-full bg-accent" style={{ width: `${pct}%` }} />
                  </span>
                ) : null}
              </Link>
              <div className="flex min-w-0 flex-1 flex-col py-1">
                <Link href={titlePath(h.kind, h.slug)} className="truncate font-medium hover:text-accent">
                  {h.name}
                </Link>
                <p className="mt-1 text-sm text-ink/80">
                  看到 {h.epName} · {formatClock(h.t)}
                </p>
                <p className="text-xs text-faint">{new Date(h.at).toLocaleDateString("zh-CN")}</p>
                <div className="mt-auto flex gap-2 pt-2">
                  <Link href={watchPath(h.kind, h.slug, { season: h.season, ep: h.ep + 1 })} className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white">
                    继续播放
                  </Link>
                  <button type="button" onClick={() => removeHistory(h.id)} className="rounded-md px-3 py-1 text-xs text-muted ring-1 ring-line hover:text-ink">
                    删除
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function MeView({ tab }: { tab: "follows" | "history" }) {
  const follows = useFollows();
  const tabs = [
    { key: "follows", label: `我的追剧${follows.length ? ` ${follows.length}` : ""}`, href: "/me" },
    { key: "history", label: "观看记录", href: "/me?tab=history" },
  ] as const;
  return (
    <div>
      <div className="mb-5 flex gap-2 border-b border-line">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.key ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {tab === "history" ? <HistoryTab /> : <FollowsTab />}
      <p className="mt-10 text-xs text-faint">追剧和观看记录只保存在这台设备的浏览器里，清除浏览器数据后会丢失。</p>
    </div>
  );
}
