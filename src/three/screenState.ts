/**
 * What is on the cinema screen this frame — shared by the screen surface, the masking, the light
 * the screen throws into the room, and the trailer player that projects onto it.
 *
 * Like `lightState`, these values change every frame and live outside React. The trailer
 * projection (TrailerProjection) writes them; everything else reads them in useFrame.
 */

export interface ScreenState {
  /** 0 = the film's still is on screen, 1 = the trailer video. Eased, so the two cross-fade. */
  video: number;
  /**
   * Shape (width / height) of the picture the side masking currently frames. Eases towards
   * `aspectTarget`, so the masking glides in and out like the motorised masking of a real hall.
   */
  aspect: number;
  aspectTarget: number;
  /** Shape of the trailer's picture (see Trailer.aspect), for the hole the video shows through. */
  videoAspect: number;
  /** 0–1, how bright the projected picture is right now: it changes with every cut, like a film. */
  level: number;
}

export const screenState: ScreenState = {
  video: 0,
  aspect: 2.39,
  aspectTarget: 2.39,
  videoAspect: 16 / 9,
  level: 0.6,
};

export function resetScreenState(screenAspect: number): void {
  screenState.video = 0;
  screenState.aspect = screenAspect;
  screenState.aspectTarget = screenAspect;
  screenState.videoAspect = 16 / 9;
  screenState.level = 0.6;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * The part of the screen a picture of the given shape covers, centred: a constant-height scope
 * screen shows a narrower picture full-height (side masking closes in), a wider one full-width.
 */
export function pictureRect(screen: Size, aspect: number): Size {
  const screenAspect = screen.width / screen.height;
  return aspect >= screenAspect
    ? { width: screen.width, height: screen.width / aspect }
    : { width: screen.height * aspect, height: screen.height };
}

/**
 * Size of the whole video frame (YouTube's player is 16:9) whose picture, of the given shape,
 * exactly covers `picture`: letterboxed pictures are as wide as the frame, pillarboxed ones as tall.
 */
export function videoFrameRect(picture: Size, pictureAspect: number, frameAspect = 16 / 9): Size {
  return pictureAspect >= frameAspect
    ? { width: picture.width, height: picture.width / frameAspect }
    : { width: picture.height * frameAspect, height: picture.height };
}

const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** One step sequence: a new value every `period` seconds, with a 0.12 s transition between them. */
function cuts(t: number, period: number, seed: number): number {
  const shot = Math.floor(t / period);
  const into = t - shot * period;
  const from = hash(shot - 1 + seed);
  const to = hash(shot + seed);
  const k = Math.min(1, into / 0.12);
  return from + (to - from) * k * k * (3 - 2 * k);
}

/**
 * A plausible brightness curve for a moving picture (0–1): two overlapping cut sequences, so
 * shots change irregularly every second or two, with gentle motion within each shot. The real
 * video cannot be sampled (it plays in YouTube's player), so the room is lit by this instead.
 */
export function pictureLevel(t: number): number {
  const shots = 0.6 * cuts(t, 2.3, 0) + 0.4 * cuts(t + 0.9, 1.45, 17);
  const motion = 0.08 * Math.sin(t * 1.9) + 0.05 * Math.sin(t * 4.7 + 1.3);
  return Math.min(1, Math.max(0, 0.18 + 0.75 * shots + motion));
}
