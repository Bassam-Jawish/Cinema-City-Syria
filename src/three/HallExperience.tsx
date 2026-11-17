/**
 * The 3D cinema hall: one <Canvas> hosting the scene and the camera rig, over a layer that the
 * film's trailer is projected into (see TrailerProjection).
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
import { resetScreenState } from './screenState';
import { TrailerProjection } from './trailer/TrailerProjection';

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
  const movieTitle = useBooking((s) => (s.detail ? L(s.detail.movie.title) : ''));
  const hover = useBooking((s) => s.hover);
  const [dpr, setDpr] = useState(() => Math.min(window.devicePixelRatio || 1, 2));
  const trailer = useStableTrailer();
  const projection = useRef<HTMLDivElement>(null);

  useEffect(() => {
    resetLightState();
    return () => hover(null);
  }, [hover]);

  useEffect(() => {
    if (geometry) resetScreenState(geometry.screen.width / geometry.screen.height);
  }, [geometry]);

  if (!geometry) return null;

  return (
    <div className={className}>
      {/*
        The trailer's player is projected here, behind the canvas, and shows through the screen.
        Always left-to-right: CSS 3D placement is measured from the left edge, also in Arabic.
      */}
      <div
        ref={projection}
        dir="ltr"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden bg-black"
        style={{ visibility: 'hidden' }}
      />
      <Canvas
        // Screen readers: the 3D view is decorative; the seat map is the accessible way to choose.
        role="img"
        aria-label={`${hallName} — ${t('seats.map.title')}`}
        dpr={dpr}
        // alpha: the screen lets the projected trailer show through; everywhere else stays opaque.
        gl={{ antialias: true, powerPreference: 'high-performance', alpha: true, stencil: false }}
        camera={{ fov: 46, near: 0.06, far: 220, position: [0, geometry.room.ceilingY + 9, geometry.room.backZ + 12] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.15;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          requestAnimationFrame(() => onReady?.());
        }}
        onPointerMissed={() => hover(null)}
        // The rig owns touch gestures; stop the page from scrolling or zooming under the finger.
        style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
      >
        <color attach="background" args={[PALETTE.void]} />
        <fog attach="fog" args={[PALETTE.void, 60, 190]} />
        {/* Lower the resolution on slow GPUs, raise it again when there is headroom. */}
        <PerformanceMonitor
          onDecline={() => setDpr((d) => Math.max(1, d - 0.5))}
          onIncline={() => setDpr((d) => Math.min(Math.min(window.devicePixelRatio || 1, 2), d + 0.25))}
        />
        <LightDirector />
        <Suspense fallback={null}>
          {/* Keyed by layout so switching halls rebuilds the scene cleanly. */}
          <HallScene key={geometry.seatCount + ':' + geometry.room.width} geometry={geometry} />
        </Suspense>
        <CameraRig geometry={geometry} />
        {trailer && (
          <TrailerProjection
            key={`${trailer.youtubeId}:${trailer.start}`}
            geometry={geometry}
            trailer={trailer}
            title={movieTitle}
            layer={projection}
          />
        )}
      </Canvas>
    </div>
  );
}

/**
 * The film's trailer, as an object that only changes when the trailer does — the showtime is
 * re-fetched now and then, and a new object each time would restart the player.
 */
function useStableTrailer(): Trailer | null {
  const key = useBooking((s) => {
    const trailer = s.detail?.movie.trailer;
    return trailer ? `${trailer.youtubeId}|${trailer.start}|${trailer.aspect}` : null;
  });
  return useMemo(() => (key ? (useBooking.getState().detail?.movie.trailer ?? null) : null), [key]);
}

export default HallExperience;
