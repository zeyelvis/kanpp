import type Hls from "hls.js";
import { BasePlugin, langZhCn, Plugin, SimplePlayer, Sniffer, type IBasePluginOptions } from "xgplayer";
import CssFullScreen from "xgplayer/es/plugins/cssFullScreen";
import Enter from "xgplayer/es/plugins/enter";
import Fullscreen from "xgplayer/es/plugins/fullscreen";
import Keyboard from "xgplayer/es/plugins/keyboard";
import Loading from "xgplayer/es/plugins/loading";
import MobilePlugin from "xgplayer/es/plugins/mobile";
import PCPlugin from "xgplayer/es/plugins/pc";
import PIP from "xgplayer/es/plugins/pip";
import PlayIcon from "xgplayer/es/plugins/play";
import PlaybackRate from "xgplayer/es/plugins/playbackRate";
import Poster from "xgplayer/es/plugins/poster";
import Progress from "xgplayer/es/plugins/progress";
import MiniProgress from "xgplayer/es/plugins/progress/miniProgress";
import Start from "xgplayer/es/plugins/start";
import Time from "xgplayer/es/plugins/time";
import Volume from "xgplayer/es/plugins/volume";
import { hlsConfig } from "./hls-config";

/*
 * xgplayer (ByteDance's web player) supplies the controls, gestures and fullscreen; we keep
 * loading and recovery. Its plugins are picked one by one rather than taken from its preset,
 * which also brings plugins that break our playback rules:
 * - gapJump / waitingTimeoutJump seek forward on stalls (the "nudge" that turns a slow line
 *   into a rebuffer loop; recovery here is only a line switch),
 * - dynamicBg paints frames to a canvas, rotate fullscreen transforms the player,
 * - its hls.js plugin retries a dead line forever instead of failing over.
 */

export type LoadMode = "hls" | "native" | "unsupported";

/**
 * Loads each episode into the player's one <video>, so switching episode or line keeps the
 * player (and fullscreen). Fatal errors, after hls.js's own retries and one media recovery,
 * go to `onFatal`, which reports the line and fails over.
 */
export class HlsSource extends BasePlugin {
  static get pluginName() {
    return "kpSource";
  }

  static get defaultConfig() {
    return { mobile: false, onFatal: null as ((details: string) => void) | null };
  }

  private hls: Hls | null = null;
  private generation = 0;

  constructor(args: IBasePluginOptions) {
    super(args);
    // Sources are ours: xgplayer never sets the element's src.
    this.player.handleSource = false;
  }

  get usingHls(): boolean {
    return this.hls != null;
  }

  async load(url: string): Promise<LoadMode | null> {
    const generation = ++this.generation;
    this.hls?.destroy();
    this.hls = null;
    const media = this.player.media as HTMLVideoElement;
    const { default: HlsCtor } = await import("hls.js");
    if (generation !== this.generation) return null; // a newer load or destroy came first
    if (HlsCtor.isSupported()) {
      const hls = new HlsCtor(hlsConfig(this.config.mobile));
      this.hls = hls;
      let mediaRecoveries = 0;
      hls.on(HlsCtor.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 1) {
          mediaRecoveries++;
          hls.recoverMediaError();
          return;
        }
        this.config.onFatal?.(data.details);
      });
      hls.loadSource(url);
      hls.attachMedia(media);
      return "hls";
    }
    if (media.canPlayType("application/vnd.apple.mpegurl")) {
      media.src = url; // Safari / iOS native HLS: errors surface on the element
      return "native";
    }
    return "unsupported";
  }

  destroy() {
    this.generation++;
    this.hls?.destroy();
    this.hls = null;
  }
}

const tap = () => (Sniffer.device === "mobile" ? "touchend" : "click");

/** A control-bar button that calls `onClick` from its config. */
abstract class ActionButton extends Plugin {
  afterCreate() {
    this.bind(tap(), (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.config.onClick?.();
    });
  }
}

/*
 * Left of the control bar: 上一集, -10 s, play, +10 s, 下一集. The previous-episode and seek
 * buttons, the episode panel button and the title bar show in fullscreen only (player.css).
 */

export class PrevButton extends ActionButton {
  static get pluginName() {
    return "kpPrev";
  }

  static get defaultConfig() {
    return { position: Plugin.POSITIONS.CONTROLS_LEFT, index: 0, onClick: null as (() => void) | null };
  }

  render() {
    return `<xg-icon class="kp-prev" aria-label="上一集">
      <div class="xgplayer-icon"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#fff" d="M18 5.5v13L8.5 12zM5.3 5.5h2.2v13H5.3z"/></svg></div>
      <div class="xg-tips">上一集</div>
    </xg-icon>`;
  }
}

/** Skips `seconds` (negative: back) on a tap: a viewer's own seek, like the arrow keys. */
abstract class SeekButton extends Plugin {
  abstract get seconds(): number;

  afterCreate() {
    this.bind(tap(), (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      const media = this.player.media as HTMLVideoElement;
      media.currentTime = Math.max(0, Math.min(media.duration || Infinity, media.currentTime + this.seconds));
    });
  }

  render() {
    const back = this.seconds < 0;
    // A circular arrow with "10" inside; mirrored for forward.
    return `<xg-icon class="kp-seek" aria-label="${back ? "快退" : "快进"} 10 秒">
      <div class="xgplayer-icon"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"${back ? "" : ' style="transform:scaleX(-1)"'}>
        <path fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" d="M5.6 8.2A8 8 0 1 1 4 12"/><path fill="#fff" d="M4.2 3.8 5.8 9l5-1.9z"/>
      </svg><span class="kp-seek-n">10</span></div>
    </xg-icon>`;
  }
}

