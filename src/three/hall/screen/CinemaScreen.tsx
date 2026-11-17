/**
 * The cinema screen, modelled the way a real one behaves:
 *
 *   - It is a white surface. With the house lights up it reflects them, so blacks turn grey and
 *     the pre-show picture looks washed out; in the dark the picture comes up to full contrast.
 *   - The projector lights it unevenly: brightest in the middle, a little dimmer in the corners.
 *   - Black velour masking frames the picture. The side masking glides in to frame a narrower
 *     picture (a 16:9 trailer on this 2.39:1 scope screen) and back out for the film's still.
 *   - Light spills onto the masking and the front of the room; in the dark a projector beam
 *     crosses the hall, brightening and dimming with the picture.
 *
 * Until someone sits down the screen shows the film's still with a slow drift. Once the trailer
 * plays (see TrailerScreen) the surface cross-fades into the video's frames.
 */
import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, type DependencyList } from 'react';
import * as THREE from 'three';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useBooking } from '@/store/booking';
import { byHouse, lightState } from '../../lightState';
import { PALETTE } from '../../palette';
import { pictureRect, screenState } from '../../screenState';
import { glowTexture } from '../../textures';
import type { HallPartProps } from '../HallScene';

/** Aspect ratio of the film stills (backdrops are 1920×1080). */
const STILL_ASPECT = 16 / 9;
/** Masking overlaps the picture edge slightly, as real masking does, so the edge is always crisp. */
const MASK_OVERLAP = 0.03;
/** Fixed black velour border around the screen. */
const BORDER_SIDE = 0.5;
const BORDER_TOP = 0.3;
const MASK_DEPTH = 0.06;
/** Centre of the masking, in front of the screen surface (z = 0). */
const MASK_Z = 0.045;

