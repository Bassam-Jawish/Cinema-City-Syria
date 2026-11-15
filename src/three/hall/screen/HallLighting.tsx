/**
 * Light sources. Kept deliberately few (every light costs on every material):
 *   - a warm hemisphere + two directional "house" lights that dim with the house-light cue;
 *   - one rectangular area light the size of the screen, tinted by the film, which lights the
 *     front of the room, the curtains and the audience more strongly as the room goes dark.
 * Sconces, downlights and step lights are emissive surfaces (see HallArchitecture).
 */
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { useBooking } from '@/store/booking';
import { byHouse, lightState } from '../../lightState';
import { PALETTE } from '../../palette';
import type { HallPartProps } from '../HallScene';

// Area lights need their lookup tables registered before any material compiles.
RectAreaLightUniformsLib.init();

export function HallLighting({ geometry: g }: HallPartProps) {
  const hemi = useRef<THREE.HemisphereLight>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  const fill = useRef<THREE.DirectionalLight>(null);
  const screenLight = useRef<THREE.RectAreaLight>(null);

  const accent = useBooking((s) => s.detail?.movie.accent ?? '#ffffff');
  const screenColor = useMemo(() => new THREE.Color(accent).lerp(new THREE.Color('#fff2e2'), 0.55), [accent]);

  useLayoutEffect(() => {
    // Aim the area light from the screen towards the middle of the audience.
    screenLight.current?.lookAt(0, g.seating.center[1] + 0.8, g.seating.center[2] + 4);
  }, [g, screenColor]);

  useFrame(() => {
    if (hemi.current) hemi.current.intensity = byHouse(0.08, 2.1);
    if (key.current) key.current.intensity = byHouse(0, 2.6);
    if (fill.current) fill.current.intensity = byHouse(0, 0.9);
    if (screenLight.current) screenLight.current.intensity = 0.8 + 4.6 * lightState.screen * (1.1 - lightState.house * 0.6);
  });

  const { room, screen } = g;
  return (
    <>
      <hemisphereLight ref={hemi} args={['#ffe0bd', '#2a0b10', 1.25]} />
      <ambientLight intensity={0.04} color="#ffd8b0" />
      <directionalLight
        ref={key}
        color={PALETTE.warmLight}
        intensity={1.7}
        position={[room.maxX * 0.7, room.ceilingY + 7, room.backZ * 0.85]}
      />
      <directionalLight
        ref={fill}
        color="#ffcf9e"
        intensity={0.65}
        position={[room.minX * 0.8, room.ceilingY + 4, room.backZ * 0.2]}
      />
      <rectAreaLight
        key={screenColor.getHexString()}
        ref={screenLight}
        args={[screenColor, 4, screen.width, screen.height]}
        position={[0, screen.center[1], 0.15]}
      />
    </>
  );
}