export class BackTenButton extends SeekButton {
  static get pluginName() {
    return "kpBack10";
  }

  static get defaultConfig() {
    return { position: Plugin.POSITIONS.CONTROLS_LEFT, index: 1 };
  }

  get seconds() {
    return -10;
  }
}

export class ForwardTenButton extends SeekButton {
  static get pluginName() {
    return "kpForward10";
  }

  static get defaultConfig() {
    return { position: Plugin.POSITIONS.CONTROLS_LEFT, index: 3 };
  }

  get seconds() {
    return 10;
  }
}

export class NextButton extends ActionButton {
  static get pluginName() {
    return "kpNext";
  }

  static get defaultConfig() {
    return { position: Plugin.POSITIONS.CONTROLS_LEFT, index: 4, onClick: null as (() => void) | null };
  }

  render() {
    return `<xg-icon class="kp-next" aria-label="下一集">
      <div class="xgplayer-icon"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#fff" d="M6 5.5v13l9.5-6.5zM16.5 5.5h2.2v13h-2.2z"/></svg></div>
      <div class="xg-tips">下一集</div>
    </xg-icon>`;
  }
}

/** "选集": opens the episode and line panel inside the player (shown in fullscreen only). */
export class EpisodesButton extends ActionButton {
  static get pluginName() {
    return "kpEpisodes";
  }

  static get defaultConfig() {
    return { position: Plugin.POSITIONS.CONTROLS_RIGHT, index: 2, onClick: null as (() => void) | null };
  }

  render() {
    return `<xg-icon class="kp-episodes"><div class="xgplayer-icon btn-text"><span class="icon-text">选集</span></div></xg-icon>`;
  }
}

/** Fullscreen title bar: what is playing and the time (a phone's status bar is hidden then). */
export class TitleBar extends Plugin {
  static get pluginName() {
    return "kpTitle";
  }

  static get defaultConfig() {
    return { position: Plugin.POSITIONS.ROOT_TOP, index: 1 };
  }

  private clock = 0;

  afterCreate() {
    const tick = () => {
      const el = this.find(".kp-clock");
      if (el) el.textContent = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    };
    tick();
    this.clock = window.setInterval(tick, 5_000);
  }

  setTitle(text: string) {
    const el = this.find(".kp-title");
    if (el) el.textContent = text;
  }

  destroy() {
    window.clearInterval(this.clock);
  }

  render() {
    return `<div class="kp-top"><span class="kp-title"></span><span class="kp-clock"></span></div>`;
  }
}

/*
 * Phone fullscreen keeps these controls instead of the system player. An iPhone gives a web page
 * no element fullscreen (only the system player), so the player covers the viewport instead
 * ("rotate fullscreen", which on phones does not rotate: the viewer turns the phone). Android
 * has real fullscreen and turns to landscape. Tablets and computers keep the default.
 */
function fullscreenMode() {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return { rotateFullscreen: true, needBackIcon: true };
  if (/Android/.test(ua) && /Mobile/.test(ua)) return { useScreenOrientation: true, lockOrientationType: "landscape", needBackIcon: true };
  return {};
}

export function createPlayer(options: {
  el: HTMLElement;
  url: string;
  poster: string | null;
  rate: number;
  rates: readonly number[];
  mobileBuffer: boolean;
  onFatal: (details: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onEpisodes: () => void;
}): SimplePlayer {
  const mobile = Sniffer.device === "mobile";
  const accent = "#ff6a3d";
  return new SimplePlayer({
    el: options.el,
    url: options.url,
    poster: options.poster ?? undefined,
    lang: "zh-cn",
    i18n: [langZhCn],
    width: "100%",
    height: "100%",
    // Start the plugins now (the viewer already pressed play); Player.tsx plays after seeking to
    // the resume position.
    videoInit: true,
    autoplay: false,
    playsinline: true,
    defaultPlaybackRate: options.rate,
    playbackRate: [...options.rates].reverse(),
    commonStyle: { playedColor: accent, volumeColor: accent, sliderBtnStyle: { background: accent } },
    plugins: [
      HlsSource,
      Progress,
      MiniProgress,
      Time,
      PrevButton,
      BackTenButton,
      PlayIcon,
      ForwardTenButton,
      NextButton,
      EpisodesButton,
      TitleBar,
      PlaybackRate,
      Fullscreen,
      Poster,
      Start,
      Loading,
      Enter,
      // Phones: volume is on the hardware buttons and the swipe gesture; the room goes to the
      // progress bar.
      ...(mobile ? [MobilePlugin] : [Volume, PIP, Keyboard, PCPlugin, CssFullScreen]),
    ],
    play: { index: 2 },
    time: { index: 5 },
    fullscreen: fullscreenMode(),
    pip: { showIcon: true },
    // → is ours (Player.tsx): its press-and-hold would first seek 10 s, then speed up.
    keyboard: { seekStep: 10, keyCodeMap: { right: { disable: true } } },
    // Swipe to seek, volume and brightness; long press plays at 2x.
    mobile: { disablePress: false, pressRate: 2 },
    kpSource: { mobile: options.mobileBuffer, onFatal: options.onFatal },
    kpPrev: { onClick: options.onPrev },
    kpNext: { onClick: options.onNext },
    kpEpisodes: { onClick: options.onEpisodes },
  });
}
