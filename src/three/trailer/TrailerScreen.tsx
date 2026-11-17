/**
 * Plays the film's trailer on the cinema screen when a customer sits down.
 *
 * The video loads when the customer heads for a seat (during the camera's fly-in) and starts once
 * they are seated: the picture cross-fades in from the still as the house lights go down, the
 * masking closes in to frame its shape, and the sound rises with it. Standing up fades it out and
 * pauses it; sitting down again (in any seat) carries on where it stopped. Interruptions — the
 * system pausing it, a hidden tab, a network drop — are recovered from (see TrailerVideo), and a
 * trailer staff replace meanwhile takes over (the hall is keyed by the trailer's URL).
 *
 * This component only directs: the frames reach the screen through `screenState.videoTexture`
 * (see CinemaScreen), and the light the picture throws through `screenState.light` / `tint`.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { HallGeometry } from '@shared/hall';
import type { Trailer } from '@shared/types';
import { useBooking } from '@/store/booking';
import { attachTrailerControls, useTrailer } from '@/store/trailer';
import { runtime } from '../runtime';
import { lightForLuma, resetScreenState, screenState } from '../screenState';
import { PictureMeter } from './PictureMeter';
import { TrailerVideo } from './TrailerVideo';

export interface TrailerScreenProps {
  geometry: HallGeometry;
  trailer: Trailer;
}

/** Seated "enough" to roll the trailer: the camera is nearly in the seat and the lights are going down. */
const SEATED_BLEND = 0.6;
const NEUTRAL = { r: 1, g: 1, b: 1 };
/** Least time between two checks with the server that the trailer is still the current one (ms). */
const RECHECK_EVERY_MS = 10_000;
let checkedAt = Number.NEGATIVE_INFINITY;

/** A trailer that fails to load may have been replaced or removed: the showtime says which is current. */
function recheckTrailer(): void {
  const now = performance.now();
  if (now - checkedAt < RECHECK_EVERY_MS) return;
  checkedAt = now;
  void useBooking.getState().refresh();
}

export function TrailerScreen({ geometry: g, trailer }: TrailerScreenProps) {
  const player = useRef<TrailerVideo | null>(null);
  const meter = useRef<PictureMeter | null>(null);
  const renderer = useThree((state) => state.gl);
  const screenAspect = g.screen.width / g.screen.height;

  // Measures the picture's colour for the room light, while the GPU can afford it (see PictureMeter).
  useEffect(() => {
    const created = new PictureMeter(renderer);
    meter.current = created;
    return () => {
      created.dispose();
      meter.current = null;
    };
  }, [renderer]);

  // One video per trailer file; torn down with the hall.
  useEffect(() => {
    useTrailer.setState({ status: 'idle', soundBlocked: false });
    return () => {
      attachTrailerControls(null);
      player.current?.destroy();
      player.current = null;
      resetScreenState(g.screen.width / g.screen.height);
      useTrailer.setState({ status: 'none', soundBlocked: false });
    };
  }, [trailer, g]);

  const load = (): TrailerVideo => {
    const created = new TrailerVideo({
      url: trailer.url,
      muted: useTrailer.getState().muted,
      onStatus: (status) => useTrailer.setState({ status }),
      onSoundBlocked: (soundBlocked) => useTrailer.setState({ soundBlocked }),
      onFailure: recheckTrailer,
    });
    attachTrailerControls({ setMuted: (muted) => created.setMuted(muted) });
    useTrailer.setState({ status: 'loading' });
    return created;
  };

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const headingToSeat = useBooking.getState().view === 'pov';
    const seated = headingToSeat && runtime.povBlend > SEATED_BLEND;
    if (headingToSeat && !player.current) player.current = load();

    const video = player.current;
    const showing = seated && video?.status === 'playing';
    if (video) {
      if (seated) video.play();
      else if (screenState.video < 0.02) video.pause();
      // Sound comes up with the picture as you settle into the seat, and fades away as you stand.
      // (Not tied to the house lights: turning them back on must not silence the trailer.)
      video.setVolume(THREE.MathUtils.smoothstep(runtime.povBlend, SEATED_BLEND, 1) * screenState.video);
      if (showing && meter.current) {
        meter.current.update(video.texture, performance.now());
        const sample = meter.current.take();
        if (sample) {
          // Ease towards each measurement, so cuts read as a change of light rather than a flicker.
          screenState.tint = sample.tint;
          screenState.light = THREE.MathUtils.lerp(screenState.light, lightForLuma(sample.luma), 0.6);
        } else if (meter.current.stopped) {
          // This device cannot afford to measure the picture: the room keeps a steady, neutral light.
          screenState.tint = NEUTRAL;
          screenState.light = THREE.MathUtils.damp(screenState.light, 1, 3, dt);
        }
      }
    }

    // The picture cross-fades from the still to the video, and the masking closes in to frame it.
    screenState.video = THREE.MathUtils.damp(screenState.video, showing ? 1 : 0, showing ? 2.2 : 5, dt);
    if (screenState.video < 0.002 && !showing) screenState.video = 0;
    screenState.videoTexture = video && video.status !== 'error' ? video.texture : null;
    screenState.videoAspect = video?.aspect ?? 16 / 9;
    screenState.aspectTarget = showing ? screenState.videoAspect : screenAspect;
    screenState.aspect = THREE.MathUtils.damp(screenState.aspect, screenState.aspectTarget, 2.4, dt);
    if (!showing) screenState.light = THREE.MathUtils.damp(screenState.light, 1, 3, dt);
  });

  return null;
}
