/**
 * The cinema screen. It shows the booked film's still, cropped to the screen's aspect,
 * with a slow drift and a faint flicker so it reads as a moving picture. It glows dimly
 * like a pre-show slide while the house lights are up and comes to full brightness when
 * they go down. A haze-filled projector beam appears as the room darkens.
 */
import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useBooking } from '@/store/booking';
import { lightState } from '../../lightState';
import { PALETTE } from '../../palette';
import { glowTexture } from '../../textures';
import type { HallPartProps } from '../HallScene';

/** Aspect ratio of the film stills (backdrops are 1920×1080). */
const STILL_ASPECT = 16 / 9;

export function CinemaScreen({ geometry: g }: HallPartProps) {
  const backdrop = useBooking((s) => s.detail?.movie.backdrop ?? null);
  const accent = useBooking((s) => s.detail?.movie.accent ?? '#ffffff');
  const { screen } = g;
  const y = screen.center[1];

  return (
    <group name="screen">
      {/* Black masking around the picture. */}
      <mesh position={[0, y, -0.03]}>
        <planeGeometry args={[screen.width + 1.0, screen.height + 0.8]} />
        <meshBasicMaterial color={PALETTE.screenFrame} />
      </mesh>
      <ScreenHalo width={screen.width} height={screen.height} y={y} accent={accent} />
      {/* A missing or broken still must never take the hall down: fall back to a blank screen. */}
      <ErrorBoundary
        resetKey={backdrop}
        fallback={<BlankPicture width={screen.width} height={screen.height} y={y} />}
      >
        <Suspense fallback={<BlankPicture width={screen.width} height={screen.height} y={y} />}>
          {backdrop ? (
            <Picture url={backdrop} width={screen.width} height={screen.height} y={y} />
          ) : (
            <BlankPicture width={screen.width} height={screen.height} y={y} />
          )}
        </Suspense>
      </ErrorBoundary>
      <ProjectorBeam geometry={g} accent={accent} />
    </group>
  );
}

interface PictureProps {
  width: number;
  height: number;
  y: number;
}

function Picture({ url, width, height, y }: PictureProps & { url: string }) {
  const source = useTexture(url);
  // Our own copy: we animate repeat/offset, and the cached original may be used elsewhere.
  const texture = useMemo(() => {
    const t = source.clone();
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  }, [source]);
  useEffect(() => () => texture.dispose(), [texture]);

  const material = useRef<THREE.MeshBasicMaterial>(null);
  const screenAspect = width / height;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // Cover-crop the still to the screen, then drift slowly through it (a gentle Ken Burns move).
    let rx = 1;
    let ry = STILL_ASPECT / screenAspect;
    if (ry > 1) {
      rx = 1 / ry;
      ry = 1;
    }
    const zoom = 1.05 + 0.04 * Math.sin(t * 0.045);
    rx /= zoom;
    ry /= zoom;
    texture.repeat.set(rx, ry);
    texture.offset.set(
      (1 - rx) * (0.5 + 0.38 * Math.sin(t * 0.06)),
      (1 - ry) * (0.5 + 0.3 * Math.cos(t * 0.052)),
    );
    const flicker = 1 + Math.sin(t * 21.7) * 0.005 + Math.sin(t * 6.3) * 0.007;
    material.current?.color.setScalar(lightState.screen * flicker);
  });

  return (
    <mesh position={[0, y, 0]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial ref={material} map={texture} toneMapped={false} />
    </mesh>
  );
}

/** Shown until the still has loaded (or when there is no film). */
function BlankPicture({ width, height, y }: PictureProps) {
  const material = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => material.current?.color.set(PALETTE.screenIdle).multiplyScalar(0.6 + 0.8 * lightState.screen));
  return (
    <mesh position={[0, y, 0]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial ref={material} color={PALETTE.screenIdle} toneMapped={false} />
    </mesh>
  );
}

/** Light spilling past the edges of the screen onto the masking, tinted by the film. */
function ScreenHalo({ width, height, y, accent }: PictureProps & { accent: string }) {
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const color = useMemo(() => new THREE.Color(accent).lerp(new THREE.Color('#ffffff'), 0.35), [accent]);
  useFrame(() => {
    if (material.current) material.current.opacity = 0.05 + 0.3 * (lightState.screen - 0.35) / 0.65;
  });
  return (
    <mesh position={[0, y, -0.02]}>
      <planeGeometry args={[width * 1.35, height * 1.9]} />
      <meshBasicMaterial
        ref={material}
        map={glowTexture()}
        color={color}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

const beamVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vPos;
  void main() {
    vUv = uv;
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vPos;
  void main() {
    // Brightest at the lens, thinning out towards the screen.
    float along = vUv.y;
    float fade = pow(1.0 - along, 1.35) * 0.88 + 0.12;
    // Softer edges across each face of the beam.
    float edge = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x);
    // Slowly drifting haze.
    float haze = 0.72 + 0.28 * sin(vPos.x * 1.9 + uTime * 0.33) * sin(vPos.y * 2.6 - uTime * 0.27) * sin(vPos.z * 0.8 + uTime * 0.21);
    float a = uOpacity * fade * mix(0.5, 1.0, edge) * haze;
    gl_FragColor = vec4(uColor, a);
  }
`;

/** The light cone from the projection booth to the screen, visible in the darkened hall. */
function ProjectorBeam({ geometry: g, accent }: HallPartProps & { accent: string }) {
  const geometry = useMemo(() => {
    const lensY = g.room.ceilingY - 0.95;
    const lensZ = g.room.backZ - 0.12;
    const w = g.screen.width / 2;
    const screenCorners = [
      [-w, g.screen.bottom],
      [w, g.screen.bottom],
      [w, g.screen.top],
      [-w, g.screen.top],
    ].map(([x, y]) => new THREE.Vector3(x, y, 0.04));
    const lensCorners = [
      [-0.2, -0.12],
      [0.2, -0.12],
      [0.2, 0.12],
      [-0.2, 0.12],
    ].map(([x, y]) => new THREE.Vector3(x, lensY + y, lensZ));

    const positions: number[] = [];
    const uvs: number[] = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const [a0, a1, s0, s1] = [lensCorners[i], lensCorners[j], screenCorners[i], screenCorners[j]];
      positions.push(...a0.toArray(), ...s0.toArray(), ...s1.toArray(), ...a0.toArray(), ...s1.toArray(), ...a1.toArray());
      uvs.push(0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeBoundingSphere();
    return geo;
  }, [g]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: beamVertex,
        fragmentShader: beamFragment,
        uniforms: {
          uColor: { value: new THREE.Color() },
          uOpacity: { value: 0 },
          uTime: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    (material.uniforms.uColor.value as THREE.Color).set(accent).lerp(new THREE.Color(PALETTE.projector), 0.6);
  }, [accent, material]);

  const mesh = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const dark = 1 - lightState.house;
    material.uniforms.uOpacity.value = 0.13 * dark * dark;
    material.uniforms.uTime.value = clock.elapsedTime;
    if (mesh.current) mesh.current.visible = dark > 0.02;
  });

  return <mesh ref={mesh} geometry={geometry} material={material} renderOrder={3} />;
}
