import { describe, expect, it } from 'vitest';
import { pictureLevel, pictureRect, videoFrameRect } from './screenState';

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

  it("sizes YouTube's 16:9 frame so the picture inside it lands exactly on the picture area", () => {
    // A letterboxed scope trailer: the frame is as wide as the picture and taller (bars hidden by masking).
    const scope = pictureRect(SCOPE, 2.39);
    const scopeFrame = videoFrameRect(scope, 2.39);
    expect(scopeFrame.width).toBeCloseTo(scope.width);
    expect(scopeFrame.width / scopeFrame.height).toBeCloseTo(16 / 9);
    // A full-frame trailer: frame and picture coincide.
    const flat = pictureRect(SCOPE, 16 / 9);
    const flatFrame = videoFrameRect(flat, 16 / 9);
    expect(flatFrame.width).toBeCloseTo(flat.width);
    expect(flatFrame.height).toBeCloseTo(flat.height);
    // A 4:3 picture pillarboxed inside the 16:9 frame: as tall as the picture, wider.
    const academy = pictureRect(SCOPE, 4 / 3);
    const academyFrame = videoFrameRect(academy, 4 / 3);
    expect(academyFrame.height).toBeCloseTo(academy.height);
    expect(academyFrame.width).toBeGreaterThan(academy.width);
  });
});

describe('pictureLevel', () => {
  it('stays within 0–1 and keeps changing, like a film', () => {
    const samples = Array.from({ length: 600 }, (_, i) => pictureLevel(i * 0.05));
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1);
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.3);
  });
});
