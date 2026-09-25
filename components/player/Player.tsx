"use client";

import type Hls from "hls.js";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FollowButton } from "@/components/library/FollowButton";
import { formatClock, lastWatched, recordHistory, useHistory, type TitleRef } from "@/lib/client/library";
import { parseWatchState, watchFragment, type WatchState } from "@/lib/domain/slug";
import { hlsConfig, isMobileClient } from "./hls-config";

export interface PlayerLine {
  sourceId: string;
  sourceName: string;
  adIntro: boolean;
  season: number | null;
  remarks: string | null;
  episodes: { name: string; url: string }[];
}

interface Props {
  title: TitleRef & { latestLabel: string | null };
  backdrop: string | null;
  lines: PlayerLine[];
  seasons: { number: number; name: string }[];
  /** Season shown when the URL fragment does not pick one (newest season with lines). */
  defaultSeason: number | null;
}

// The selected season/episode/line live in the URL fragment (one crawlable URL per title).
// replaceState does not fire hashchange, so writes notify subscribers themselves.
const hashListeners = new Set<() => void>();
function subscribeHash(listener: () => void) {
  hashListeners.add(listener);
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    hashListeners.delete(listener);
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
}
function writeHash(state: WatchState) {
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${watchFragment(state)}`);
  hashListeners.forEach((l) => l());
}

const RANGE = 50;
const AD_INTRO_SECONDS = 18;
const AUTONEXT_SECONDS = 5;

function EpisodeGrid({ episodes, current, onPick }: { episodes: { name: string }[]; current: number; onPick: (i: number) => void }) {
  const ranges = episodes.length > 60 ? Math.ceil(episodes.length / RANGE) : 1;
  const [range, setRange] = useState(Math.floor(current / RANGE));
  const activeRange = ranges > 1 ? Math.min(range, ranges - 1) : 0;
  const start = ranges > 1 ? activeRange * RANGE : 0;
  const shown = ranges > 1 ? episodes.slice(start, start + RANGE) : episodes;
  return (
    <div>
      {ranges > 1 ? (
        <div className="scrollbar-none mb-3 flex gap-2 overflow-x-auto">
          {Array.from({ length: ranges }, (_, r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`shrink-0 rounded-md px-3 py-1 text-xs ${r === activeRange ? "bg-ink text-black" : "bg-surface-2 text-muted hover:text-ink"}`}
            >
              {r * RANGE + 1}-{Math.min((r + 1) * RANGE, episodes.length)}
            </button>
          ))}
        </div>
      ) : null}
      <ol className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-4">
        {shown.map((e, k) => {
          const i = start + k;
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onPick(i)}
                aria-current={i === current ? "true" : undefined}
                className={`w-full truncate rounded-md px-2 py-2 text-sm transition ${i === current ? "bg-accent font-medium text-white" : "bg-surface-2 hover:bg-line"}`}
              >
                {e.name}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Tells the site whether a line reached its first frame (ranks lines per country). */
function sendPlaybackBeacon(line: string, ok: boolean, ms: number) {
  try {
    navigator.sendBeacon?.("/api/beacon", JSON.stringify({ line, ok, ms: Math.round(ms) }));
  } catch {
    // Reporting must never affect playback.
  }
}

export function Player({ title, backdrop, lines, seasons, defaultSeason }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const reportRef = useRef<((ok: boolean) => void) | null>(null);
  const resumeAt = useRef<number | null>(null);

  // Server render has no fragment: it shows the default season, episode 1, first line.
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const wanted = parseWatchState(hash);
  const seasonNumbers = new Set(lines.map((l) => l.season));
  const season = wanted.season != null && seasonNumbers.has(wanted.season) ? wanted.season : defaultSeason;
  const seasonLines = useMemo(() => lines.filter((l) => l.season === season), [lines, season]);
  const lineId = wanted.line;
  const line = seasonLines.find((l) => l.sourceId === lineId) ?? seasonLines[0];
  const ep = Math.max(0, (wanted.ep ?? 1) - 1);
  const select = useCallback(
    (patch: WatchState) => {
      const current = parseWatchState(window.location.hash);
      writeHash({ season: current.season ?? season, ep: current.ep, line: current.line, ...patch });
    },
    [season],
  );
  const setSeason = (s: number | null) => select({ season: s, ep: 1, line: null });
  const setLineId = (id: string | null) => select({ line: id });
  const setEp = (i: number) => select({ ep: i + 1 });
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);

  const epCount = line?.episodes.length ?? 0;
  const epIndex = Math.min(ep, Math.max(0, epCount - 1));
  const episode = line?.episodes[epIndex];
  const hasPrev = epIndex > 0;
  const hasNext = epIndex + 1 < epCount;

  // History (client only). Same episode: continue silently. Other episode: offer it.
  const history = useHistory();
  const saved = history.find((h) => h.id === title.id) ?? null;
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const offerResume = Boolean(saved && !resumeDismissed && ((saved.season ?? null) !== (season ?? null) || saved.ep !== epIndex));

  const saveProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video || !episode || video.currentTime < 5) return;
    recordHistory({
      id: title.id,
      kind: title.kind,
      slug: title.slug,
      name: title.name,
      poster: title.poster,
      backdrop: title.backdrop,
      year: title.year,
      season,
      ep: epIndex,
      epName: episode.name,
      t: Math.floor(video.currentTime),
      duration: Number.isFinite(video.duration) ? Math.floor(video.duration) : null,
    });
  }, [title, season, epIndex, episode]);

  /** Move to the next line that has this episode. The only recovery we do: no proxying,
   * no seeking to "unstick" playback. */
  const failover = useCallback(
    (reason: string) => {
      if (!line) return;
      const nextFailed = new Set(failed).add(line.sourceId);
      setFailed(nextFailed);
      const next = seasonLines.find((l) => !nextFailed.has(l.sourceId) && l.episodes.length > epIndex);
      const t = videoRef.current?.currentTime ?? 0;
      if (next) {
        resumeAt.current = t > 5 ? t : resumeAt.current;
        select({ line: next.sourceId });
        setError(null);
      } else {
        setError(`所有线路都无法播放（${reason}），请稍后再试。`);
        setLoading(false);
      }
    },
    [failed, line, seasonLines, epIndex, select],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !episode) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const onReady = () => {
      let target = resumeAt.current;
      if (target == null && !resumeDismissed) {
        const h = lastWatched(title.id);
        if (h && (h.season ?? null) === (season ?? null) && h.ep === epIndex) target = h.t;
      }
      if (target && target > 5 && video.duration && target < video.duration - 10) {
        video.currentTime = target; // resume position, applied once at load (not stall recovery)
      }
      resumeAt.current = null;
      void video.play().catch(() => undefined); // autoplay may be blocked; controls remain
    };
    video.addEventListener("loadedmetadata", onReady, { once: true });

    // One report per load: first frame decoded (independent of autoplay) or a fatal error.
    const sourceId = line?.sourceId;
    const startedAt = performance.now();
    let reported = false;
    const report = (ok: boolean) => {
      if (reported || !sourceId) return;
      reported = true;
      sendPlaybackBeacon(sourceId, ok, ok ? performance.now() - startedAt : 0);
    };
    reportRef.current = report;
    const onFirstFrame = () => report(true);
    video.addEventListener("loadeddata", onFirstFrame, { once: true });

    (async () => {
      const { default: HlsCtor } = await import("hls.js");
      if (cancelled) return;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      if (HlsCtor.isSupported()) {
        const hls = new HlsCtor(hlsConfig(isMobileClient()));
        hlsRef.current = hls;
        let mediaRecoveries = 0;
        hls.on(HlsCtor.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 1) {
            mediaRecoveries++;
            hls.recoverMediaError();
            return;
          }
          report(false);
          failover(data.details);
        });
        hls.loadSource(episode.url);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = episode.url; // Safari / iOS native HLS
      } else {
        setError("当前浏览器不支持 HLS 播放，请换用 Chrome、Edge 或 Safari。");
      }
    })();

    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("loadeddata", onFirstFrame);
      reportRef.current = null;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
    // failover/season/epIndex/line are read at load time only; the player is rebuilt per URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode?.url]);

  // Native-HLS errors (Safari) surface on the element instead of hls.js.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onError = () => {
      if (hlsRef.current) return;
      reportRef.current?.(false);
      failover("media-error");
    };
    video.addEventListener("error", onError);
    return () => video.removeEventListener("error", onError);
  }, [failover]);

  // Save progress periodically and when leaving.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const timer = window.setInterval(saveProgress, 10_000);
    video.addEventListener("pause", saveProgress);
    window.addEventListener("pagehide", saveProgress);
    return () => {
      window.clearInterval(timer);
      video.removeEventListener("pause", saveProgress);
      window.removeEventListener("pagehide", saveProgress);
    };
  }, [saveProgress]);

  const goEpisode = useCallback(
    (i: number) => {
      saveProgress();
      resumeAt.current = null;
      setResumeDismissed(true);
      setCountdown(null);
      select({ ep: i + 1 });
    },
    [saveProgress, select],
  );

  // Auto-play the next episode after a short, cancellable countdown.
  useEffect(() => {
    if (countdown == null) return;
    const t = window.setTimeout(() => {
      if (countdown <= 1) goEpisode(epIndex + 1);
      else setCountdown(countdown - 1);
    }, 1000);
    return () => window.clearTimeout(t);
  }, [countdown, goEpisode, epIndex]);

  // Keyboard shortcuts (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const video = videoRef.current;
      if (!video || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " " || e.key === "k") {
        if (target === video) return; // the native control already handles it
        e.preventDefault();
        if (video.paused) void video.play();
        else video.pause();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - 10);
      } else if (e.key === "f") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void video.requestFullscreen?.();
      } else if (e.key === "n" && hasNext) {
        goEpisode(epIndex + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goEpisode, epIndex, hasNext]);

  const resume = () => {
    if (!saved) return;
    setResumeDismissed(true);
    if ((saved.season ?? null) !== (season ?? null)) {
      setSeason(saved.season);
      setLineId(null);
    }
    resumeAt.current = saved.t;
    setEp(saved.ep);
  };

  if (!line || !episode) {
    return <p className="rounded-xl bg-surface p-6 text-muted">这部作品暂时没有可播放的线路。</p>;
  }

  const btn = "inline-flex h-9 items-center gap-1 rounded-lg px-3 text-sm ring-1 ring-line transition";

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
      {/* Video stays pinned under the header on phones while the episode list scrolls. */}
      <div className="sticky top-14 z-30 -mx-4 bg-bg sm:mx-0 lg:static lg:z-auto">
        <div className="relative overflow-hidden bg-black sm:rounded-xl sm:ring-1 sm:ring-line">
          <video
            ref={videoRef}
            className="aspect-video w-full bg-black"
            controls
            playsInline
            preload="auto"
            poster={backdrop ?? undefined}
            onWaiting={() => setLoading(true)}
            onPlaying={() => setLoading(false)}
            onCanPlay={() => setLoading(false)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onEnded={() => {
              saveProgress();
              if (hasNext) setCountdown(AUTONEXT_SECONDS);
            }}
            aria-label={`${title.name} ${episode.name}`}
          />
          {loading && !error ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="size-10 animate-spin rounded-full border-2 border-white/25 border-t-accent" aria-label="加载中" />
            </div>
          ) : null}
          {line.adIntro && time > 0.5 && time < AD_INTRO_SECONDS && !loading ? (
            <button
              type="button"
              onClick={() => {
                if (videoRef.current) videoRef.current.currentTime = AD_INTRO_SECONDS;
              }}
              className="absolute right-3 top-3 rounded-full bg-black/75 px-3 py-1.5 text-xs text-white ring-1 ring-white/20 hover:bg-black"
            >
              跳过片头广告 ›
            </button>
          ) : null}
          {countdown != null ? (
            <div className="absolute inset-0 grid place-items-center bg-black/75 text-center">
              <div>
                <p className="text-sm text-muted">即将播放</p>
                <p className="mt-1 text-lg font-semibold">{line.episodes[epIndex + 1]?.name}</p>
                <p className="mt-1 text-3xl font-bold text-accent">{countdown}</p>
                <div className="mt-4 flex justify-center gap-3">
                  <button type="button" onClick={() => goEpisode(epIndex + 1)} className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white">
                    立即播放
                  </button>
                  <button type="button" onClick={() => setCountdown(null)} className="rounded-full bg-white/10 px-5 py-2 text-sm">
                    取消
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {error ? <div className="absolute inset-0 grid place-items-center bg-black/85 p-6 text-center text-sm text-ink">{error}</div> : null}
        </div>
      </div>

      <div className="mt-4 space-y-4 lg:mt-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-lg font-semibold">
            {season && seasons.length > 1 ? `${seasons.find((s) => s.number === season)?.name ?? `第${season}季`} · ` : ""}
            {episode.name}
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={!hasPrev} onClick={() => goEpisode(epIndex - 1)} className={`${btn} disabled:opacity-40 enabled:hover:ring-accent/60`}>
              ‹ 上一集
            </button>
            <button type="button" disabled={!hasNext} onClick={() => goEpisode(epIndex + 1)} className={`${btn} disabled:opacity-40 enabled:hover:ring-accent/60`}>
              下一集 ›
            </button>
            <FollowButton title={title} compact />
          </div>
        </div>

        {offerResume && saved ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-accent-soft px-4 py-2.5 text-sm">
            <span>
              上次看到{saved.season && seasons.length > 1 ? `第${saved.season}季 ` : ""}
              {saved.epName} {formatClock(saved.t)}
            </span>
            <button type="button" onClick={resume} className="rounded-md bg-accent px-3 py-1 font-medium text-white">
              继续播放
            </button>
            <button type="button" onClick={() => setResumeDismissed(true)} className="text-muted hover:text-ink">
              不用了
            </button>
          </div>
        ) : null}

        <div>
          <p className="mb-2 text-sm text-muted">线路</p>
          <div className="flex flex-wrap gap-2">
            {seasonLines.map((l) => (
              <button
                key={l.sourceId}
                type="button"
                onClick={() => {
                  resumeAt.current = videoRef.current?.currentTime ?? null;
                  setFailed(new Set());
                  setLineId(l.sourceId);
                }}
                className={`rounded-lg px-3 py-1.5 text-sm ring-1 ${
                  l.sourceId === line.sourceId
                    ? "bg-accent text-white ring-accent"
                    : failed.has(l.sourceId)
                      ? "bg-surface text-faint line-through ring-line"
                      : "bg-surface ring-line hover:ring-accent/60"
                }`}
              >
                {l.sourceName}
                {l.adIntro ? <span className="ml-1 text-xs opacity-70">片头广告</span> : null}
              </button>
            ))}
          </div>
        </div>

        {seasons.length > 1 ? (
          <div>
            <p className="mb-2 text-sm text-muted">选季</p>
            <div className="scrollbar-none flex gap-2 overflow-x-auto">
              {seasons.map((s) => (
                <button
                  key={s.number}
                  type="button"
                  onClick={() => {
                    setSeason(s.number);
                    setLineId(null);
                    goEpisode(0);
                  }}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${s.number === season ? "bg-accent text-white" : "bg-surface hover:bg-surface-2"}`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {epCount > 1 ? (
          <div>
            <p className="mb-2 text-sm text-muted">选集 · 共{epCount}集</p>
            <EpisodeGrid key={`${season}-${line.sourceId}`} episodes={line.episodes} current={epIndex} onPick={goEpisode} />
          </div>
        ) : null}
        <p className="hidden text-xs text-faint lg:block">快捷键：空格 暂停 · ← → 快退快进 10 秒 · F 全屏 · N 下一集</p>
      </div>
    </div>
  );
}
