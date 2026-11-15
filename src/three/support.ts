/** Capability checks for the 3D experience. */

let webglCache: boolean | null = null;

/** True if this browser can create a WebGL2 (or WebGL1) context. Cached after the first call. */
export function isWebGLAvailable(): boolean {
  if (webglCache !== null) return webglCache;
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ?? canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
    webglCache = Boolean(gl);
  } catch {
    webglCache = false;
  }
  return webglCache;
}

/** The user asked the OS to minimise animation: camera moves should cut or cross-fade instead of fly. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Coarse pointer = touch-first device: look around by dragging instead of hovering. */
export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
}
