/**
 * The trailer video behind the cinema screen: a hidden <video> element whose frames are drawn onto
 * the 3D screen as a texture. The file is the one staff uploaded (served by our own server), so it
 * works offline and its pixels can be read — the room is lit by the real colours of the picture
 * (measured on the GPU by PictureMeter, never by reading frames back into a canvas).
 *
 * Browsers only let a page start audible video after the visitor has interacted with it. Clicking
 * a seat usually counts; where it does not, the trailer plays muted and the HUD offers a button to
 * turn the sound on (that click is the interaction the browser was waiting for).
 *
 * Playback survives interruptions, picking up where it stopped:
 * - paused by the browser or the system (another tab or app took the sound, a phone call, headphones
 *   unplugged): it starts again by itself while the customer is still seated;
 * - the tab hidden: it pauses, and carries on when the customer comes back;
 * - the network or the server dropping out: it reloads the file and seeks back, retrying with a
 *   growing pause, and straight away when the device is back online;
 * - the hall closed and opened again (on to checkout and back, "see the view from my seat"): it
 *   continues from the same moment.
 * Pausing from the keyboard's media keys or the system's media controls is respected until the
 * customer presses play there, or stands up and sits down again.
 */
import * as THREE from 'three';

export type TrailerVideoStatus = 'loading' | 'ready' | 'playing' | 'paused' | 'error';

export interface TrailerVideoOptions {
  url: string;
  /** Start muted (the customer turned the sound off earlier). */
  muted: boolean;
  onStatus: (status: TrailerVideoStatus) => void;
  /** The browser refused audible playback, so the trailer plays muted until the customer asks for sound. */
  onSoundBlocked: (blocked: boolean) => void;
  /** The file failed to load (it is being retried) — e.g. staff replaced it and this URL is gone. */
  onFailure?: () => void;
}

/** Least time between two attempts to restart a video something else paused (ms). */
const RESUME_EVERY_MS = 1500;
/** Waits before reloading a file that failed: 1 s, 2 s, 4 s … up to 15 s; then the still stays. */
const RECOVERY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 15000];

/** Where each trailer was left, so a hall opened again carries on from there (per page visit). */
const positions = new Map<string, number>();

export class TrailerVideo {
  readonly video: HTMLVideoElement;
  readonly texture: THREE.VideoTexture;
  status: TrailerVideoStatus = 'loading';
  /** Width / height of the picture, known once the file's metadata has loaded. */
  aspect = 16 / 9;

  /** The director wants the trailer running (the customer is seated). */
  private wantPlaying = false;
  /** Paused from the system's media controls: stays paused until play is pressed there or the customer sits down again. */
  private heldByUser = false;
  private muted: boolean;
  private soundBlocked = false;
  private destroyed = false;
  private resumeTriedAt = Number.NEGATIVE_INFINITY;
  /** Last moment of the trailer known to have played, in seconds — where a reload seeks back to. */
  private lastTime = 0;
  /** A position to seek to once the file's metadata is in (after a reload or reopening the hall). */
  private seekTo: number | null;
  private failures = 0;
  private recoveryTimer: number | null = null;
  private readonly cleanup: Array<() => void> = [];

  constructor(private readonly options: TrailerVideoOptions) {
    this.muted = options.muted;
    this.seekTo = positions.get(options.url) ?? null;
    this.lastTime = this.seekTo ?? 0;
    const video = document.createElement('video');
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.muted = options.muted;
    video.volume = 0;
    video.disableRemotePlayback = true;
    video.setAttribute('aria-hidden', 'true');
    // Kept in the page (some mobile browsers only play attached videos) but invisible: it is drawn in 3D.
    Object.assign(video.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '2px',
      height: '2px',
      opacity: '0',
      pointerEvents: 'none',
    });
    this.video = video;

