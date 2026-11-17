/**
 * What is on the cinema screen this frame — shared by the screen surface, the masking, the light
 * the screen throws into the room, and the trailer that plays on it.
 *
 * Like `lightState`, these values change every frame and live outside React. The trailer
 * (TrailerScreen) writes them; everything else reads them in useFrame.
 */
import type * as THREE from 'three';

export interface ScreenState {
  /** 0 = the film's still is on screen, 1 = the trailer video. Eased, so the two cross-fade. */
  video: number;
  /** The trailer's frames, while there is a trailer to show. */
  videoTexture: THREE.Texture | null;
  /** Shape (width / height) of the trailer's picture. */
  videoAspect: number;
  /**
   * Shape of the picture the side masking currently frames. Eases towards `aspectTarget`, so the
   * masking glides in and out like the motorised masking of a real hall.
   */
  aspect: number;
  aspectTarget: number;
  /**
   * How much light the picture throws into the room, relative to the still (1). While the trailer
   * plays it follows the video's real brightness, frame by frame.
   */
  light: number;
  /** Average colour of the trailer's current picture (0–1, brightest channel 1), for the light it casts. */
  tint: { r: number; g: number; b: number };
}

export const screenState: ScreenState = {
  video: 0,
  videoTexture: null,
  videoAspect: 16 / 9,
  aspect: 2.39,
  aspectTarget: 2.39,
  light: 1,
  tint: { r: 1, g: 1, b: 1 },
};

export function resetScreenState(screenAspect: number): void {
  screenState.video = 0;
  screenState.videoTexture = null;
  screenState.videoAspect = 16 / 9;
  screenState.aspect = screenAspect;
  screenState.aspectTarget = screenAspect;
  screenState.light = 1;
  screenState.tint = { r: 1, g: 1, b: 1 };
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
 * Average colour and brightness of RGBA pixels (0–255): the brightness as relative luminance
 * (0–1), the colour scaled so its brightest channel is 1. Near-black pictures read as neutral.
 */
export function averageColour(pixels: ArrayLike<number>): { luma: number; tint: { r: number; g: number; b: number } } {
  let r = 0;
  let g = 0;
  let b = 0;
  const count = Math.max(1, Math.floor(pixels.length / 4));
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    r += pixels[i];
    g += pixels[i + 1];
    b += pixels[i + 2];
  }
  r /= count * 255;
  g /= count * 255;
  b /= count * 255;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const peak = Math.max(r, g, b);
  const tint = peak > 0.02 ? { r: r / peak, g: g / peak, b: b / peak } : { r: 1, g: 1, b: 1 };
  return { luma, tint };
}

/** Light the picture throws for a given average brightness: dim scenes darken the room, bright ones flood it. */
export function lightForLuma(luma: number): number {
  return 0.35 + 1.5 * Math.min(1, Math.max(0, luma));
}
