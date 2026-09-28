"use client";

import "./player.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Events, type SimplePlayer } from "xgplayer";
import { FollowButton } from "@/components/library/FollowButton";
import { formatClock, lastWatched, recordHistory, useHistory, type TitleRef } from "@/lib/client/library";
import { loadRate, loadSkip, saveRate, saveSkip } from "@/lib/client/player-prefs";
import { inOutro, introMark, NO_MARKS, outroMark, RATES, startPosition, stepRate, type SkipMarks } from "@/lib/domain/skip";
import { parseWatchState, type WatchState } from "@/lib/domain/slug";
import { useHash, writeHash } from "./hash";
import { isMobileClient } from "./hls-config";
import { createPlayer, type HlsSource } from "./xg";

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

const RANGE = 50;
const AD_INTRO_SECONDS = 18;
const AUTONEXT_SECONDS = 5;
/** Holding → longer than this plays at HOLD_RATE (a shorter press skips 10 s). */
const HOLD_MS = 300;
const HOLD_RATE = 5;

function EpisodeGrid({ episodes, current, onPick, dense = false }: { episodes: { name: string }[]; current: number; onPick: (i: number) => void; dense?: boolean }) {
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
      <ol className={`grid gap-2 ${dense ? "grid-cols-4" : "grid-cols-4 sm:grid-cols-6 lg:grid-cols-4"}`}>
        {shown.map((e, k) => {
          const i = start + k;
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onPick(i)}
                aria-current={i === current ? "true" : undefined}
                className={`w-full truncate rounded-md px-2 py-2 text-sm transition ${i === current ? "bg-accent-fill font-medium text-white" : "bg-surface-2 hover:bg-line"}`}
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
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<SimplePlayer | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reportRef = useRef<((ok: boolean) => void) | null>(null);
  const resumeAt = useRef<number | null>(null);
  // Overlays render into this element inside the player, so they also show in fullscreen.
  const [layer, setLayer] = useState<HTMLElement | null>(null);

  // Server render has no fragment: it shows the default season, episode 1, first line.
  const hash = useHash();
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
  const [inAdIntro, setInAdIntro] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [holding, setHolding] = useState(false);
  const [full, setFull] = useState(false);
  // Client-only component (rendered after the lines load), so storage can be read directly.
  const [rate, setRate] = useState(loadRate);
  const [marks, setMarks] = useState<SkipMarks>(() => loadSkip(title.id));
  const [notice, setNotice] = useState<string | null>(null);
  const marksRef = useRef(marks);
  const outroFired = useRef(false);
  useEffect(() => {
    marksRef.current = marks;
  }, [marks]);

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

  // The player's control-bar buttons call the latest handlers.
  const actions = useRef({ fatal: (_: string) => {}, prev: () => {}, next: () => {}, episodes: () => {} });
  useEffect(() => {
    actions.current = {
      fatal: (details) => {
        reportRef.current?.(false);
        failover(details);
      },
      prev: () => {
        if (hasPrev) goEpisode(epIndex - 1);
      },
      next: () => {
        if (hasNext) goEpisode(epIndex + 1);
      },
      episodes: () => setDrawer((open) => !open),
    };
  }, [failover, goEpisode, hasPrev, hasNext, epIndex]);

  // One player for the page: episodes and lines load into it (loadEpisode below).
  useEffect(() => {
    const el = hostRef.current;
    if (!el || !episode) return;
    const player = createPlayer({
      el,
      url: episode.url,
      poster: backdrop,
      rate,
      rates: RATES,
      mobileBuffer: isMobileClient(),
      onFatal: (details) => actions.current.fatal(details),
      onPrev: () => actions.current.prev(),
      onNext: () => actions.current.next(),
      onEpisodes: () => actions.current.episodes(),
    });
    playerRef.current = player;
    videoRef.current = player.media as HTMLVideoElement;
    const overlay = document.createElement("div");
    overlay.className = "kp-layer";
    player.root?.appendChild(overlay);
    setLayer(overlay);
    const onFullscreen = (isFull: boolean) => {
      setFull(isFull);
      if (!isFull) setDrawer(false);
    };
    player.on(Events.FULLSCREEN_CHANGE, onFullscreen);
    player.on(Events.CSS_FULLSCREEN_CHANGE, onFullscreen);
    return () => {
      setLayer(null);
      setFull(false);
      overlay.remove();
      playerRef.current = null;
      videoRef.current = null;
      player.destroy();
    };
    // Created once; its first source, poster and speed are read at creation only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the current episode of the current line.
  useEffect(() => {
    const player = playerRef.current;
    const video = videoRef.current;
    if (!player || !video || !episode) return;
    setLoading(true);
    setError(null);
    setDrawer(false);
    outroFired.current = false;

    const onReady = () => {
      let resume = resumeAt.current;
      if (resume == null && !resumeDismissed) {
        const h = lastWatched(title.id);
        if (h && (h.season ?? null) === (season ?? null) && h.ep === epIndex) resume = h.t;
      }
      // Resume position, else past the viewer's intro mark: applied once at load (not stall recovery).
      const target = startPosition(marksRef.current, resume, video.duration);
      if (target != null) video.currentTime = target;
      resumeAt.current = null;
      void Promise.resolve(player.play()).catch(() => undefined); // autoplay may be blocked; the start button remains
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
    video.setAttribute("aria-label", `${title.name} ${episode.name}`);

    const source = player.getPlugin("kpSource") as HlsSource | null;
    void source?.load(episode.url).then((mode) => {
      if (mode === "unsupported") setError("当前浏览器不支持 HLS 播放，请换用 Chrome、Edge 或 Safari。");
    });

    return () => {
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("loadeddata", onFirstFrame);
      reportRef.current = null;
    };
    // failover/season/epIndex/line are read at load time only; the player reloads per URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode?.url]);

  // Native-HLS errors (Safari) surface on the element instead of hls.js.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onError = () => {
      const source = playerRef.current?.getPlugin("kpSource") as HlsSource | null;
      if (source?.usingHls) return;
      reportRef.current?.(false);
      failover("media-error");
    };
    video.addEventListener("error", onError);
    return () => video.removeEventListener("error", onError);
  }, [failover]);

  // Playback speed: kept across episodes (defaultPlaybackRate survives a new source).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.defaultPlaybackRate = rate;
    video.playbackRate = rate;
  }, [rate, episode?.url]);

  // Speed picked in the player's menu (or held by a long press): remembered for next time.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onRate = () => {
      const next = video.playbackRate;
      if ((RATES as readonly number[]).includes(next)) {
        setRate(next);
        saveRate(next);
      }
    };
    video.addEventListener("ratechange", onRate);
    return () => video.removeEventListener("ratechange", onRate);
  }, []);

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

  /*
   * Picture frozen while the sound plays on. Chrome stops decoding the video of a hidden page to
   * save power and does not always restart it when the page is shown again (reproduced: back in
   * front, the clock ran on, not one new frame). A seek to the current position restarts the
   * decoder from the buffer, without moving playback. Not stall recovery: it runs only while the
   * clock advances, so a slow line (clock stopped, buffering) never triggers it.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof video.getVideoPlaybackQuality !== "function") return;
    let frames = video.getVideoPlaybackQuality().totalVideoFrames;
    let clock = video.currentTime;
    let frozenFor = 0;
    let fixes = 0;
    let lastFix = 0;
    const timer = window.setInterval(() => {
      const nowFrames = video.getVideoPlaybackQuality().totalVideoFrames;
      const advanced = video.currentTime - clock;
      const decoding = nowFrames !== frames;
      frames = nowFrames;
      clock = video.currentTime;
      const watching =
        document.visibilityState === "visible" && !video.paused && !video.seeking && video.readyState >= 3 && video.videoWidth > 0 && document.pictureInPictureElement !== video;
      frozenFor = watching && !decoding && advanced > 0.3 ? frozenFor + 1 : 0;
      if (frozenFor >= 2 && fixes < 3 && Date.now() - lastFix > 10_000) {
        fixes++;
        lastFix = Date.now();
        frozenFor = 0;
        video.currentTime = video.currentTime;
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [episode?.url]);

  // Buffering state, the ad-intro window, the outro mark and the end of an episode.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onWaiting = () => setLoading(true);
    const onPlaying = () => setLoading(false);
    const onTime = () => {
      setInAdIntro(video.currentTime > 0.5 && video.currentTime < AD_INTRO_SECONDS);
      // Reached the viewer's outro mark: offer the next episode (once per episode).
      if (!outroFired.current && hasNext && countdown == null && inOutro(marks, video.currentTime, video.duration)) {
        outroFired.current = true;
        saveProgress();
        setCountdown(AUTONEXT_SECONDS);
      }
    };
    const onEnded = () => {
      saveProgress();
      if (hasNext) setCountdown(AUTONEXT_SECONDS);
    };
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onPlaying);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onPlaying);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("ended", onEnded);
    };
  }, [hasNext, countdown, marks, saveProgress]);

  // The player's own buttons: next episode only when there is one; episodes when there is a choice.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const prev = player.getPlugin("kpPrev");
    const next = player.getPlugin("kpNext");
    const list = player.getPlugin("kpEpisodes");
    if (hasPrev) prev?.show();
    else prev?.hide();
    if (hasNext) next?.show();
    else next?.hide();
    if (epCount > 1 || seasonLines.length > 1) list?.show();
    else list?.hide();
  }, [hasPrev, hasNext, epCount, seasonLines.length, layer]);

  // The fullscreen title bar names what is playing.
  const seasonName = season && seasons.length > 1 ? (seasons.find((s) => s.number === season)?.name ?? `第${season}季`) : "";
  const playingName = [title.name, seasonName, epCount > 1 ? episode?.name : ""].filter(Boolean).join(" ");
  useEffect(() => {
    (playerRef.current?.getPlugin("kpTitle") as { setTitle(text: string): void } | null)?.setTitle(playingName);
  }, [playingName, layer]);

  // While the player covers the page (phones, web fullscreen) the page under it must not scroll.
  useEffect(() => {
    document.documentElement.classList.toggle("kp-player-full", full);
    return () => document.documentElement.classList.remove("kp-player-full");
  }, [full]);

  // Auto-play the next episode after a short, cancellable countdown.
  useEffect(() => {
    if (countdown == null) return;
    const t = window.setTimeout(() => {
      if (countdown <= 1) goEpisode(epIndex + 1);
      else setCountdown(countdown - 1);
    }, 1000);
    return () => window.clearTimeout(t);
  }, [countdown, goEpisode, epIndex]);

  // Shortcuts the player does not have (it handles space, arrows and volume). Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const player = playerRef.current;
      const video = videoRef.current;
      if (!player || !video || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "k") {
        if (video.paused) void Promise.resolve(player.play()).catch(() => undefined);
        else player.pause();
      } else if (e.key === "f") {
        if (player.fullscreen) void player.exitFullscreen();
        else void player.getFullscreen();
      } else if (e.key === "n" && hasNext) {
        goEpisode(epIndex + 1);
      } else if (e.key === ">" || e.key === "<") {
        e.preventDefault();
        const next = stepRate(video.playbackRate, e.key === ">" ? 1 : -1);
        setRate(next);
        saveRate(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goEpisode, epIndex, hasNext]);

  // →: a tap skips 10 s; held down it plays at 5x until released (the speed is not remembered).
  useEffect(() => {
    let timer: number | null = null;
    let heldFrom: number | null = null; // the speed before the hold
    const typing = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      return Boolean(target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)));
    };
    const release = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = null;
      const video = videoRef.current;
      if (heldFrom != null && video) video.playbackRate = heldFrom;
      heldFrom = null;
      setHolding(false);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" || typing(e) || e.metaKey || e.ctrlKey || e.altKey || !videoRef.current) return;
      e.preventDefault();
      if (e.repeat || timer != null || heldFrom != null) return;
      timer = window.setTimeout(() => {
        timer = null;
        const video = videoRef.current;
        if (!video) return;
        heldFrom = video.playbackRate;
        video.playbackRate = HOLD_RATE;
        setHolding(true);
      }, HOLD_MS);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight") return;
      const video = videoRef.current;
      if (timer != null && video) {
        // A tap: skip ahead.
        video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
      }
      release();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", release);
    return () => {
      release();
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", release);
    };
  }, []);

  const updateMarks = (next: SkipMarks, message: string) => {
    setMarks(next);
    saveSkip(title.id, next);
    setNotice(message);
  };

  const markIntro = () => {
    const video = videoRef.current;
    const at = video ? introMark(video.currentTime, video.duration) : null;
    if (at == null) return setNotice("片头要在开头 10 分钟以内：播到正片开始的地方再点");
    updateMarks({ ...marks, intro: at }, `已记住：以后每集从 ${formatClock(at)} 开始播放`);
  };

  const markOutro = () => {
    const video = videoRef.current;
    const before = video ? outroMark(video.currentTime, video.duration) : null;
    if (before == null) return setNotice("片尾要在后半段、结束前 15 分钟以内：播到片尾开始的地方再点");
    updateMarks({ ...marks, outro: before }, `已记住：以后每集结束前 ${formatClock(before)} 自动准备下一集`);
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

  const pickLine = (id: string) => {
    resumeAt.current = videoRef.current?.currentTime ?? null;
    setFailed(new Set());
    setLineId(id);
  };

  if (!line || !episode) {
    return <p className="rounded-xl bg-surface p-6 text-muted">这部作品暂时没有可播放的线路。</p>;
  }

  const btn = "inline-flex h-9 items-center gap-1 rounded-lg px-3 text-sm ring-1 ring-line transition";

  const lineButtons = (
    <div className="flex flex-wrap gap-2">
      {seasonLines.map((l) => (
        <button
          key={l.sourceId}
          type="button"
          onClick={() => pickLine(l.sourceId)}
          className={`rounded-lg px-3 py-1.5 text-sm ring-1 ${
            l.sourceId === line.sourceId
              ? "bg-accent-fill text-white ring-accent"
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
  );

  const overlays = (
    <>
      {line.adIntro && inAdIntro && !loading ? (
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
              <button type="button" onClick={() => goEpisode(epIndex + 1)} className="rounded-full bg-accent-fill px-5 py-2 text-sm font-medium text-white">
                立即播放
              </button>
              <button type="button" onClick={() => setCountdown(null)} className="rounded-full bg-white/10 px-5 py-2 text-sm">
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {holding ? (
        <div className="absolute inset-x-0 top-4 flex justify-center" style={{ pointerEvents: "none" }}>
          <span className="rounded-full bg-black/75 px-3 py-1 text-sm text-white">▶▶ {HOLD_RATE} 倍速快进中</span>
        </div>
      ) : null}
      {error ? <div className="absolute inset-0 grid place-items-center bg-black/85 p-6 text-center text-sm text-ink">{error}</div> : null}
      {drawer ? (
        // Solid panel (no backdrop blur) over the video: fullscreen video stays on its overlay plane.
        <aside className="kp-drawer absolute inset-y-0 right-0 flex w-[min(360px,85%)] flex-col bg-[#141416] text-ink">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="font-semibold">
              {season && seasons.length > 1 ? `${seasons.find((s) => s.number === season)?.name ?? `第${season}季`} · ` : ""}
              {episode.name}
            </p>
            <button type="button" onClick={() => setDrawer(false)} aria-label="关闭" className="px-2 text-xl text-muted hover:text-ink">
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
            {seasonLines.length > 1 ? (
              <div>
                <p className="mb-2 text-sm text-muted">线路</p>
                {lineButtons}
              </div>
            ) : null}
            {epCount > 1 ? (
              <div>
                <p className="mb-2 text-sm text-muted">选集 · 共{epCount}集</p>
                <EpisodeGrid key={`drawer-${season}-${line.sourceId}`} episodes={line.episodes} current={epIndex} onPick={goEpisode} dense />
              </div>
            ) : null}
          </div>
        </aside>
      ) : null}
    </>
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
      {/* Video stays pinned under the header on phones while the episode list scrolls. */}
      {/* In fullscreen above the site header and tab bar (z-40), which it covers on phones. */}
      <div className={`sticky top-14 -mx-4 bg-bg sm:mx-0 lg:static lg:z-auto ${full ? "z-[70]" : "z-30"}`}>
        <div className="relative aspect-video overflow-hidden bg-black sm:rounded-xl sm:ring-1 sm:ring-line">
          <div ref={hostRef} />
        </div>
      </div>
      {layer ? createPortal(overlays, layer) : null}

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

        {epCount > 1 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              onClick={markIntro}
              title="播到正片开始的地方点一下，以后每集自动从这里播放"
              className="h-8 rounded-md px-3 ring-1 ring-line hover:ring-accent/60"
            >
              片头到这{marks.intro != null ? ` · ${formatClock(marks.intro)}` : ""}
            </button>
            <button
              type="button"
              onClick={markOutro}
              title="播到片尾开始的地方点一下，以后每集到这里就准备播放下一集"
              className="h-8 rounded-md px-3 ring-1 ring-line hover:ring-accent/60"
            >
              片尾从这{marks.outro != null ? ` · 前${formatClock(marks.outro)}` : ""}
            </button>
            {marks.intro != null || marks.outro != null ? (
              <button type="button" onClick={() => updateMarks(NO_MARKS, "已清除这部剧的片头片尾设置")} className="h-8 px-1 text-muted hover:text-ink">
                清除
              </button>
            ) : null}
          </div>
        ) : null}
        {notice ? (
          <p role="status" className="text-xs text-muted">
            {notice}
          </p>
        ) : null}

        {offerResume && saved ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-accent-soft px-4 py-2.5 text-sm">
            <span>
              上次看到{saved.season && seasons.length > 1 ? `第${saved.season}季 ` : ""}
              {saved.epName} {formatClock(saved.t)}
            </span>
            <button type="button" onClick={resume} className="rounded-md bg-accent-fill px-3 py-1 font-medium text-white">
              继续播放
            </button>
            <button type="button" onClick={() => setResumeDismissed(true)} className="text-muted hover:text-ink">
              不用了
            </button>
          </div>
        ) : null}

        <div>
          <p className="mb-2 text-sm text-muted">线路</p>
          {lineButtons}
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
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${s.number === season ? "bg-accent-fill text-white" : "bg-surface hover:bg-surface-2"}`}
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
        <p className="hidden text-xs text-faint lg:block">快捷键：空格 暂停 · ← → 快退快进 10 秒（按住 → {HOLD_RATE} 倍速） · ↑ ↓ 音量 · &lt; &gt; 调倍速 · F 全屏 · N 下一集</p>
      </div>
    </div>
  );
}