    const on = <K extends keyof HTMLMediaElementEventMap>(type: K, handler: () => void) => {
      video.addEventListener(type, handler);
      this.cleanup.push(() => video.removeEventListener(type, handler));
    };
    on('loadedmetadata', () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) this.aspect = video.videoWidth / video.videoHeight;
      if (this.seekTo !== null && Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = this.seekTo % video.duration;
      }
      this.seekTo = null;
    });
    on('canplay', () => {
      if (this.status === 'loading') this.setStatus('ready');
    });
    on('playing', () => {
      this.failures = 0;
      this.setStatus('playing');
    });
    on('timeupdate', () => {
      if (video.currentTime > 0) this.lastTime = video.currentTime;
    });
    on('pause', () => {
      if (this.status !== 'error' && this.status !== 'loading') this.setStatus('paused');
    });
    on('error', () => this.recover());

    this.texture = new THREE.VideoTexture(video);
    // Sampled as raw sRGB: the screen shader works in display space, like the page.
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    // A hidden tab pauses the trailer; the next frame after the customer comes back resumes it.
    const onVisibility = () => {
      if (document.hidden && this.wantPlaying) video.pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanup.push(() => document.removeEventListener('visibilitychange', onVisibility));
    // Back online after a failure: try again now rather than at the next scheduled attempt.
    const onOnline = () => {
      if (this.recoveryTimer !== null || this.status === 'error') {
        this.failures = 0;
        this.reload();
      }
    };
    window.addEventListener('online', onOnline);
    this.cleanup.push(() => window.removeEventListener('online', onOnline));

    video.src = options.url;
    document.body.appendChild(video);
  }

  /** Play, with sound unless muted. Cheap to call every frame: it also restarts a video something else paused. */
  play(): void {
    if (this.destroyed || this.status === 'error') return;
    if (!this.wantPlaying) {
      this.wantPlaying = true;
      this.heldByUser = false; // sitting down again overrides a pause from the media keys
      this.claimMediaKeys();
      this.start();
      return;
    }
    // Still seated but not playing: the browser or the system paused it, or the tab was hidden.
    const video = this.video;
    if (!video.paused || this.heldByUser || document.hidden || this.recoveryTimer !== null) return;
    if (video.readyState === HTMLMediaElement.HAVE_NOTHING) return; // (re)loading: it starts when it can
    const now = performance.now();
    if (now - this.resumeTriedAt < RESUME_EVERY_MS) return;
    this.start();
  }

  pause(): void {
    if (!this.wantPlaying) return;
    this.wantPlaying = false;
    this.video.pause();
  }

  /** Turn the sound off or on. Call it from the click that asked for it: browsers want a gesture for sound. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.video.muted = muted;
    if (muted) return;
    this.setSoundBlocked(false);
    if (this.wantPlaying && !this.heldByUser) this.start();
  }

  /** 0–1. */
  setVolume(volume: number): void {
    const v = Math.max(0, Math.min(1, volume));
    if (Math.abs(this.video.volume - v) > 0.005) this.video.volume = v;
  }

  destroy(): void {
    if (this.lastTime > 0) positions.set(this.options.url, this.video.currentTime || this.lastTime);
    this.destroyed = true;
    this.wantPlaying = false;
    if (this.recoveryTimer !== null) window.clearTimeout(this.recoveryTimer);
    for (const off of this.cleanup) off();
    this.releaseMediaKeys();
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load(); // releases the network connection and decoder
    this.video.remove();
    this.texture.dispose();
  }

  // ── internals ──

  private start(): void {
    const video = this.video;
    this.resumeTriedAt = performance.now();
    video.muted = this.muted || this.soundBlocked;
    video.play().catch((error: unknown) => {
      if (this.destroyed || !this.wantPlaying) return; // paused again before it started
      if (error instanceof DOMException && error.name === 'NotAllowedError' && !video.muted) {
        // No sound without a click on the page first: play muted and offer the sound button.
        this.setSoundBlocked(true);
        video.muted = true;
        video.play().catch(() => undefined);
      }
      // Anything else (e.g. interrupted by a reload): the next frames try again.
    });
  }

  /** The file failed to load or play (network, server, a damaged frame): reload it after a pause. */
  private recover(): void {
    if (this.destroyed) return;
    const code = this.video.error?.code;
    if (code === MediaError.MEDIA_ERR_ABORTED || this.recoveryTimer !== null) return;
    this.options.onFailure?.();
    const delay = RECOVERY_DELAYS_MS[this.failures];
    if (delay === undefined) {
      console.warn(
        `[trailer] ${this.options.url} cannot be played (${this.video.error?.message || `media error ${code ?? '?'}`}). Showing the film's still instead.`,
      );
      this.setStatus('error');
      return;
    }
    this.failures++;
    this.setStatus('loading'); // the screen shows the still meanwhile
    this.recoveryTimer = window.setTimeout(() => this.reload(), delay);
  }

  private reload(): void {
    if (this.destroyed) return;
    if (this.recoveryTimer !== null) window.clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    if (this.status === 'error') this.setStatus('loading');
    this.seekTo = this.lastTime;
    this.video.src = this.options.url;
    this.video.load();
    if (this.wantPlaying && !this.heldByUser) this.start();
  }

  /** Lets the media keys and the system's media controls pause and resume the trailer on purpose. */
  private claimMediaKeys(): void {
    const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!session) return;
    try {
      session.setActionHandler('pause', () => {
        this.heldByUser = true;
        this.video.pause();
      });
      session.setActionHandler('play', () => {
        this.heldByUser = false;
        if (this.wantPlaying) this.start();
      });
    } catch {
      // Not supported on this browser: the controls then just pause the video, and it resumes.
    }
  }

  private releaseMediaKeys(): void {
    const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!session) return;
    try {
      session.setActionHandler('pause', null);
      session.setActionHandler('play', null);
    } catch {
      // ignore
    }
  }

  private setSoundBlocked(blocked: boolean): void {
    if (this.soundBlocked === blocked) return;
    this.soundBlocked = blocked;
    this.options.onSoundBlocked(blocked);
  }

  private setStatus(status: TrailerVideoStatus): void {
    if (this.status === status || this.destroyed) return;
    this.status = status;
    this.options.onStatus(status);
  }
}
