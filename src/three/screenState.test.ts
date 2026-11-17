import { describe, expect, it } from 'vitest';
import { averageColour, lightForLuma, pictureRect } from './screenState';

const SCOPE = { width: 11.6, height: 11.6 / 2.39 };

describe('screen framing', () => {
  it('shows a flat picture full-height on a scope screen, with the sides masked', () => {
    const picture = pictureRect(SCOPE, 16 / 9);
    expect(picture.height).toBeCloseTo(SCOPE.height);
    expect(picture.width).toBeCloseTo(SCOPE.height * (16 / 9));
    expect(picture.width).toBeLessThan(SCOPE.width);
  });

  it('fills a scope screen with a scope picture, and letterboxes a wider one', () => {
    const scope = pictureRect(SCOPE, 2.39);
    expect(scope.width).toBeCloseTo(SCOPE.width);
    expect(scope.height).toBeCloseTo(SCOPE.height);
    const wider = pictureRect(SCOPE, 2.76);
    expect(wider.width).toBeCloseTo(SCOPE.width);
    expect(wider.height).toBeLessThan(SCOPE.height);
  });
});

describe('picture light', () => {
  const pixels = (r: number, g: number, b: number, n = 4) => Array.from({ length: n }, () => [r, g, b, 255]).flat();

  it('measures the brightness and colour of a frame', () => {
    const white = averageColour(pixels(255, 255, 255));
    expect(white.luma).toBeCloseTo(1);
    expect(white.tint).toEqual({ r: 1, g: 1, b: 1 });
    const sunset = averageColour(pixels(200, 100, 40));
    expect(sunset.tint.r).toBe(1);
    expect(sunset.tint.g).toBeCloseTo(0.5);
    expect(sunset.luma).toBeGreaterThan(0.3);
    // Black frames do not tint the room.
    expect(averageColour(pixels(0, 0, 0)).tint).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('dims the room for dark scenes and floods it for bright ones', () => {
    expect(lightForLuma(0)).toBeLessThan(0.5);
    expect(lightForLuma(1)).toBeGreaterThan(1.5);
    expect(lightForLuma(0.4)).toBeCloseTo(0.95);
  });
});
