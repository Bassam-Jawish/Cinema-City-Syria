/**
 * Small textures drawn on a 2D canvas at runtime — no image files to ship or load.
 * Each one is created once and cached for the lifetime of the page.
 */
import * as THREE from 'three';

type Draw = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, width: number, height: number, draw: Draw, color = true): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  // Colour textures are authored in sRGB; data textures (alpha masks) must not be colour-converted.
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  cache.set(key, texture);
  return texture;
}

/** Canvas text uses a fallback face until the web font has loaded; redraw once it has. */
function redrawWhenFontReady(texture: THREE.CanvasTexture, font: string, draw: Draw): void {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  document.fonts
    .load(font)
    .then(() => {
      const canvas = texture.image as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      draw(ctx, canvas.width, canvas.height);
      texture.needsUpdate = true;
    })
    .catch(() => undefined);
}

/** Soft round glow: white centre fading to transparent. Use with additive blending. */
export function glowTexture(): THREE.CanvasTexture {
  return make('glow', 128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.6)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/** Light thrown up a wall by a sconce: bright at the bottom centre, fanning out as it rises. */
export function washTexture(): THREE.CanvasTexture {
  return make('wash', 128, 256, (ctx, w, h) => {
    ctx.save();
    ctx.translate(w / 2, h);
    ctx.scale(1, 2.1);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.62);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.4)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-w, -h, w * 2, h);
    ctx.restore();
  });
}

/** Alpha ramp for light beams: opaque at the bottom (v = 0), transparent at the top (v = 1). */
export function fadeTexture(): THREE.CanvasTexture {
  return make(
    'fade',
    4,
    128,
    (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#000');
      g.addColorStop(0.55, '#3a3a3a');
      g.addColorStop(1, '#fff');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    false,
  );
}

/** Damascene eight-point-star lattice for the acoustic wall panels. Tileable; multiply with a colour. */
export function latticeTexture(): THREE.CanvasTexture {
  const texture = make('lattice', 256, 256, (ctx, w) => {
    ctx.fillStyle = 'rgb(200,200,200)';
    ctx.fillRect(0, 0, w, w);
    const star = (cx: number, cy: number, r: number) => {
      ctx.beginPath();
      for (let k = 0; k < 16; k++) {
        const radius = k % 2 === 0 ? r : r * 0.62;
        const a = (k * Math.PI) / 8 - Math.PI / 2;
        const x = cx + Math.cos(a) * radius;
        const y = cy + Math.sin(a) * radius;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    };
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 3;
    for (const [x, y] of [
      [0, 0],
      [w, 0],
      [0, w],
      [w, w],
      [w / 2, w / 2],
    ]) {
      star(x, y, w * 0.34);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    for (const [x, y] of [
      [w / 2, 0],
      [0, w / 2],
      [w, w / 2],
      [w / 2, w],
    ]) {
      star(x, y, w * 0.14);
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** Cinema carpet: a fine diamond motif. Tileable; multiply with the carpet colour. */
export function carpetTexture(): THREE.CanvasTexture {
  const texture = make('carpet', 128, 128, (ctx, w) => {
    ctx.fillStyle = 'rgb(214,214,214)';
    ctx.fillRect(0, 0, w, w);
    // Fibre noise.
    const image = ctx.getImageData(0, 0, w, w);
    let seed = 7;
    for (let i = 0; i < image.data.length; i += 4) {
      seed = (seed * 16807) % 2147483647;
      const n = (seed / 2147483647 - 0.5) * 26;
      image.data[i] += n;
      image.data[i + 1] += n;
      image.data[i + 2] += n;
    }
    ctx.putImageData(image, 0, 0);
    ctx.fillStyle = 'rgba(255,236,190,0.55)';
    const diamond = (cx: number, cy: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
    };
    for (const [x, y] of [
      [0, 0],
      [w, 0],
      [0, w],
      [w, w],
      [w / 2, w / 2],
    ]) {
      diamond(x, y, 7);
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

const EXIT_FONT_AR = '700 50px "Readex Pro Variable", "Segoe UI", sans-serif';
const EXIT_FONT_EN = '600 44px "Readex Pro Variable", "Segoe UI", sans-serif';

/** Illuminated green exit sign, bilingual. */
export function exitSignTexture(): THREE.CanvasTexture {
  const draw: Draw = (ctx, w, h) => {
    ctx.fillStyle = '#06371f';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(160,255,200,0.55)';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#d9ffe9';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = EXIT_FONT_EN;
    ctx.fillText('EXIT', w * 0.3, h / 2 + 2);
    ctx.font = EXIT_FONT_AR;
    ctx.direction = 'rtl';
    ctx.fillText('مخرج', w * 0.72, h / 2 - 2);
  };
  const created = !cache.has('exit');
  const texture = make('exit', 256, 96, draw);
  if (created) redrawWhenFontReady(texture, EXIT_FONT_AR, draw);
  return texture;
}

const LETTER_FONT = '600 64px "IBM Plex Mono", ui-monospace, monospace';

/** Round badge with a row letter, for the labels at the ends of each row. */
export function letterTexture(letter: string): THREE.CanvasTexture {
  const key = `letter:${letter}`;
  const draw: Draw = (ctx, w, h) => {
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(13,8,9,0.82)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(240,181,69,0.9)';
    ctx.stroke();
    ctx.fillStyle = '#ffd68a';
    ctx.font = LETTER_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, w / 2, h / 2 + 3);
  };
  const created = !cache.has(key);
  const texture = make(key, 128, 128, draw);
  if (created) redrawWhenFontReady(texture, LETTER_FONT, draw);
  return texture;
}
