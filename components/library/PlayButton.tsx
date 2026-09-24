"use client";

import Link from "next/link";
import { formatClock, useHistory } from "@/lib/client/library";
import type { Kind } from "@/lib/domain/kinds";
import { watchPath } from "@/lib/domain/slug";

/**
 * "立即播放" on the server; switches to "继续观看 第N集" in the browser when the viewer has
 * history for this title (server snapshot is empty, so hydration always matches).
 */
export function PlayButton({ id, kind, slug, defaultSeason }: { id: number; kind: Kind; slug: string; defaultSeason: number | null }) {
  const history = useHistory();
  const h = history.find((x) => x.id === id);
  const cls = "inline-flex h-11 items-center gap-2 rounded-full bg-accent px-7 font-semibold text-white shadow-lg shadow-accent/20 hover:brightness-110";
  if (h) {
    return (
      <Link href={watchPath(kind, slug, { season: h.season, ep: h.ep + 1 })} className={cls}>
        ▶ 继续观看 <span className="font-normal opacity-90">{h.epName} {formatClock(h.t)}</span>
      </Link>
    );
  }
  return (
    <Link href={watchPath(kind, slug, { season: defaultSeason })} className={cls}>
      ▶ 立即播放
    </Link>
  );
}
