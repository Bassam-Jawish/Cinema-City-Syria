/**
 * The 3D cinema hall: one <Canvas> hosting the scene, the camera rig and the film's trailer.
 *
 * It renders whatever showtime is loaded in the booking store. Everything inside reads
 * the store (seat states, view mode, chosen seat) and the per-frame `runtime` / `lightState` /
 * `screenState` modules — there are no props to thread through.
 */
import { PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Trailer } from '@shared/types';
import { useI18n } from '@/i18n';
import { houseLightsOn, useBooking } from '@/store/booking';
import { HallScene } from './hall/HallScene';
import { lightState, resetLightState } from './lightState';
import { PALETTE } from './palette';
import { CameraRig } from './rig/CameraRig';
import { runtime } from './runtime';
import { resetScreenState, screenState } from './screenState';
import { TrailerScreen } from './trailer/TrailerScreen';

/** While watching the trailer, the hall is redrawn at least this often even if nothing changed (ms). */
const WATCHING_REDRAW_MS = 1000 / 24;

/** Where the camera is and what it sees — position, orientation, field of view — and the canvas size. */
function viewOf(camera: THREE.Camera, canvas: HTMLCanvasElement): number[] {
  const { position: p, quaternion: q } = camera;
  const lens = camera as THREE.PerspectiveCamera;
  return [p.x, p.y, p.z, q.x, q.y, q.z, q.w, lens.fov ?? 0, lens.zoom ?? 1, canvas.width, canvas.height];
}

/**
 * Changes smaller than these do not count as moving the view: under a millimetre, under a hundredth
 * of a degree of turn (well below a pixel). The seated view's slow "breathing" stays below them
 * between two video frames, so it simply moves on with the picture. A resized canvas (which the
 * browser clears) always counts.
 */
const VIEW_TOLERANCE = [0.001, 0.001, 0.001, 0.0002, 0.0002, 0.0002, 0.0002, 0.01, 0.0001, 0, 0];

const sameView = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) <= VIEW_TOLERANCE[i]);

/**
 * Draws the hall (taking over from React Three Fiber's own render). While a customer sits watching
 * the trailer without moving the view, a frame is drawn only when the video has a new picture —
 * 24 or 30 times a second rather than at the display's 60–144 Hz — so the GPU keeps the headroom to
 * decode and show the trailer smoothly. Any movement of the view, and the rest of the time, every
 * frame is drawn as usual.
 */
function RenderDirector() {
  const last = useRef({ at: Number.NEGATIVE_INFINITY, picture: -1, view: [] as number[] });
  useFrame(({ gl, scene, camera }) => {
    const now = performance.now();
    const view = viewOf(camera, gl.domElement);
    const video = screenState.videoTexture;
    const watching =
      video !== null && screenState.video > 0.995 && runtime.povBlend > 0.999 && useBooking.getState().view === 'pov';
    const previous = last.current;
    if (watching && video.version === previous.picture && sameView(view, previous.view) && now - previous.at < WATCHING_REDRAW_MS) {
      return;
    }
    gl.render(scene, camera);
    last.current = { at: now, picture: video?.version ?? -1, view };
  }, 1);
  return null;
}

/** Eases the shared house-light dimmer once per frame. */
function LightDirector() {
  useFrame((_, delta) => {
    const { lights, view } = useBooking.getState();
    const dt = Math.min(delta, 0.1);
    if (lights === 'auto') {
      // Follow the camera: the lights go down as you settle into the seat.
      lightState.houseTarget = 1 - THREE.MathUtils.smoothstep(runtime.povBlend, 0.25, 0.95);
    } else {
      lightState.houseTarget = houseLightsOn({ lights, view }) ? 1 : 0;
    }
    lightState.house = THREE.MathUtils.damp(lightState.house, lightState.houseTarget, 3.2, dt);
    if (Math.abs(lightState.house - lightState.houseTarget) < 0.002) lightState.house = lightState.houseTarget;
    // The picture comes up as the room goes dark.
    lightState.screen = 0.35 + 0.65 * (1 - lightState.house);
  });
  return null;
}

export interface HallExperienceProps {
  className?: string;
  /** Called once the first frame has been drawn — hide the loading veil then. */
  onReady?: () => void;
}

export function HallExperience({ className, onReady }: HallExperienceProps) {
  const { t, L } = useI18n();
  const geometry = useBooking((s) => s.geometry);
  const hallName = useBooking((s) => (s.detail ? L(s.detail.hall.name) : ''));
  const hover = useBooking((s) => s.hover);
  const [dpr, setDpr] = useState(() => Math.min(window.devicePixelRatio || 1, 2));
  const trailer = useStableTrailer();

  useEffect(() => {
    resetLightState();
    return () => hover(null);
  }, [hover]);

  useEffect(() => {
    if (geometry) resetScreenState(geometry.screen.width / geometry.screen.height);
  }, [geometry]);

  if (!geometry) return null;

  return (
    <Canvas
      className={className}
      // Screen readers: the 3D view is decorative; the seat map is the accessible way to choose.
      role="img"
      aria-label={`${hallName} — ${t('seats.map.title')}`}
      dpr={dpr}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: false, stencil: false }}
      camera={{ fov: 46, near: 0.06, far: 220, position: [0, geometry.room.ceilingY + 9, geometry.room.backZ + 12] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.15;
        gl.outputColorSpace = THREE.SRGBColorSpace;
        requestAnimationFrame(() => onReady?.());
      }}
      onPointerMissed={() => hover(null)}
      // The rig owns touch gestures; stop the page from scrolling or zooming under the finger.
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={[PALETTE.void]} />
      <fog attach="fog" args={[PALETTE.void, 60, 190]} />
      {/* Lower the resolution on slow GPUs, raise it again when there is headroom. */}
      <PerformanceMonitor
        onDecline={() => setDpr((d) => Math.max(1, d - 0.5))}
        onIncline={() => setDpr((d) => Math.min(Math.min(window.devicePixelRatio || 1, 2), d + 0.25))}
      />
      <LightDirector />
      <RenderDirector />
      <Suspense fallback={null}>
        {/* Keyed by layout so switching halls rebuilds the scene cleanly. */}
        <HallScene key={geometry.seatCount + ':' + geometry.room.width} geometry={geometry} />
      </Suspense>
      <CameraRig geometry={geometry} />
      {/* Keyed by file: a newly uploaded trailer starts afresh. */}
      {trailer && <TrailerScreen key={trailer.url} geometry={geometry} trailer={trailer} />}
    </Canvas>
  );
}

/**
 * The film's trailer, as an object that only changes when the trailer does — the showtime is
 * re-fetched now and then, and a new object each time would restart the video.
 */
function useStableTrailer(): Trailer | null {
  const url = useBooking((s) => s.detail?.movie.trailer?.url ?? null);
  return useMemo(() => (url ? (useBooking.getState().detail?.movie.trailer ?? null) : null), [url]);
}

export default HallExperience;