function useDisposable<T extends { dispose: () => void }>(factory: () => T, deps: DependencyList): T {
  const value = useMemo(factory, deps);
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

const screenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Everything here is in display (sRGB) space: the still and the video are sampled raw, the output is not converted.
const screenFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform vec2 uRepeat;
  uniform vec2 uOffset;
  uniform sampler2D uVideoMap;
  uniform float uHasVideo;
  uniform float uBrightness;
  uniform float uAmbient;
  uniform float uVideo;
  uniform vec4 uVideoRect;
  varying vec2 vUv;

  // 1 inside the rectangle (min.xy, max.zw), with a one-pixel soft edge.
  float inRect(vec2 p, vec4 r) {
    vec2 aa = fwidth(p);
    vec2 lo = smoothstep(r.xy - aa, r.xy + aa, p);
    vec2 hi = 1.0 - smoothstep(r.zw - aa, r.zw + aa, p);
    return lo.x * lo.y * hi.x * hi.y;
  }

  void main() {
    // Projector falloff: full brightness in the middle, about 15% less in the corners.
    vec2 c = (vUv - 0.5) * 2.0;
    float falloff = 1.0 - 0.15 * smoothstep(0.1, 2.0, dot(c, c));
    float light = clamp(uBrightness, 0.0, 1.0) * falloff;

    vec3 still = uHasMap > 0.5 ? texture2D(uMap, vUv * uRepeat + uOffset).rgb : vec3(0.0);
    // The video fills its own picture area; outside it (behind the masking) the projector is dark.
    vec2 videoUv = (vUv - uVideoRect.xy) / (uVideoRect.zw - uVideoRect.xy);
    vec3 video = uHasVideo > 0.5 ? texture2D(uVideoMap, clamp(videoUv, 0.0, 1.0)).rgb * inRect(vUv, uVideoRect) : vec3(0.0);
    vec3 picture = mix(still, video, uVideo);

    // The white screen reflects the room: g is how grey "black" looks. Projected light adds on top.
    float g = uAmbient;
    gl_FragColor = vec4(vec3(g) + (1.0 - g) * light * picture, 1.0);
  }
`;

function createScreenMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: screenVertex,
    fragmentShader: screenFragment,
    uniforms: {
      uMap: { value: null },
      uHasMap: { value: 0 },
      uRepeat: { value: new THREE.Vector2(1, 1) },
      uOffset: { value: new THREE.Vector2(0, 0) },
      uVideoMap: { value: null },
      uHasVideo: { value: 0 },
      uBrightness: { value: 0.35 },
      uAmbient: { value: 0.1 },
      uVideo: { value: 0 },
      uVideoRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    },
    toneMapped: false,
  });
}

export function CinemaScreen({ geometry: g }: HallPartProps) {
  const backdrop = useBooking((s) => s.detail?.movie.backdrop ?? null);
  const accent = useBooking((s) => s.detail?.movie.accent ?? '#ffffff');
  const { screen } = g;
  const y = screen.center[1];
  const material = useDisposable(createScreenMaterial, []);
  const screenAspect = screen.width / screen.height;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const u = material.uniforms;
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
    (u.uRepeat.value as THREE.Vector2).set(rx, ry);
    (u.uOffset.value as THREE.Vector2).set(
      (1 - rx) * (0.5 + 0.38 * Math.sin(t * 0.06)),
      (1 - ry) * (0.5 + 0.3 * Math.cos(t * 0.052)),
    );
    // A projector lamp is never perfectly steady.
    const flicker = 1 + Math.sin(t * 21.7) * 0.005 + Math.sin(t * 6.3) * 0.007;
    // lightState.screen runs 0.35 (pre-show slide, lights up) → 1 (feature, lights down).
    u.uBrightness.value = (0.12 + 0.88 * lightState.screen) * flicker;
    u.uAmbient.value = byHouse(0.006, 0.07);
    u.uVideo.value = screenState.video;
    u.uVideoMap.value = screenState.videoTexture;
    u.uHasVideo.value = screenState.videoTexture ? 1 : 0;
    const picture = pictureRect(screen, screenState.videoAspect);
    const hx = picture.width / screen.width / 2;
    const hy = picture.height / screen.height / 2;
    (u.uVideoRect.value as THREE.Vector4).set(0.5 - hx, 0.5 - hy, 0.5 + hx, 0.5 + hy);
  });

  return (
    <group name="screen">
      {/* The black front wall behind and around the screen. */}
      <mesh position={[0, y, -0.03]}>
        <planeGeometry args={[screen.width + 2 * BORDER_SIDE + 0.6, screen.height + 2 * BORDER_TOP + 0.5]} />
        <meshBasicMaterial color={PALETTE.screenFrame} />
      </mesh>
      <ScreenHalo geometry={g} accent={accent} />
      <mesh name="screen-surface" position={[0, y, 0]} material={material}>
        <planeGeometry args={[screen.width, screen.height]} />
      </mesh>
      {/* A missing or broken still must never take the hall down: the screen just stays unlit. */}
      <ErrorBoundary resetKey={backdrop} fallback={null}>
        <Suspense fallback={null}>{backdrop && <Still url={backdrop} material={material} />}</Suspense>
      </ErrorBoundary>
      <Masking geometry={g} />
      <ProjectorBeam geometry={g} accent={accent} />
    </group>
  );
}

/** Loads the film's still and hands it to the screen surface. */
function Still({ url, material }: { url: string; material: THREE.ShaderMaterial }) {
  const source = useTexture(url);
  // Our own copy, sampled as raw sRGB: the screen shader works in display space.
  const texture = useMemo(() => {
    const t = source.clone();
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 8;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  }, [source]);
  useEffect(() => {
    material.uniforms.uMap.value = texture;
    material.uniforms.uHasMap.value = 1;
    return () => {
      if (material.uniforms.uMap.value === texture) {
        material.uniforms.uMap.value = null;
        material.uniforms.uHasMap.value = 0;
      }
      texture.dispose();
    };
  }, [material, texture]);
  return null;
}

/** Black velour masking: fixed top and bottom borders, and side masking that frames the picture. */
function Masking({ geometry: g }: HallPartProps) {
  const { screen } = g;
  const left = useRef<THREE.Mesh>(null);
  const right = useRef<THREE.Mesh>(null);
  const box = useDisposable(() => new THREE.BoxGeometry(1, 1, 1), []);
  const velour = useDisposable(
    () => new THREE.MeshStandardMaterial({ color: PALETTE.masking, roughness: 1, metalness: 0 }),
    [],
  );
  const height = screen.height + 2 * BORDER_TOP;
  const last = useRef(-1);

  useFrame(() => {
    if (Math.abs(screenState.aspect - last.current) < 1e-5 || !left.current || !right.current) return;
    last.current = screenState.aspect;
    const picture = pictureRect(screen, screenState.aspect);
    const inner = picture.width / 2 - MASK_OVERLAP;
    const outer = screen.width / 2 + BORDER_SIDE;
    const width = outer - inner;
    left.current.scale.set(width, height, MASK_DEPTH);
    left.current.position.set(-(inner + width / 2), screen.center[1], MASK_Z);
    right.current.scale.set(width, height, MASK_DEPTH);
    right.current.position.set(inner + width / 2, screen.center[1], MASK_Z);
  });

  const span = screen.width + 2 * BORDER_SIDE;
  return (
    <group name="masking">
      <mesh ref={left} geometry={box} material={velour} />
      <mesh ref={right} geometry={box} material={velour} />
      <mesh
        geometry={box}
        material={velour}
        position={[0, screen.top + (BORDER_TOP - MASK_OVERLAP) / 2, MASK_Z]}
        scale={[span, BORDER_TOP + MASK_OVERLAP, MASK_DEPTH]}
      />
      <mesh
        geometry={box}
        material={velour}
        position={[0, screen.bottom - (BORDER_TOP - MASK_OVERLAP) / 2, MASK_Z]}
        scale={[span, BORDER_TOP + MASK_OVERLAP, MASK_DEPTH]}
      />
    </group>
  );
}

/** Light spilling past the edges of the picture onto the masking and the wall, tinted by the film. */
function ScreenHalo({ geometry: g, accent }: HallPartProps & { accent: string }) {
  const { screen } = g;
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const color = useMemo(() => new THREE.Color(accent).lerp(new THREE.Color('#ffffff'), 0.35), [accent]);
  useFrame(() => {
    const picture = pictureRect(screen, screenState.aspect);
    mesh.current?.scale.set(picture.width * 1.4, screen.height * 1.9, 1);
    if (material.current) material.current.opacity = (0.04 + (0.26 * (lightState.screen - 0.35)) / 0.65) * screenState.light;
  });
  return (
    <mesh ref={mesh} position={[0, screen.center[1], -0.02]}>
      <planeGeometry args={[1, 1]} />
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

/** The light cone from the projection booth to the picture, visible in the darkened hall. */
function ProjectorBeam({ geometry: g, accent }: HallPartProps & { accent: string }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(4 * 6 * 3), 3));
    const uvs: number[] = [];
    for (let i = 0; i < 4; i++) uvs.push(0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    return geo;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  /** Rebuilds the four faces of the beam for a picture of the given shape. */
  const shapeBeam = useMemo(() => {
    const lensY = g.room.ceilingY - 0.95;
    const lensZ = g.room.backZ - 0.12;
    const lens = [
      [-0.2, -0.12],
      [0.2, -0.12],
      [0.2, 0.12],
      [-0.2, 0.12],
    ].map(([x, y]) => new THREE.Vector3(x, lensY + y, lensZ));
    return (aspect: number) => {
      const picture = pictureRect(g.screen, aspect);
      const w = picture.width / 2;
      const h = picture.height / 2;
      const cy = g.screen.center[1];
      const ends = [
        [-w, cy - h],
        [w, cy - h],
        [w, cy + h],
        [-w, cy + h],
      ].map(([x, y]) => new THREE.Vector3(x, y, 0.04));
      const out = geometry.attributes.position.array as Float32Array;
      let k = 0;
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        for (const v of [lens[i], ends[i], ends[j], lens[i], ends[j], lens[j]]) {
          out[k++] = v.x;
          out[k++] = v.y;
          out[k++] = v.z;
        }
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.computeBoundingSphere();
    };
  }, [g, geometry]);

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
  const shapedFor = useRef(-1);
  useFrame(({ clock }) => {
    const dark = 1 - lightState.house;
    material.uniforms.uOpacity.value = 0.11 * dark * dark * screenState.light;
    material.uniforms.uTime.value = clock.elapsedTime;
    if (mesh.current) mesh.current.visible = dark > 0.02;
    if (Math.abs(screenState.aspect - shapedFor.current) > 1e-3) {
      shapedFor.current = screenState.aspect;
      shapeBeam(screenState.aspect);
    }
  });

  return <mesh ref={mesh} geometry={geometry} material={material} renderOrder={3} />;
}
