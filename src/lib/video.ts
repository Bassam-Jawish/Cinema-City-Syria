/**
 * Looks inside a video file before it is uploaded, using the browser's own player: can this
 * browser play it at all, and how big is its picture? A file the browser cannot decode (typically
 * H.265/HEVC) would fail in customers' browsers too; a picture larger than 1080p costs slower
 * computers smooth playback in the 3D hall for no visible gain.
 */

export interface VideoInfo {
  width: number;
  height: number;
  /** Seconds. */
  duration: number;
}

/** The hall shows trailers up to this size; larger pictures only cost decoding time. */
export const HALL_MAX_VIDEO = { width: 1920, height: 1080 } as const;

/**
 * The file's picture size and length; 'unplayable' when this browser cannot decode its picture;
 * null when it cannot tell in time (then the server's own checks decide).
 */
export function inspectVideo(file: Blob, timeoutMs = 8000): Promise<VideoInfo | 'unplayable' | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const finish = (result: VideoInfo | 'unplayable' | null) => {
      window.clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    // A picture the browser cannot decode loads as sound only (no width) or fails outright.
    video.onloadedmetadata = () =>
      finish(video.videoWidth > 0 ? { width: video.videoWidth, height: video.videoHeight, duration: video.duration } : 'unplayable');
    video.onerror = () => finish('unplayable');
    video.src = url;
  });
}

/** Whether the picture is larger than the hall can show. */
export function largerThanHall(info: VideoInfo): boolean {
  return info.width > HALL_MAX_VIDEO.width || info.height > HALL_MAX_VIDEO.height;
}
