/**
 * YouTube trailer links.
 *
 * Staff can paste whatever link YouTube gives them — the address bar (youtube.com/watch?v=…),
 * the Share button (youtu.be/…, with or without a start time), an embed, Shorts or live link —
 * and parseYouTubeUrl() reduces it to the two things the player needs: the video id and the
 * second to start from. Anything else (other sites, playlists without a video, malformed ids)
 * is rejected, so a bad link fails when the catalogue loads instead of in front of a customer.
 */
import type { Trailer } from './types';

export interface YouTubeVideoRef {
  /** The 11-character video id, e.g. "aqz-KE-bpKQ". */
  id: string;
  /** Second to start from (from `t=` / `start=`), 0 when the link has none. */
  start: number;
}

/** Shape of the picture inside YouTube's 16:9 player when the trailer fills the frame. */
export const FULL_FRAME_ASPECT = 16 / 9;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** youtube.com and the privacy-enhanced youtube-nocookie.com, on any of their usual subdomains. */
const YOUTUBE_HOSTS = /^(?:(?:www|m|music)\.)?youtube(?:-nocookie)?\.com$/;
const SHORT_HOSTS = /^(?:www\.)?youtu\.be$/;
/** Paths that carry the id as their second segment: /embed/ID, /shorts/ID, /live/ID, /v/ID, /e/ID. */
const ID_PATHS = new Set(['embed', 'shorts', 'live', 'v', 'e']);

/** "90", "90s", "1m30s", "1h2m3s" → seconds. Returns 0 for anything else. */
export function parseStartTime(value: string | null | undefined): number {
  if (!value) return 0;
  const text = value.trim().toLowerCase();
  if (/^\d+(?:\.\d+)?s?$/.test(text)) return Math.floor(Number.parseFloat(text));
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
  if (!match) return 0;
  const [, h = '0', m = '0', s = '0'] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/**
 * Extracts the video id and start time from a YouTube link (or a bare 11-character id).
 * Returns null when the text is not a link to a single YouTube video.
 */
export function parseYouTubeUrl(input: string): YouTubeVideoRef | null {
  const text = input.trim();
  if (VIDEO_ID.test(text)) return { id: text, start: 0 };

  let url: URL;
  try {
    // Accept links pasted without a scheme ("youtu.be/…", "www.youtube.com/watch?v=…").
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  let id: string | undefined;
  if (SHORT_HOSTS.test(host)) {
    id = segments[0];
  } else if (YOUTUBE_HOSTS.test(host)) {
    if (segments[0] === 'watch') id = url.searchParams.get('v') ?? undefined;
    else if (segments.length >= 2 && ID_PATHS.has(segments[0])) id = segments[1];
  } else {
    return null;
  }
  if (!id || !VIDEO_ID.test(id)) return null;

  // A start time can sit in the query (?t=1m30s, &start=90) or, on old share links, in the hash (#t=90).
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const start = parseStartTime(url.searchParams.get('t') ?? url.searchParams.get('start') ?? hash.get('t'));
  return { id, start };
}

export interface TrailerOptions {
  /**
   * Shape of the picture inside the 16:9 video: leave it out for a trailer that fills the frame,
   * or give e.g. 2.39 for a scope trailer letterboxed with black bars — the hall's masking then
   * frames just the picture, the way a real projectionist would.
   */
  aspect?: number;
  /** Start here instead of at the link's own start time (seconds). */
  start?: number;
}

/** Builds a Trailer from a YouTube link. Throws on a link that is not a single YouTube video. */
export function youtubeTrailer(link: string, options: TrailerOptions = {}): Trailer {
  const ref = parseYouTubeUrl(link);
  if (!ref) throw new Error(`Not a YouTube video link: "${link}"`);
  const aspect = options.aspect ?? FULL_FRAME_ASPECT;
  if (!(aspect >= 1 && aspect <= 3)) throw new Error(`Trailer aspect ${aspect} must be between 1 and 3 (${link})`);
  const start = options.start ?? ref.start;
  if (!(Number.isInteger(start) && start >= 0)) throw new Error(`Trailer start ${start} must be a whole number of seconds (${link})`);
  return { url: link.trim(), youtubeId: ref.id, start, aspect: Math.round(aspect * 1000) / 1000 };
}
