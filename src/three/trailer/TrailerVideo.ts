/**
 * The trailer video behind the cinema screen: a hidden <video> element whose frames are drawn onto
 * the 3D screen as a texture. The file is the one staff uploaded (served by our own server), so it
 * works offline and its pixels can be read — the room is lit by the real colours of the picture.
 *
 * Browsers only let a page start audible video after the visitor has interacted with it. Clicking
 * a seat usually counts; where it does not, the trailer plays muted and the HUD offers a button to
 * turn the sound on (that click is the interaction the browser was waiting for).
 */
import * as THREE from 'three';
import { averageColour } from '../screenState';

export type TrailerVideoStatus = 'loading' | 'ready' | 'playing' | 'paused' | 'error';

export interface TrailerVideoOptions {
  url: string;
  /** Start muted (the customer turned the sound off earlier). */
  muted: boolean;
  onStatus: (status: TrailerVideoStatus) => void;
  /** The browser refused audible playback, so the trailer plays muted until the customer asks for sound. */
  onSoundBlocked: (blocked: boolean) => void;
}

/** How often the picture's colour is measured for the room light (ms). */
const MEASURE_EVERY_MS = 120;

export class TrailerVideo {
  readonly video: HTMLVideoElement;
  readonly texture: THREE.VideoTexture;
  status: TrailerVideoStatus = 'loading';
  /** Width / height of the picture, known once the file's metadata has loaded. */
  aspect = 16 / 9;

  private wantPlaying = false;
  private muted: boolean;
  private soundBlocked = false;
  private destroyed = false;
  private readonly probe = document.createElement('canvas');
  private probeContext: CanvasRenderingContext2D | null = null;
  private measuredAt = 0;
  private readonly cleanup: Array<() => void> = [];

  constructor(private readonly options: TrailerVideoOptions) {
    this.muted = options.muted;
    const video = document.createElement('video');
    video.src = options.url;
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
    });
    on('canplay', () => {
      if (this.status === 'loading') this.setStatus('ready');
    });
    on('playing', () => this.setStatus('playing'));
    on('pause', () => {
      if (this.status !== 'error') this.setStatus('paused');
    });
    on('error', () => {
      console.warn(`[trailer] ${options.url} cannot be played (${video.error?.message || `media error ${video.error?.code ?? '?'}`}). Showing the film's still instead.`);
      this.wantPlaying = false;
      this.setStatus('error');
    });

    this.texture = new THREE.VideoTexture(video);
    // Sampled as raw sRGB: the screen shader works in display space, like the page.
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this.probe.width = 16;
    this.probe.height = 9;
    document.body.appendChild(video);
  }

  /** Play, with sound unless muted. Cheap to call every frame. */
  play(): void {
    if (this.wantPlaying || this.status === 'error' || this.destroyed) return;
    this.wantPlaying = true;
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
    if (this.wantPlaying) this.start();
  }

  /** 0–1. */
  setVolume(volume: number): void {
    const v = Math.max(0, Math.min(1, volume));
    if (Math.abs(this.video.volume - v) > 0.005) this.video.volume = v;
  }

  /**
   * Average colour and brightness of the current frame, measured a few times a second (null in
   * between, or when the frame cannot be read).
   */
  measure(now: number): ReturnType<typeof averageColour> | null {
    if (now - this.measuredAt < MEASURE_EVERY_MS || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    this.measuredAt = now;
    try {
      this.probeContext ??= this.probe.getContext('2d', { willReadFrequently: true });
      if (!this.probeContext) return null;
      this.probeContext.drawImage(this.video, 0, 0, this.probe.width, this.probe.height);
      return averageColour(this.probeContext.getImageData(0, 0, this.probe.width, this.probe.height).data);
    } catch {
      return null; // e.g. a video from another site without CORS: the picture still plays, just unmeasured
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.wantPlaying = false;
    for (const off of this.cleanup) off();
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load(); // releases the network connection and decoder
    this.video.remove();
    this.texture.dispose();
  }

  // ── internals ──

  private start(): void {
    const video = this.video;
    video.muted = this.muted || this.soundBlocked;
    video.play().catch((error: unknown) => {
      if (this.destroyed || !this.wantPlaying) return; // paused again before it started
      if (error instanceof DOMException && error.name === 'NotAllowedError' && !video.muted) {
        // No sound without a click on the page first: play muted and offer the sound button.
        this.setSoundBlocked(true);
        video.muted = true;
        video.play().catch(() => undefined);
      }
    });
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
