"use client";

import { formatClock, useHistory } from "@/lib/client/library";
import { playFragment } from "@/lib/domain/slug";

/**
 * "立即播放" on the title page; switches to "继续观看 第N集" in the browser when the viewer has
 * history for this title (server snapshot is empty, so hydration always matches). It only sets
 * the fragment: the player at the top of the same page opens and scrolls into view.
 */
export function PlayButton({ id, defaultSeason }: { id: number; defaultSeason: number | null }) {
  const history = useHistory();
  const h = history.find((x) => x.id === id);
  const cls = "inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 font-semibold text-white shadow-lg shadow-accent/20 hover:brightness-110 sm:px-7";
  if (h) {
    return (
      <a href={playFragment({ season: h.season, ep: h.ep + 1 })} className={cls}>
        ▶ 继续观看 <span className="font-normal opacity-90">{h.epName} {formatClock(h.t)}</span>
      </a>
    );
  }
  return (
    <a href={playFragment({ season: defaultSeason })} className={cls}>
      ▶ 立即播放
    </a>
  );
}
