/**
 * Light sources. Kept deliberately few (every light costs on every material):
 *   - a warm hemisphere + two directional "house" lights that dim with the house-light cue;
 *   - one rectangular area light the size of the picture, tinted by the film, which lights the
 *     front of the room and the audience more strongly as the room goes dark. While the trailer
 *     plays its brightness follows the picture's cuts (screenState.level), so the room flickers
 *     with the film the way a real auditorium does.
 * Sconces, downlights and step lights are emissive surfaces (see HallArchitecture).
 */
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { useBooking } from '@/store/booking';
import { byHouse, lightState } from '../../lightState';
import { PALETTE } from '../../palette';
import { pictureRect, screenState } from '../../screenState';
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
    if (hemi.current) hemi.current.intensity = byHouse(0.08, 2.35);
    if (key.current) key.current.intensity = byHouse(0, 2.6);
    if (fill.current) fill.current.intensity = byHouse(0, 0.9);
    const light = screenLight.current;
    if (light) {
      // A film is never one steady brightness: follow its cuts while the trailer plays.
      const picture = 1 + screenState.video * (screenState.level - 0.6) * 1.1;
      light.intensity = (0.8 + 4.6 * lightState.screen * (1.1 - lightState.house * 0.6)) * picture;
      light.width = pictureRect(g.screen, screenState.aspect).width;
    }
  });

  const { room, screen } = g;
  return (
    <>
      <hemisphereLight ref={hemi} args={['#fff0dc', '#1c181b', 1.25]} />
      <ambientLight intensity={0.05} color="#ffe6cc" />
      <directionalLight
        ref={key}
        color={PALETTE.warmLight}
        intensity={1.7}
        position={[room.maxX * 0.7, room.ceilingY + 7, room.backZ * 0.85]}
      />
      <directionalLight
        ref={fill}
        color="#ffe1bd"
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
