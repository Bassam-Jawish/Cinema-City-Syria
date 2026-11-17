/**
 * A YouTube trailer player for the cinema screen, built on the official YouTube IFrame Player API
 * (https://developers.google.com/youtube/iframe_api_reference). The API script is loaded on demand,
 * the first time a customer sits down, so the hall itself never depends on YouTube being reachable:
 * if it is not (offline demo, blocked network), the screen simply keeps showing the film's still.
 *
 * Browsers only let a page start audible video after the visitor has interacted with it. Clicking
 * a seat counts in Chrome, Edge and Firefox; where it does not (Safari, some phones), the trailer
 * plays muted and the HUD offers a button to turn the sound on.
 */
import type { Lang, Trailer } from '@shared/types';

// ── the subset of the IFrame API we use ──

interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setVolume(volume: number): void;
  getPlayerState(): number;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
}

interface YouTubePlayerEvent {
  target: YouTubePlayer;
  data: number;
}

interface YouTubeNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      host?: string;
      videoId: string;
      width?: number | string;
      height?: number | string;
      playerVars?: Record<string, string | number>;
      events?: Partial<
        Record<'onReady' | 'onStateChange' | 'onError' | 'onAutoplayBlocked', (event: YouTubePlayerEvent) => void>
      >;
    },
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: Partial<YouTubeNamespace>;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

const API_URL = 'https://www.youtube.com/iframe_api';
/** Privacy-enhanced mode: YouTube sets no cookies until the visitor plays a video. */
const PLAYER_HOST = 'https://www.youtube-nocookie.com';
const API_TIMEOUT_MS = 15_000;
const READY_TIMEOUT_MS = 20_000;
/** How long a play request with sound may take to start before falling back to muted playback. */
const SOUND_WATCHDOG_MS = 3_000;

/** Pixel size of the player's 16:9 frame. YouTube picks the stream quality from it (720p). */
export const PLAYER_WIDTH = 1280;
export const PLAYER_HEIGHT = 720;

let apiPromise: Promise<YouTubeNamespace> | null = null;

/** Loads the IFrame API once. Rejects (and lets a later call try again) if it cannot be reached. */
export function loadYouTubeApi(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT as YouTubeNamespace);
  if (apiPromise) return apiPromise;
  const script = document.createElement('script');
  apiPromise = new Promise<YouTubeNamespace>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('The YouTube player API did not load in time')), API_TIMEOUT_MS);
    // The API calls this global when it is ready; keep any handler someone else installed.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      window.clearTimeout(timer);
      if (window.YT?.Player) resolve(window.YT as YouTubeNamespace);
      else reject(new Error('The YouTube player API is incomplete'));
    };
    script.src = API_URL;
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('The YouTube player API could not be loaded'));
    };
    document.head.appendChild(script);
  });
  apiPromise.catch(() => {
    apiPromise = null;
    script.remove();
  });
  return apiPromise;
}

export type TrailerPlayerStatus = 'loading' | 'ready' | 'playing' | 'paused' | 'error' | 'unavailable';

export interface TrailerPlayerOptions {
  trailer: Trailer;
  /** Accessible title of the player frame. */
  title: string;
  /** Interface language for YouTube's own captions and messages. */
  lang: Lang;
  /** Start muted (the customer turned the sound off earlier). */
  muted: boolean;
  onStatus: (status: TrailerPlayerStatus) => void;
  /** The browser refused audible playback, so the trailer plays muted until the customer asks for sound. */
  onSoundBlocked: (blocked: boolean) => void;
}

/**
 * One trailer, played on demand. All methods are cheap and idempotent, so the scene can call
 * play() / pause() / setVolume() every frame with whatever it currently wants.
 */
export class TrailerPlayer {
  /** The player's frame, PLAYER_WIDTH × PLAYER_HEIGHT pixels. Place it in the page; it is not attached anywhere yet. */
  readonly element: HTMLDivElement;
  status: TrailerPlayerStatus = 'loading';

