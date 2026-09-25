"use client";

import { useEffect, useState } from "react";
import { markSeen, toggleFollow, useFollows, type TitleRef } from "@/lib/client/library";
import { PushToggle } from "./PushToggle";

export function FollowButton({ title, compact = false }: { title: TitleRef & { latestLabel: string | null }; compact?: boolean }) {
  const follows = useFollows();
  const following = follows.some((f) => f.id === title.id);
  const [justFollowed, setJustFollowed] = useState(false);

  // Opening a followed title counts as having seen its latest update.
  useEffect(() => {
    if (following) markSeen(title.id, title.latestLabel);
  }, [following, title.id, title.latestLabel]);

  const base = compact
    ? "inline-flex h-9 items-center gap-1 rounded-lg px-3 text-sm ring-1 transition"
    : "inline-flex h-11 items-center gap-2 rounded-full px-6 font-medium ring-1 transition";
  return (
    <>
      <button
        type="button"
        aria-pressed={following}
        onClick={() => setJustFollowed(toggleFollow(title))}
        className={`${base} ${following ? "bg-accent-soft text-accent ring-accent/40" : "bg-surface ring-line hover:ring-accent/60"}`}
      >
        {following ? "✓ 已追剧" : "＋ 追剧"}
      </button>
      {/* Offer reminders right after following, where the reason is obvious. */}
      {justFollowed && following && !compact ? <PushToggle prompt /> : null}
    </>
  );
}
