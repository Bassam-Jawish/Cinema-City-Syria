/**
 * Projects the film's trailer onto the cinema screen.
 *
 * A YouTube video cannot be drawn into WebGL — the player is a cross-origin iframe — so it is
 * placed BEHIND the (transparent) canvas instead, with a CSS 3D transform computed from the very
 * same camera (three's CSS3DRenderer), so it lines up with the screen pixel for pixel. The screen
 * surface then lets the video show through (see CinemaScreen's shader), while everything in front
 * of it stays opaque WebGL — the heads in the rows ahead, the masking — and hides the picture just
 * as it would in a real hall.
 *
 * Lifecycle: the player loads when the customer first heads for a seat (during the camera's
 * fly-in), the trailer starts once they are seated — picture and sound rising as the house
 * lights go down — and it fades out and pauses when they stand up. It resumes where it left off.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import type { HallGeometry } from '@shared/hall';
import type { Trailer } from '@shared/types';
import { translate, useLangStore } from '@/i18n';
import { useBooking } from '@/store/booking';
import { attachTrailerControls, useTrailer } from '@/store/trailer';
import { runtime } from '../runtime';
import { pictureLevel, pictureRect, resetScreenState, screenState, videoFrameRect } from '../screenState';
import { PLAYER_WIDTH, TrailerPlayer } from './youtube';

export interface TrailerProjectionProps {
  geometry: HallGeometry;
  trailer: Trailer;
  /** Title of the film, for the player frame's accessible name. */
  title: string;
  /** The element behind the canvas that hosts the projected player. */
  layer: RefObject<HTMLDivElement | null>;
}

/** Seated "enough" to roll the trailer: the camera is nearly in the seat and the lights are going down. */
const SEATED_BLEND = 0.6;
/** After YouTube could not be reached, try again on a later sit-down, but not sooner than this. */
const RETRY_AFTER_MS = 20_000;

export function TrailerProjection({ geometry: g, trailer, title, layer }: TrailerProjectionProps) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const css = useMemo(() => ({ scene: new THREE.Scene(), renderer: null as CSS3DRenderer | null }), []);
  const player = useRef<TrailerPlayer | null>(null);
  const object = useRef<CSS3DObject | null>(null);
  const failedAt = useRef(0);
  /** A sit-down asked for the player and it has not been created yet. */
  const startRequested = useRef(false);
  const wasHeadingToSeat = useRef(false);

  // The CSS 3D renderer draws into the layer behind the canvas.
  useEffect(() => {
    const element = layer.current;
    if (!element) return;
    const renderer = new CSS3DRenderer({ element });
    css.renderer = renderer;
    return () => {
      css.renderer = null;
      element.replaceChildren();
      element.style.visibility = 'hidden';
    };
  }, [css, layer]);

  useEffect(() => {
    css.renderer?.setSize(size.width, size.height);
  }, [css, size.width, size.height]);

  // One player per trailer; torn down with the hall.
  useEffect(() => {
    useTrailer.setState({ status: 'idle', soundBlocked: false });
    return () => {
      attachTrailerControls(null);
      player.current?.destroy();
      player.current = null;
      if (object.current) css.scene.remove(object.current);
      object.current = null;
      resetScreenState(g.screen.width / g.screen.height);
      useTrailer.setState({ status: 'none', soundBlocked: false });
    };
  }, [css, trailer, g]);

  /** Creates the player if there is none. Returns false only if it should be asked again next frame. */
  const ensurePlayer = (): boolean => {
    if (player.current) return true;
    if (!css.renderer) return false;
    // YouTube was unreachable a moment ago: wait for a later sit-down rather than hammering it.
    if (failedAt.current && performance.now() - failedAt.current < RETRY_AFTER_MS) return true;
    const lang = useLangStore.getState().lang;
    const created = new TrailerPlayer({
      trailer,
      title: translate(lang, 'seats.trailer.frameTitle', { title }),
      lang,
      muted: useTrailer.getState().muted,
      onStatus: (status) => {
        useTrailer.setState({ status });
        if (status === 'unavailable') {
          // Drop it, so a later sit-down can try again (the connection may come back).
          failedAt.current = performance.now();
          queueMicrotask(() => {
            if (player.current !== created) return;
            attachTrailerControls(null);
            created.destroy();
            player.current = null;
            if (object.current) css.scene.remove(object.current);
            object.current = null;
          });
        }
      },
      onSoundBlocked: (soundBlocked) => useTrailer.setState({ soundBlocked }),
    });
    const placed = new CSS3DObject(created.element);
    // Anchor at the top-left of the layer whatever the page direction; the transform does the rest.
    Object.assign(placed.element.style, { pointerEvents: 'none', left: '0px', top: '0px' });
    css.scene.add(placed);
    object.current = placed;
    player.current = created;
    attachTrailerControls({ setMuted: (muted) => created.setMuted(muted) });
    useTrailer.setState({ status: 'loading' });
    // Attach the frame to the page before the player loads into it.
    place();
    css.renderer.render(css.scene, camera);
    created.load();
    return true;
  };

  const screenAspect = g.screen.width / g.screen.height;
  /** Puts the player's frame where the trailer's picture belongs on the screen. */
  const place = () => {
    const placed = object.current;
    if (!placed) return;
    const picture = pictureRect(g.screen, trailer.aspect);
    const frame = videoFrameRect(picture, trailer.aspect);
    placed.position.set(g.screen.center[0], g.screen.center[1], g.screen.center[2]);
    placed.scale.setScalar(frame.width / PLAYER_WIDTH);
  };

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const store = useBooking.getState();
    const headingToSeat = store.view === 'pov';
    const seated = headingToSeat && runtime.povBlend > SEATED_BLEND;
    // Load the player when someone heads for a seat (once per sit-down, so an unreachable YouTube is not retried every frame).
    if (headingToSeat && !wasHeadingToSeat.current) startRequested.current = true;
    wasHeadingToSeat.current = headingToSeat;
    if (startRequested.current && headingToSeat && ensurePlayer()) startRequested.current = false;

    const current = player.current;
    const showing = seated && current?.status === 'playing';
    if (current) {
      if (seated) current.play();
      else if (screenState.video < 0.02) current.pause();
      // Sound comes up with the picture as you settle into the seat, and fades away as you stand.
      // (Not tied to the house lights: turning them back on must not silence the trailer.)
      current.setVolume(100 * THREE.MathUtils.smoothstep(runtime.povBlend, SEATED_BLEND, 1) * screenState.video);
    }

    // The picture cross-fades from the still to the video, and the masking closes in to frame it.
    screenState.video = THREE.MathUtils.damp(screenState.video, showing ? 1 : 0, showing ? 2.2 : 5, dt);
    if (screenState.video < 0.002 && !showing) screenState.video = 0;
    screenState.videoAspect = trailer.aspect;
    screenState.aspectTarget = showing ? trailer.aspect : screenAspect;
    screenState.aspect = THREE.MathUtils.damp(screenState.aspect, screenState.aspectTarget, 2.4, dt);
    screenState.level = showing ? pictureLevel(state.clock.elapsedTime) : 0.6;

    // Keep the projected player glued to the screen while it can be seen.
    const element = layer.current;
    if (!element || !css.renderer) return;
    if (screenState.video > 0 && object.current) {
      if (element.style.visibility !== 'visible') element.style.visibility = 'visible';
      place();
      css.renderer.render(css.scene, camera);
    } else if (element.style.visibility !== 'hidden') {
      element.style.visibility = 'hidden';
    }
  });

  return null;
}
