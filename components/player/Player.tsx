"use client";

import type Hls from "hls.js";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  titleId: number;
  titleName: string;
  poster: string | null;
  lines: PlayerLine[];
  seasons: { number: number; name: string }[];
  initial: { season: number | null; ep: number; line: string | null };
}

interface Progress {
  season: number | null;
  ep: number;
  t: number;
}

const progressKey = (titleId: number) => `kanpp:progress:${titleId}`;

function readProgressRaw(titleId: number): string | null {
  try {
    return localStorage.getItem(progressKey(titleId));
  } catch {
    return null;
  }
}

function parseProgress(raw: string | null): Progress | null {
  try {
    return raw ? (JSON.parse(raw) as Progress) : null;
  } catch {
    return null;
  }
}

const noopSubscribe = () => () => {};

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function writeProgress(titleId: number, p: Progress) {
  try {
    localStorage.setItem(progressKey(titleId), JSON.stringify(p));
  } catch {
    // Private mode / storage full: resume is a convenience, not a requirement.
  }
}

export function Player({ titleId, titleName, poster, lines, seasons, initial }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const resumeAt = useRef<number | null>(null);

  const [season, setSeason] = useState<number | null>(initial.season ?? lines[0]?.season ?? null);
  const seasonLines = useMemo(() => lines.filter((l) => l.season === season), [lines, season]);
  const [lineId, setLineId] = useState<string | null>(initial.line);
  const line = seasonLines.find((l) => l.sourceId === lineId) ?? seasonLines[0];
  const [ep, setEp] = useState(Math.max(0, initial.ep - 1));
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const episode = line?.episodes[Math.min(ep, (line?.episodes.length ?? 1) - 1)];

  // Saved progress (client only; null during SSR). Same episode: continue silently from
  // where they stopped. Different episode: offer it instead of jumping without asking.
  const savedRaw = useSyncExternalStore(noopSubscribe, () => readProgressRaw(titleId), () => null);
  const saved = useMemo(() => parseProgress(savedRaw), [savedRaw]);
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const offerResume = Boolean(saved && !resumeDismissed && ((saved.season ?? null) !== (season ?? null) || saved.ep !== ep));

  // Keep the address bar shareable without adding history entries.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (season) q.set("s", String(season));
    else q.delete("s");
    q.set("ep", String(ep + 1));
    if (line) q.set("line", line.sourceId);
    window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
  }, [season, ep, line]);

  /** Move to the next line that has this episode. The only recovery we do: no proxying,
   * no seeking to "unstick" playback. */
  const failover = useCallback(
    (reason: string) => {
      if (!line) return;
      const nextFailed = new Set(failed).add(line.sourceId);
      setFailed(nextFailed);
      const next = seasonLines.find((l) => !nextFailed.has(l.sourceId) && l.episodes.length > ep);
      const t = videoRef.current?.currentTime ?? 0;
      if (next) {
        resumeAt.current = t > 5 ? t : resumeAt.current;
        setLineId(next.sourceId);
        setError(null);
      } else {
        setError(`所有线路都无法播放（${reason}），请稍后再试。`);
        setLoading(false);
      }
    },
    [failed, line, seasonLines, ep],
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
        const p = parseProgress(readProgressRaw(titleId));
        if (p && (p.season ?? null) === (season ?? null) && p.ep === ep) target = p.t;
      }
      if (target && target > 5 && video.duration && target < video.duration - 10) {
        video.currentTime = target; // resume position, applied once at load (not stall recovery)
      }
      resumeAt.current = null;
      void video.play().catch(() => undefined); // autoplay may be blocked; controls remain
    };
    video.addEventListener("loadedmetadata", onReady, { once: true });

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
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
    // failover is intentionally not a dependency: it must not re-create the player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode?.url]);

  // Native-HLS errors (Safari) surface on the element instead of hls.js.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onError = () => {
      if (!hlsRef.current) failover("media-error");
    };
    video.addEventListener("error", onError);
    return () => video.removeEventListener("error", onError);
  }, [failover]);

  // Save progress periodically and when leaving.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const save = () => {
      if (video.currentTime > 5) writeProgress(titleId, { season, ep, t: Math.floor(video.currentTime) });
    };
    const timer = window.setInterval(save, 10_000);
    video.addEventListener("pause", save);
    window.addEventListener("pagehide", save);
    return () => {
      window.clearInterval(timer);
      video.removeEventListener("pause", save);
      window.removeEventListener("pagehide", save);
    };
  }, [titleId, season, ep]);

  const goEpisode = (i: number) => {
    resumeAt.current = null;
    setResumeDismissed(true);
    setEp(i);
  };

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

  const onEnded = () => {
    if (line && ep + 1 < line.episodes.length) goEpisode(ep + 1);
  };

  if (!line) {
    return <p className="rounded-xl bg-surface p-6 text-muted">这部作品暂时没有可播放的线路。</p>;
  }

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-xl bg-black ring-1 ring-line">
        <video
          ref={videoRef}
          className="aspect-video w-full bg-black"
          controls
          playsInline
          preload="auto"
          poster={poster ?? undefined}
          onWaiting={() => setLoading(true)}
          onPlaying={() => setLoading(false)}
          onCanPlay={() => setLoading(false)}
          onEnded={onEnded}
          aria-label={`${titleName} ${episode?.name ?? ""}`}
        />
        {loading && !error ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="size-10 animate-spin rounded-full border-2 border-white/25 border-t-accent" aria-label="加载中" />
          </div>
        ) : null}
        {error ? <div className="absolute inset-0 grid place-items-center bg-black/80 p-6 text-center text-sm text-ink">{error}</div> : null}
      </div>

      {offerResume && saved ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-accent-soft px-4 py-2.5 text-sm">
          <span>
            上次看到{saved.season && seasons.length > 1 ? `第${saved.season}季` : ""}第{saved.ep + 1}集 {formatClock(saved.t)}
          </span>
          <button type="button" onClick={resume} className="rounded-md bg-accent px-3 py-1 font-medium text-white">
            继续播放
          </button>
          <button type="button" onClick={() => setResumeDismissed(true)} className="text-muted hover:text-ink">
            不用了
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">线路</span>
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
              l.sourceId === line.sourceId ? "bg-accent text-white ring-accent" : failed.has(l.sourceId) ? "bg-surface text-faint line-through ring-line" : "bg-surface ring-line hover:ring-accent/60"
            }`}
          >
            {l.sourceName}
            {l.adIntro ? <span className="ml-1 text-xs opacity-70">片头广告</span> : null}
          </button>
        ))}
      </div>

      {seasons.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">选季</span>
          {seasons.map((s) => (
            <button
              key={s.number}
              type="button"
              onClick={() => {
                setSeason(s.number);
                setLineId(null);
                goEpisode(0);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm ${s.number === season ? "bg-accent text-white" : "bg-surface hover:bg-surface-2"}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}

      {line.episodes.length > 1 ? (
        <ol className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
          {line.episodes.map((e, i) => (
            <li key={`${e.url}-${i}`}>
              <button
                type="button"
                onClick={() => goEpisode(i)}
                aria-current={i === ep ? "true" : undefined}
                className={`w-full truncate rounded-md px-2 py-1.5 text-sm ${i === ep ? "bg-accent text-white" : "bg-surface-2 hover:bg-surface"}`}
              >
                {e.name}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
