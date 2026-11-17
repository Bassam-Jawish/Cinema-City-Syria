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

/** Soft halo across a linear light: transparent at both edges (v = 0, 1), bright along the middle. */
export function lineGlowTexture(): THREE.CanvasTexture {
  return make('line-glow', 4, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.36, 'rgba(255,255,255,0.18)');
    g.addColorStop(0.48, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(0.52, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.64, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/** Light grazing down a wall from a cove: bright at the top (v = 1), fading out towards the bottom. */
export function coveWashTexture(): THREE.CanvasTexture {
  return make('cove-wash', 4, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
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

/**
 * Damascene eight-point-star lattice — the hall's local touch, cut into its acoustic wall panels
 * like a modern mashrabiya. Tileable; multiply with a colour.
 */
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

/** Cinema carpet: a dense loop pile with a scatter of fine flecks. Tileable; multiply with the carpet colour. */
export function carpetTexture(): THREE.CanvasTexture {
  const texture = make('carpet', 256, 256, (ctx, w) => {
    ctx.fillStyle = 'rgb(206,206,206)';
    ctx.fillRect(0, 0, w, w);
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    // Fibre noise.
    const image = ctx.getImageData(0, 0, w, w);
    for (let i = 0; i < image.data.length; i += 4) {
      const n = (rand() - 0.5) * 34;
      image.data[i] += n;
      image.data[i + 1] += n;
      image.data[i + 2] += n;
    }
    ctx.putImageData(image, 0, 0);
    // Short light and dark flecks, wrapped at the edges so the tile repeats seamlessly.
    for (let i = 0; i < 260; i++) {
      const x = rand() * w;
      const y = rand() * w;
      const len = 2 + rand() * 5;
      const a = rand() * Math.PI;
      ctx.strokeStyle = rand() < 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1.2;
      for (const [ox, oy] of [
        [0, 0],
        [w, 0],
        [-w, 0],
        [0, w],
        [0, -w],
      ]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
        ctx.stroke();
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Perforated metal speaker grille: a fine hexagonal dot grid. Tileable; multiply with a colour. */
export function grilleTexture(): THREE.CanvasTexture {
  const texture = make('grille', 64, 64, (ctx, w) => {
    ctx.fillStyle = 'rgb(150,150,150)';
    ctx.fillRect(0, 0, w, w);
    ctx.fillStyle = 'rgb(20,20,20)';
    const step = w / 8;
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const x = col * step + (row % 2 ? step / 2 : 0);
        const y = row * step * 0.866 * (8 / 6.93);
        ctx.beginPath();
        ctx.arc(x % w, y % w, step * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

const EXIT_FONT_AR = '700 44px "IBM Plex Sans Arabic", "Segoe UI", sans-serif';
const EXIT_FONT_EN = '700 34px "IBM Plex Sans Arabic", "Segoe UI", sans-serif';

/** Illuminated green exit sign: the ISO 7010 running figure leaving through a door, and the word in both languages. */
export function exitSignTexture(): THREE.CanvasTexture {
  const draw: Draw = (ctx, w, h) => {
    ctx.fillStyle = '#078a47';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(220,255,235,0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    // Door.
    const unit = h / 96;
    ctx.fillStyle = '#ecfff4';
    ctx.fillRect(14 * unit, 14 * unit, 30 * unit, 68 * unit);
    ctx.fillStyle = '#078a47';
    ctx.fillRect(20 * unit, 20 * unit, 18 * unit, 62 * unit);
    // Running figure, heading out through the door.
    ctx.strokeStyle = '#ecfff4';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 7 * unit;
    ctx.beginPath();
    ctx.arc(66 * unit, 22 * unit, 6.5 * unit, 0, Math.PI * 2);
    ctx.fillStyle = '#ecfff4';
    ctx.fill();
    const line = (points: number[][]) => {
      ctx.beginPath();
      points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * unit, y * unit) : ctx.lineTo(x * unit, y * unit)));
      ctx.stroke();
    };
    line([[62, 34], [55, 56]]); // body
    line([[48, 40], [61, 35], [70, 44], [78, 42]]); // arms
    line([[55, 56], [66, 66], [62, 80]]); // front leg
    line([[55, 56], [48, 70], [38, 72]]); // back leg
    ctx.fillStyle = '#ecfff4';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = EXIT_FONT_AR;
    ctx.direction = 'rtl';
    ctx.fillText('مخرج', w * 0.68, h * 0.34);
    ctx.font = EXIT_FONT_EN;
    ctx.direction = 'ltr';
    ctx.fillText('EXIT', w * 0.68, h * 0.72);
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
