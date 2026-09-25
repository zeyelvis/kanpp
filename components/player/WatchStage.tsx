"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatClock, useHistory, type TitleRef } from "@/lib/client/library";
import { useHash, writeHash } from "./hash";
import type { PlayerLine } from "./Player";

// The player (and hls.js) is only downloaded once playback starts.
const Player = dynamic(() => import("./Player").then((m) => m.Player), { ssr: false, loading: () => <Spinner /> });

interface LinesPayload {
  lines: PlayerLine[];
  seasons: { number: number; name: string }[];
  defaultSeason: number | null;
}

// At most one request per title per page view, shared by the idle prefetch and playback.
const requests = new Map<number, Promise<LinesPayload>>();
function loadLines(id: number): Promise<LinesPayload> {
  let p = requests.get(id);
  if (!p) {
    p = fetch(`/api/lines/${id}`).then((r) => (r.ok ? (r.json() as Promise<LinesPayload>) : Promise.reject(new Error(`HTTP ${r.status}`))));
    p.catch(() => requests.delete(id));
    requests.set(id, p);
  }
  return p;
}

function Spinner() {
  return (
    <div className="grid aspect-video place-items-center bg-black sm:rounded-xl">
      <span className="size-10 animate-spin rounded-full border-2 border-white/25 border-t-accent" aria-label="加载中" />
    </div>
  );
}

interface Props {
  title: TitleRef & { latestLabel: string | null };
  backdrop: string | null;
  backdropSrcSet?: string;
  /** Shown (letterboxed) when there is no 16:9 backdrop, e.g. titles built from source data. */
  poster?: string | null;
  playable: boolean;
  /** Title, facts and actions: under the video (phones: between video and episodes). */
  header: ReactNode;
  /** Episode list and lines rendered on the server: beside the video until playback starts. */
  panel: ReactNode;
}

/**
 * The top of a title page. Before playback it is a still frame with a play button next to the
 * server-rendered episode list; pressing play, following an episode link (#s=&ep=) or arriving
 * with a fragment (continue-watching links, old /watch/ URLs) mounts the player in place.
 */
export function WatchStage({ title, backdrop, backdropSrcSet, poster = null, playable, header, panel }: Props) {
  const hash = useHash();
  const [clicked, setClicked] = useState(false);
  const [fromHash, setFromHash] = useState(false);
  // Latch: the player may later rewrite the fragment, but once opened it stays open.
  if (hash.length > 1 && !fromHash) setFromHash(true);
  const active = playable && (clicked || fromHash);
  const [data, setData] = useState<LinesPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const saved = useHistory().find((h) => h.id === title.id) ?? null;

  useEffect(() => {
    if (!active || data) return;
    let cancelled = false;
    loadLines(title.id).then(
      (d) => !cancelled && setData(d),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [active, data, title.id]);

  // Warm the lines request once the page is idle, so pressing play starts at once.
  useEffect(() => {
    if (!playable) return;
    const run = () => void loadLines(title.id).catch(() => undefined);
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (idle) idle(run);
    else setTimeout(run, 1500);
  }, [playable, title.id]);

  // Episode links further down the page change the fragment: bring the player into view.
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash.length > 1) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const start = () => {
    // Continue where the viewer left off; the player picks up the time from history.
    if (saved && window.location.hash.length <= 1) writeHash({ season: saved.season, ep: saved.ep + 1 });
    setClicked(true);
  };

  if (active && data) {
    return (
      <div ref={ref} className="scroll-mt-16">
        <Player title={title} backdrop={backdrop ?? poster} lines={data.lines} seasons={data.seasons} defaultSeason={data.defaultSeason} />
        <div className="mt-6">{header}</div>
      </div>
    );
  }

  return (
    <div ref={ref} className="scroll-mt-16 flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-x-6">
      <div className="order-1 -mx-4 sm:mx-0 lg:col-start-1 lg:row-start-1">
        <div className="relative aspect-video overflow-hidden bg-black sm:rounded-xl sm:ring-1 sm:ring-line">
          {backdrop ? (
            <img
              src={backdrop}
              srcSet={backdropSrcSet}
              // Full width below lg; beside the 340px panel inside max-w-7xl from lg up.
              sizes="(min-width: 1280px) 884px, (min-width: 1024px) calc(100vw - 396px), 100vw"
              alt={`${title.name}剧照`}
              fetchPriority="high"
              className="size-full object-cover opacity-80"
            />
          ) : poster ? (
            <>
              <img src={poster} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover opacity-40 blur-2xl" />
              <img src={poster} alt={`${title.name}海报`} fetchPriority="high" className="relative mx-auto h-full object-contain" />
            </>
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-black/25" />
          {playable ? (
            <button type="button" onClick={start} className="group absolute inset-0 flex flex-col items-center justify-center gap-3" aria-label={`播放《${title.name}》`}>
              {active && !failed ? (
                <span className="size-10 animate-spin rounded-full border-2 border-white/25 border-t-accent" aria-label="加载中" />
              ) : (
                <span className="grid size-16 place-items-center rounded-full bg-accent-fill pl-1 text-2xl text-white shadow-xl shadow-black/40 transition group-hover:scale-105 sm:size-20 sm:text-3xl">
                  ▶
                </span>
              )}
              {saved && !active ? (
                <span className="rounded-full bg-black/60 px-3 py-1 text-sm text-white">
                  继续观看 {saved.epName} {formatClock(saved.t)}
                </span>
              ) : null}
            </button>
          ) : (
            <p className="absolute inset-x-0 bottom-4 text-center text-sm text-white/80">暂时没有可播放的线路，我们会持续寻找新线路</p>
          )}
          {failed ? (
            <p className="absolute inset-x-0 bottom-4 text-center text-sm text-white">
              线路加载失败，
              <button type="button" onClick={() => window.location.reload()} className="underline">
                刷新重试
              </button>
            </p>
          ) : null}
        </div>
      </div>
      <div className="order-2 mt-5 lg:col-start-1 lg:row-start-2">{header}</div>
      <div className="order-3 mt-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">{panel}</div>
    </div>
  );
}