  private player: YouTubePlayer | null = null;
  private ready = false;
  private destroyed = false;
  private wantPlaying = false;
  private muted: boolean;
  private soundBlocked = false;
  private volume = 0;
  private sentVolume = -1;
  private unmutedAt = 0;
  private resumes: number[] = [];
  private timers = new Set<number>();
  private watchdog = 0;

  constructor(private readonly options: TrailerPlayerOptions) {
    this.muted = options.muted;
    this.element = document.createElement('div');
    Object.assign(this.element.style, {
      width: `${PLAYER_WIDTH}px`,
      height: `${PLAYER_HEIGHT}px`,
      background: '#000',
      pointerEvents: 'none',
    });
  }

  /** Loads the API and the video. The element must be in the document by now. */
  load(): void {
    const ready = this.later(() => this.fail('unavailable', 'The trailer did not load in time'), READY_TIMEOUT_MS);
    loadYouTubeApi().then(
      (YT) => {
        if (this.destroyed) return;
        const mount = document.createElement('div');
        this.element.appendChild(mount);
        const { trailer, lang } = this.options;
        this.player = new YT.Player(mount, {
          host: PLAYER_HOST,
          videoId: trailer.youtubeId,
          width: PLAYER_WIDTH,
          height: PLAYER_HEIGHT,
          playerVars: {
            enablejsapi: 1,
            origin: window.location.origin,
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            playsinline: 1,
            rel: 0,
            hl: lang,
            start: trailer.start,
          },
          events: {
            onReady: () => {
              window.clearTimeout(ready);
              this.timers.delete(ready);
              this.onReady();
            },
            onStateChange: (event) => this.onStateChange(event.data),
            onError: (event) => this.fail('error', `YouTube refused to play trailer ${trailer.youtubeId} (error ${event.data})`),
            onAutoplayBlocked: () => this.fallBackToMuted(),
          },
        });
      },
      (error: unknown) => this.fail('unavailable', error instanceof Error ? error.message : String(error)),
    );
  }

  /** Play (with sound unless muted). Starts as soon as the player is ready. */
  play(): void {
    if (this.wantPlaying || this.status === 'error' || this.status === 'unavailable') return;
    this.wantPlaying = true;
    if (this.ready) this.start();
  }

  pause(): void {
    if (!this.wantPlaying) return;
    this.wantPlaying = false;
    this.clearWatchdog();
    if (this.ready) {
      const state = this.player!.getPlayerState();
      if (state === STATE.PLAYING || state === STATE.BUFFERING) this.player!.pauseVideo();
    }
  }

  /** Turn the sound off or on. Call it from the click that asked for it: browsers want a gesture for sound. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!muted) this.setSoundBlocked(false);
    if (!this.ready) return;
    if (muted) {
      this.player!.mute();
    } else {
      this.unmutedAt = performance.now();
      this.player!.unMute();
      this.sendVolume(true);
      if (this.wantPlaying) this.player!.playVideo();
    }
  }

  /** 0–100. Sent to the player only when it has changed noticeably. */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(100, volume));
    this.sendVolume(false);
  }

  destroy(): void {
    this.destroyed = true;
    this.clearWatchdog();
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    try {
      this.player?.destroy();
    } catch {
      // The iframe may already be gone with the page.
    }
    this.player = null;
    this.element.remove();
  }

  // ── internals ──

  private onReady(): void {
    if (this.destroyed || !this.player) return;
    this.ready = true;
    try {
      // Name the frame for assistive tech and keep it out of the tab order: it is part of the 3D view.
      const iframe = this.player.getIframe();
      iframe.title = this.options.title;
      iframe.tabIndex = -1;
      iframe.style.display = 'block';
    } catch {
      // Cosmetic only.
    }
    if (this.muted) this.player.mute();
    else this.player.unMute();
    this.sendVolume(true);
    this.setStatus('ready');
    if (this.wantPlaying) this.start();
  }

  private start(): void {
    const player = this.player!;
    if (this.muted || this.soundBlocked) player.mute();
    else player.unMute();
    this.sendVolume(true);
    player.playVideo();
    // Some browsers refuse audible playback without telling the page: if nothing starts, go muted.
    this.clearWatchdog();
    if (!this.muted && !this.soundBlocked) this.armWatchdog();
  }

  private armWatchdog(): void {
    this.watchdog = this.later(() => {
      this.watchdog = 0;
      if (!this.wantPlaying || !this.ready) return;
      const state = this.player!.getPlayerState();
      if (state === STATE.BUFFERING) this.armWatchdog(); // still loading, not refused
      else if (state !== STATE.PLAYING) this.fallBackToMuted();
    }, SOUND_WATCHDOG_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdog) {
      window.clearTimeout(this.watchdog);
      this.timers.delete(this.watchdog);
      this.watchdog = 0;
    }
  }

  private fallBackToMuted(): void {
    if (this.destroyed || !this.ready || !this.wantPlaying) return;
    this.clearWatchdog();
    this.setSoundBlocked(!this.muted);
    this.player!.mute();
    this.player!.playVideo();
  }

  private onStateChange(state: number): void {
    if (this.destroyed || !this.player) return;
    switch (state) {
      case STATE.PLAYING:
        this.clearWatchdog();
        if (!this.wantPlaying) {
          // Started after the customer had already stood up.
          this.player.pauseVideo();
          return;
        }
        // Some browsers start the video but silence it themselves.
        if (!this.muted && this.player.isMuted()) this.setSoundBlocked(true);
        this.setStatus('playing');
        break;
      case STATE.BUFFERING:
        if (this.status !== 'playing') this.setStatus('loading');
        break;
      case STATE.ENDED:
        // Loop, like a pre-show reel.
        this.setStatus('paused');
        if (this.wantPlaying) {
          this.player.seekTo(this.options.trailer.start, true);
          this.player.playVideo();
        }
        break;
      case STATE.PAUSED:
        this.setStatus('paused');
        if (this.wantPlaying) this.resumeAfterUnexpectedPause();
        break;
      case STATE.CUED:
        this.setStatus('ready');
        break;
      default:
        break;
    }
  }

  /** The player paused although we want it playing: usually a browser refusing sound right after unmuting. */
  private resumeAfterUnexpectedPause(): void {
    const now = performance.now();
    if (now - this.unmutedAt < 1500 && !this.muted) {
      this.fallBackToMuted();
      return;
    }
    // Otherwise carry on, but never fight the player in a loop.
    this.resumes = this.resumes.filter((t) => now - t < 10_000);
    if (this.resumes.length >= 3) return;
    this.resumes.push(now);
    this.player!.playVideo();
  }

  private sendVolume(force: boolean): void {
    if (!this.ready || !this.player) return;
    const volume = Math.round(this.volume);
    if (!force && Math.abs(volume - this.sentVolume) < 2 && !(volume === 0 && this.sentVolume !== 0) && !(volume === 100 && this.sentVolume !== 100)) {
      return;
    }
    this.sentVolume = volume;
    this.player.setVolume(volume);
  }

  private setSoundBlocked(blocked: boolean): void {
    if (this.soundBlocked === blocked) return;
    this.soundBlocked = blocked;
    this.options.onSoundBlocked(blocked);
  }

  private setStatus(status: TrailerPlayerStatus): void {
    if (this.status === status || this.destroyed) return;
    this.status = status;
    this.options.onStatus(status);
  }

  private fail(status: 'error' | 'unavailable', reason: string): void {
    if (this.destroyed || this.status === 'error' || this.status === 'unavailable') return;
    console.warn(`[trailer] ${reason}. Showing the film's still instead.`);
    this.wantPlaying = false;
    this.clearWatchdog();
    this.setStatus(status);
  }

  private later(fn: () => void, ms: number): number {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (!this.destroyed) fn();
    }, ms);
    this.timers.add(id);
    return id;
  }
}
