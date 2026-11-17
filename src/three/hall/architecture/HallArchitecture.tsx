/**
 * The room: a modern black-box auditorium in the cinema's own colours — near-black, charcoal,
 * crimson and white.
 *
 *   floor    stadium steps in charcoal carpet, aisle runners and LED step lights
 *   walls    graphite acoustic panels cut with the Damascene star lattice (the hall's local touch),
 *            a crimson light line running parallel to the rake, a warm cove light grazing the
 *            panels from above, surround speakers, doors with exit signs, projection ports at the back
 *   ceiling  black, with linear light slots (and the VIP lounge's fibre-optic stars)
 *   front    a black wall and a low plinth under the screen — no curtains, nothing to reflect the picture
 *
 * Walls and ceiling are single-sided surfaces facing INTO the room, so from the overview camera
 * (which floats outside, above and behind the hall) they vanish and the hall reads like a cut-away
 * model, while from a seat everything is solid. Solid fittings (speakers) follow the same rule:
 * a wall's speakers show only while the camera is on the room side of that wall.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, type DependencyList, type RefObject } from 'react';
import * as THREE from 'three';
import { floorHeightAt, type HallGeometry } from '@shared/hall';
import { byHouse, lightState } from '../../lightState';
import { PALETTE } from '../../palette';
import {
  carpetTexture,
  coveWashTexture,
  exitSignTexture,
  glowTexture,
  grilleTexture,
  latticeTexture,
  lineGlowTexture,
} from '../../textures';
import type { HallPartProps } from '../HallScene';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
/** Orientation of a plane on the left wall (x = minX), facing into the room (+x). */
const ON_LEFT_WALL = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2);
/** Orientation of a plane on the right wall (x = maxX), facing into the room (−x). */
const ON_RIGHT_WALL = new THREE.Quaternion().setFromAxisAngle(UP, -Math.PI / 2);
/** Plane facing straight down. Its local y runs along +z. */
const FACING_DOWN = new THREE.Quaternion().setFromAxisAngle(X_AXIS, Math.PI / 2);
/** Plane lying flat, facing up. */
const FACING_UP = new THREE.Quaternion().setFromAxisAngle(X_AXIS, -Math.PI / 2);

const wallQuat = (side: -1 | 1) => (side < 0 ? ON_LEFT_WALL : ON_RIGHT_WALL);

// ── wall layout (metres) ──
/** The acoustic panels start this far from the screen; in front of them the walls stay black. */
const PANELS_FROM = 3.4;
/** …and end this far in front of the back wall (room for the rear doors). */
const PANELS_BEFORE_BACK = 1.8;
const PANEL_WIDTH = 1.8;
const PANEL_GAP = 0.07;
/** Height of the crimson line (and the bottom of the panels) above the rake line. */
const DADO = 1.05;
/** The cove light runs this far below the ceiling; the panels stop a little lower. */
const COVE_DROP = 0.34;
const PANEL_TOP_DROP = 0.58;
/** Panels stand proud of the wall by this much; lights sit just in front of them. */
const PANEL_INSET = 0.04;
/** Surround speakers: centre height above the rake line, size (along the wall × high × deep). */
const SPEAKER_HEIGHT = 2.75;
const SPEAKER_SIZE = [0.32, 0.48, 0.22] as const;
/** Downward tilt of the speakers, towards the audience. */
const SPEAKER_TILT = 0.2;

/** Writes a list of transforms into an InstancedMesh and refreshes its bounds. */
function useInstances(
  ref: RefObject<THREE.InstancedMesh | null>,
  items: ReadonlyArray<{ p: THREE.Vector3Like; q: THREE.Quaternion; s: THREE.Vector3Like; color?: string }>,
): void {
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const color = new THREE.Color();
    items.forEach((item, i) => {
      _m.compose(_p.set(item.p.x, item.p.y, item.p.z), item.q, _s.set(item.s.x, item.s.y, item.s.z));
      mesh.setMatrixAt(i, _m);
      if (item.color) mesh.setColorAt(i, color.set(item.color));
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [ref, items]);
}

function useDisposable<T extends { dispose: () => void }>(factory: () => T, deps: DependencyList): T {
  const value = useMemo(factory, deps);
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

/** Calls `apply` with the house-light level whenever it has changed noticeably. */
function useHouseLevel(apply: (house: number) => void): void {
  const last = useRef(-1);
  useFrame(() => {
    const house = lightState.house;
    if (Math.abs(house - last.current) < 0.002) return;
    last.current = house;
    apply(house);
  });
}

/** Height of the foot of the acoustic panels (and of the crimson line) at depth z. */
const panelFoot = (g: HallGeometry, z: number): number => rakeY(g, z) + DADO;

export function HallArchitecture({ geometry }: HallPartProps) {
  return (
    <group name="architecture">
      <SteppedFloor geometry={geometry} />
      <Aisles geometry={geometry} />
      <Walls geometry={geometry} />
      <SideWall geometry={geometry} side={-1} />
      <SideWall geometry={geometry} side={1} />
      <Doors geometry={geometry} />
      <BoothWindow geometry={geometry} />
      <Ceiling geometry={geometry} />
      <Plinth geometry={geometry} />
    </group>
  );
}

// ───────────────────────────── rake ─────────────────────────────

/**
 * Height of the line through the step nosings at depth z: level in front of the first row,
 * rising with the rows, level again behind the last. Wall lines run parallel to it.
 */
function rakeY(g: HallGeometry, z: number): number {
  const first = g.rows[0];
  const last = g.rows[g.rows.length - 1];
  if (z <= first.zFront || last === first) return first.y;
  if (z >= last.zFront) return last.y;
  return first.y + ((z - first.zFront) / (last.zFront - first.zFront)) * (last.y - first.y);
}

/** Depths from z0 to z1 about every `step` metres, including the two bends of the rake line. */
function depthSamples(g: HallGeometry, z0: number, z1: number, step = 1): number[] {
  const bends = [g.rows[0].zFront, g.rows[g.rows.length - 1].zFront].filter((z) => z > z0 + 1e-3 && z < z1 - 1e-3);
  const count = Math.max(1, Math.ceil((z1 - z0) / step));
  const zs = Array.from({ length: count + 1 }, (_, i) => z0 + ((z1 - z0) * i) / count);
  return [...new Set([...zs, ...bends])].sort((a, b) => a - b);
}

interface StripOptions {
  side: -1 | 1;
  /** Distance in front of the wall. */
  inset: number;
  zs: number[];
  bottom: (z: number) => number;
  top: (z: number) => number;
  /** 'metric': uv in metres (tiling textures). 'unit': v runs 0 → 1 from bottom to top. */
  uv: 'metric' | 'unit';
}

/** A band on a side wall, facing into the room, following arbitrary bottom and top lines. */
function addWallStrip(
  out: { position: number[]; uv: number[]; normal: number[] },
  g: HallGeometry,
  { side, inset, zs, bottom, top, uv }: StripOptions,
): void {
  const x = (side < 0 ? g.room.minX : g.room.maxX) - side * inset;
  for (let i = 0; i < zs.length - 1; i++) {
    const [z0, z1] = [zs[i], zs[i + 1]];
    const corners = [
      [z0, bottom(z0), 0],
      [z1, bottom(z1), 0],
      [z1, top(z1), 1],
      [z0, top(z0), 1],
    ];
    // Wind the triangles so the strip faces into the room on either wall.
    const order = side < 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    for (const k of order) {
      const [z, y, v] = corners[k];
      out.position.push(x, y, z);
      out.normal.push(-side, 0, 0);
      if (uv === 'metric') out.uv.push(side < 0 ? -z : z, y);
      else out.uv.push((z - zs[0]) / Math.max(1e-6, zs[zs.length - 1] - zs[0]), v);
    }
  }
}

function stripGeometry(build: (out: { position: number[]; uv: number[]; normal: number[] }) => void): THREE.BufferGeometry {
  const out = { position: [] as number[], uv: [] as number[], normal: [] as number[] };
  build(out);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(out.normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

// ───────────────────────────── floor ─────────────────────────────

/** The whole stepped floor as one extruded profile: front floor, a platform per row, rear landing. */
function SteppedFloor({ geometry: g }: HallPartProps) {
  const geometry = useDisposable(() => {
    const { frontZ, backZ, width } = g.room;
    // Profile in (z, y), extruded across the width of the room.
    const shape = new THREE.Shape();
    shape.moveTo(frontZ, -0.3);
    shape.lineTo(frontZ, 0);
    let y = 0;
    for (const row of g.rows) {
      if (row.y > y + 1e-6) {
        shape.lineTo(row.zFront, y);
        shape.lineTo(row.zFront, row.y);
        y = row.y;
      }
    }
    shape.lineTo(backZ, y);
    shape.lineTo(backZ, -0.3);
    shape.closePath();
    const extruded = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, steps: 1 });
    // Shape x → world z, extrusion → world x.
    extruded.rotateY(-Math.PI / 2);
    extruded.translate(width / 2, 0, 0);
    return extruded;
  }, [g]);

  const material = useDisposable(() => {
    // UVs of an extrusion are in metres; one carpet tile every 1.2 m.
    const map = carpetTexture().clone();
    map.repeat.set(1 / 1.2, 1 / 1.2);
    map.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ color: PALETTE.carpet, map, roughness: 0.96, metalness: 0 });
  }, []);
  useEffect(() => () => material.map?.dispose(), [material]);

  return <mesh name="floor" geometry={geometry} material={material} />;
}

/** Aisle runners on every platform and an LED strip on every step nosing. */
function Aisles({ geometry: g }: HallPartProps) {
  const runnerRef = useRef<THREE.InstancedMesh>(null);
  const stripRef = useRef<THREE.InstancedMesh>(null);

  const { runners, strips } = useMemo(() => {
    const runners: Array<{ p: THREE.Vector3Like; q: THREE.Quaternion; s: THREE.Vector3Like }> = [];
    const strips: Array<{ p: THREE.Vector3Like; q: THREE.Quaternion; s: THREE.Vector3Like }> = [];
    const identity = new THREE.Quaternion();
    for (const aisle of g.aisles) {
      const w = aisle.width - 0.14;
      for (const row of g.rows) {
        runners.push({
          p: { x: aisle.x, y: row.y + 0.004, z: (row.zFront + row.zBack) / 2 },
          q: FACING_UP,
          s: { x: w, y: row.zBack - row.zFront, z: 1 },
        });
        if (row.index > 0) {
          strips.push({ p: { x: aisle.x, y: row.y + 0.01, z: row.zFront + 0.025 }, q: identity, s: { x: w * 0.86, y: 1, z: 1 } });
        }
      }
    }
    return { runners, strips };
  }, [g]);

  useInstances(runnerRef, runners);
  useInstances(stripRef, strips);

  const plane = useDisposable(() => new THREE.PlaneGeometry(1, 1), []);
  const bar = useDisposable(() => new THREE.BoxGeometry(1, 0.014, 0.03), []);
  const runnerMaterial = useDisposable(
    () =>
      new THREE.MeshStandardMaterial({
        color: PALETTE.carpetDark,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [],
  );
  const stripMaterial = useDisposable(() => new THREE.MeshBasicMaterial({ color: PALETTE.aisleLed, toneMapped: false }), []);
  const stripBase = useMemo(() => new THREE.Color(PALETTE.aisleLed), []);
  // Step lights stay on through the film (safety), just softer.
  useHouseLevel((house) => stripMaterial.color.copy(stripBase).multiplyScalar(0.55 + 0.45 * house));

  return (
    <group name="aisles">
      <instancedMesh ref={runnerRef} args={[plane, runnerMaterial, Math.max(1, runners.length)]} />
      <instancedMesh ref={stripRef} args={[bar, stripMaterial, Math.max(1, strips.length)]} />
    </group>
  );
}

// ───────────────────────────── walls ─────────────────────────────

function Walls({ geometry: g }: HallPartProps) {
  const { minX, maxX, frontZ, backZ, ceilingY, width } = g.room;
  const depth = backZ - frontZ;
  const midZ = (frontZ + backZ) / 2;
  const wall = useDisposable(() => new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.95 }), []);
  const front = useDisposable(() => new THREE.MeshStandardMaterial({ color: PALETTE.screenWall, roughness: 1 }), []);

  return (
    <group name="walls">
      <mesh position={[minX, ceilingY / 2, midZ]} rotation={[0, Math.PI / 2, 0]} material={wall}>
        <planeGeometry args={[depth, ceilingY]} />
      </mesh>
      <mesh position={[maxX, ceilingY / 2, midZ]} rotation={[0, -Math.PI / 2, 0]} material={wall}>
        <planeGeometry args={[depth, ceilingY]} />
      </mesh>
      <mesh position={[0, ceilingY / 2, frontZ]} material={front}>
        <planeGeometry args={[width, ceilingY]} />
      </mesh>
      <mesh position={[0, ceilingY / 2, backZ]} rotation={[0, Math.PI, 0]} material={wall}>
        <planeGeometry args={[width, ceilingY]} />
      </mesh>
    </group>
  );
}

/** One side wall's acoustic panels, light lines and speakers. */
function SideWall({ geometry: g, side }: HallPartProps & { side: -1 | 1 }) {
  const { ceilingY, backZ, frontZ } = g.room;
  const panelTop = ceilingY - PANEL_TOP_DROP;
  const coveY = ceilingY - COVE_DROP;

  const layout = useMemo(() => {
    const start = PANELS_FROM;
    const end = backZ - PANELS_BEFORE_BACK;
    const pitch = PANEL_WIDTH + PANEL_GAP;
    const count = Math.max(1, Math.floor((end - start + PANEL_GAP) / pitch));
    const z0 = start + (end - start - (count * pitch - PANEL_GAP)) / 2;
    const panels: Array<[number, number]> = [];
    for (let i = 0; i < count; i++) panels.push([z0 + i * pitch, z0 + i * pitch + PANEL_WIDTH]);
    return { panels, start: z0, end: z0 + count * pitch - PANEL_GAP };
  }, [backZ]);

  // Graphite fabric panels, alternating very slightly in tone, as one mesh per tone.
  const panelGeometries = useDisposable(() => {
    const even = stripGeometry((out) =>
      layout.panels.forEach(([a, b], i) => {
        if (i % 2 === 0)
          addWallStrip(out, g, { side, inset: PANEL_INSET, zs: depthSamples(g, a, b, 0.6), bottom: (z) => panelFoot(g, z), top: () => panelTop, uv: 'metric' });
      }),
    );
    const odd = stripGeometry((out) =>
      layout.panels.forEach(([a, b], i) => {
        if (i % 2 === 1)
          addWallStrip(out, g, { side, inset: PANEL_INSET, zs: depthSamples(g, a, b, 0.6), bottom: (z) => panelFoot(g, z), top: () => panelTop, uv: 'metric' });
      }),
    );
    return {
      even,
      odd,
      dispose: () => {
        even.dispose();
        odd.dispose();
      },
    };
  }, [g, layout, side, panelTop]);

  // The crimson line along the foot of the panels, with its halo.
  const lineGeometries = useDisposable(() => {
    const zs = depthSamples(g, layout.start, layout.end, 1.5);
    const line = stripGeometry((out) =>
      addWallStrip(out, g, { side, inset: PANEL_INSET + 0.012, zs, bottom: (z) => panelFoot(g, z) - 0.022, top: (z) => panelFoot(g, z) + 0.012, uv: 'unit' }),
    );
    const halo = stripGeometry((out) =>
      addWallStrip(out, g, { side, inset: PANEL_INSET + 0.008, zs, bottom: (z) => panelFoot(g, z) - 0.36, top: (z) => panelFoot(g, z) + 0.32, uv: 'unit' }),
    );
    // The warm cove light along the top of the wall, grazing the panels below it.
    const coveZs = [frontZ + 0.25, backZ - 0.25];
    const cove = stripGeometry((out) =>
      addWallStrip(out, g, { side, inset: 0.05, zs: coveZs, bottom: () => coveY - 0.015, top: () => coveY + 0.015, uv: 'unit' }),
    );
    const wash = stripGeometry((out) =>
      addWallStrip(out, g, { side, inset: PANEL_INSET + 0.004, zs: coveZs, bottom: () => coveY - 2.3, top: () => coveY + 0.05, uv: 'unit' }),
    );
    return { line, halo, cove, wash, dispose: () => [line, halo, cove, wash].forEach((geo) => geo.dispose()) };
  }, [g, layout, side, frontZ, backZ, coveY]);

  // Surround speakers at every other panel joint.
  const speakers = useMemo(() => {
    const wallX = side < 0 ? g.room.minX : g.room.maxX;
    const inward = -side;
    const tilt = new THREE.Quaternion().setFromAxisAngle(X_AXIS, SPEAKER_TILT);
    const q = wallQuat(side).clone().multiply(tilt);
    const items: Array<{ p: THREE.Vector3Like; q: THREE.Quaternion; s: THREE.Vector3Like }> = [];
    layout.panels.forEach(([, b], i) => {
      if (i % 2 === 1 || i === layout.panels.length - 1) return;
      const z = b + PANEL_GAP / 2;
      const y = Math.min(rakeY(g, z) + SPEAKER_HEIGHT, panelTop - SPEAKER_SIZE[1] / 2 - 0.08);
      items.push({ p: { x: wallX + inward * (PANEL_INSET + SPEAKER_SIZE[2] / 2 + 0.02), y, z }, q, s: { x: 1, y: 1, z: 1 } });
    });
    return items;
  }, [g, layout, side, panelTop]);
  const grilles = useMemo(
    () =>
      speakers.map((item) => {
        const offset = new THREE.Vector3(0, 0, SPEAKER_SIZE[2] / 2 + 0.002).applyQuaternion(item.q);
        return { p: { x: item.p.x + offset.x, y: item.p.y + offset.y, z: item.p.z + offset.z }, q: item.q, s: { x: SPEAKER_SIZE[0] - 0.03, y: SPEAKER_SIZE[1] - 0.03, z: 1 } };
      }),
    [speakers],
  );
  const speakerRef = useRef<THREE.InstancedMesh>(null);
  const grilleRef = useRef<THREE.InstancedMesh>(null);
  useInstances(speakerRef, speakers);
  useInstances(grilleRef, grilles);

  const materials = useMemo(() => {
    const lattice = latticeTexture().clone();
    lattice.repeat.set(1 / 0.9, 1 / 0.9);
    lattice.needsUpdate = true;
    const grille = grilleTexture().clone();
    grille.repeat.set(5, 7);
    grille.needsUpdate = true;
    return {
      panel: new THREE.MeshStandardMaterial({ color: PALETTE.wallPanel, map: lattice, roughness: 0.94 }),
      panelAlt: new THREE.MeshStandardMaterial({ color: PALETTE.wallPanelAlt, map: lattice, roughness: 0.94 }),
      line: new THREE.MeshBasicMaterial({ color: PALETTE.brandLine, toneMapped: false }),
      halo: new THREE.MeshBasicMaterial({
        map: lineGlowTexture(),
        color: PALETTE.brandLine,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      cove: new THREE.MeshBasicMaterial({ color: PALETTE.coveLight, toneMapped: false }),
      wash: new THREE.MeshBasicMaterial({
        map: coveWashTexture(),
        color: PALETTE.coveLight,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      speaker: new THREE.MeshStandardMaterial({ color: PALETTE.speaker, roughness: 0.7, metalness: 0.1 }),
      grille: new THREE.MeshStandardMaterial({ color: PALETTE.speakerGrille, map: grille, roughness: 0.6, metalness: 0.4 }),
    };
  }, []);
  useEffect(
    () => () => {
      for (const material of Object.values(materials)) material.dispose();
      materials.panel.map?.dispose();
      materials.grille.map?.dispose();
    },
    [materials],
  );

  const lineBase = useMemo(() => new THREE.Color(PALETTE.brandLine), []);
  const coveBase = useMemo(() => new THREE.Color(PALETTE.coveLight), []);
  useHouseLevel(() => {
    // The accent line stays faintly on during the film; the cove goes almost dark.
    materials.line.color.copy(lineBase).multiplyScalar(byHouse(0.42, 1.25));
    materials.halo.opacity = byHouse(0.16, 0.55);
    materials.cove.color.copy(coveBase).multiplyScalar(byHouse(0.08, 1.3));
    materials.wash.opacity = byHouse(0.015, 0.26);
  });

  // Speakers are solid: show them only from the room side of this wall (see the note at the top).
  const fittings = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    if (!fittings.current) return;
    fittings.current.visible = side < 0 ? camera.position.x > g.room.minX : camera.position.x < g.room.maxX;
  });

  const speakerBox = useDisposable(() => new THREE.BoxGeometry(...SPEAKER_SIZE), []);
  const plane = useDisposable(() => new THREE.PlaneGeometry(1, 1), []);

  return (
    <group name={side < 0 ? 'left-wall' : 'right-wall'}>
      <mesh geometry={panelGeometries.even} material={materials.panel} />
      <mesh geometry={panelGeometries.odd} material={materials.panelAlt} />
      <mesh geometry={lineGeometries.line} material={materials.line} />
      <mesh geometry={lineGeometries.halo} material={materials.halo} renderOrder={2} />
      <mesh geometry={lineGeometries.cove} material={materials.cove} />
      <mesh geometry={lineGeometries.wash} material={materials.wash} renderOrder={2} />
      <group ref={fittings}>
        <instancedMesh ref={speakerRef} args={[speakerBox, materials.speaker, Math.max(1, speakers.length)]} />
        <instancedMesh ref={grilleRef} args={[plane, materials.grille, Math.max(1, grilles.length)]} />
      </group>
    </group>
  );
}

interface Placed {
  p: THREE.Vector3Like;
  q: THREE.Quaternion;
  s: THREE.Vector3Like;
}

/** A door near the screen and one at the back on each side, each with an illuminated exit sign. */
function Doors({ geometry: g }: HallPartProps) {
  const layout = useMemo(() => {
    const doors: Placed[] = [];
    const frames: Placed[] = [];
    const signs: Placed[] = [];
    for (const side of [-1, 1] as const) {
      const wallX = side < 0 ? g.room.minX : g.room.maxX;
      const inward = -side;
      const q = wallQuat(side);
      for (const z of [Math.min(2.3, PANELS_FROM - 1.1), g.room.backZ - 1.0]) {
        const floor = floorHeightAt(g, z);
        frames.push({ p: { x: wallX + inward * 0.02, y: floor + 1.15, z }, q, s: { x: 1.34, y: 2.3, z: 1 } });
        doors.push({ p: { x: wallX + inward * 0.03, y: floor + 1.1, z }, q, s: { x: 1.2, y: 2.2, z: 1 } });
        signs.push({ p: { x: wallX + inward * 0.05, y: floor + 2.6, z }, q, s: { x: 0.56, y: 0.21, z: 1 } });
      }
    }
    return { doors, frames, signs };
  }, [g]);

  const doorRef = useRef<THREE.InstancedMesh>(null);
  const frameRef = useRef<THREE.InstancedMesh>(null);
  const signRef = useRef<THREE.InstancedMesh>(null);
  useInstances(doorRef, layout.doors);
  useInstances(frameRef, layout.frames);
  useInstances(signRef, layout.signs);

  const plane = useDisposable(() => new THREE.PlaneGeometry(1, 1), []);
  const materials = useMemo(
    () => ({
      door: new THREE.MeshStandardMaterial({ color: PALETTE.door, roughness: 0.88, metalness: 0 }),
      frame: new THREE.MeshStandardMaterial({ color: PALETTE.doorFrame, roughness: 0.5, metalness: 0.4 }),
      sign: new THREE.MeshBasicMaterial({ map: exitSignTexture(), toneMapped: false }),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const material of Object.values(materials)) material.dispose();
    },
    [materials],
  );

  return (
    <group name="doors">
      <instancedMesh ref={frameRef} args={[plane, materials.frame, layout.frames.length]} />
      <instancedMesh ref={doorRef} args={[plane, materials.door, layout.doors.length]} />
      <instancedMesh ref={signRef} args={[plane, materials.sign, layout.signs.length]} />
    </group>
  );
}

/** The projection ports high in the back wall — the source of the beam. */
function BoothWindow({ geometry: g }: HallPartProps) {
  const glass = useRef<THREE.MeshBasicMaterial>(null);
  const halo = useRef<THREE.MeshBasicMaterial>(null);
  const base = useMemo(() => new THREE.Color(PALETTE.projector), []);
  const y = g.room.ceilingY - 0.95;
  const z = g.room.backZ - 0.02;
  useFrame(() => {
    const level = 0.25 + 0.95 * (1 - lightState.house);
    glass.current?.color.copy(base).multiplyScalar(level);
    if (halo.current) halo.current.opacity = 0.08 + 0.42 * (1 - lightState.house);
  });
  return (
    <group position={[0, y, z]} rotation={[0, Math.PI, 0]}>
      <mesh position={[0, 0, -0.005]}>
        <planeGeometry args={[2.6, 0.95]} />
        <meshStandardMaterial color="#0b0b0c" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0, 0.004]}>
        <planeGeometry args={[0.95, 0.5]} />
        <meshBasicMaterial ref={glass} color={PALETTE.projector} toneMapped={false} />
      </mesh>
      {[-0.85, 0.85].map((x) => (
        <mesh key={x} position={[x, 0, 0.004]}>
          <planeGeometry args={[0.42, 0.3]} />
          <meshBasicMaterial color="#23262d" toneMapped={false} />
        </mesh>
      ))}
      <mesh position={[0, 0, 0.01]}>
        <planeGeometry args={[2.4, 1.6]} />
        <meshBasicMaterial
          ref={halo}
          map={glowTexture()}
          color={PALETTE.projector}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// ───────────────────────────── ceiling ─────────────────────────────

/** A black ceiling with linear light slots across the hall. */
function Ceiling({ geometry: g }: HallPartProps) {
  const { width, frontZ, backZ, ceilingY } = g.room;
  const depth = backZ - frontZ;
  const vip = g.layout.seatStyle === 'recliner';

  const { slots, halos } = useMemo(() => {
    const length = width * 0.72;
    const slots: Placed[] = [];
    const halos: Placed[] = [];
    for (let z = 2.4; z < backZ - 0.8; z += 3.0) {
      slots.push({ p: { x: 0, y: ceilingY - 0.012, z }, q: FACING_DOWN, s: { x: length, y: 0.07, z: 1 } });
      halos.push({ p: { x: 0, y: ceilingY - 0.02, z }, q: FACING_DOWN, s: { x: length * 1.04, y: 0.9, z: 1 } });
    }
    return { slots, halos };
  }, [width, backZ, ceilingY]);

  const slotRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);
  useInstances(slotRef, slots);
  useInstances(haloRef, halos);

  const plane = useDisposable(() => new THREE.PlaneGeometry(1, 1), []);
  const ceilingMaterial = useDisposable(() => new THREE.MeshStandardMaterial({ color: PALETTE.ceiling, roughness: 1 }), []);
  const slot = useDisposable(() => new THREE.MeshBasicMaterial({ color: PALETTE.warmLight, toneMapped: false }), []);
  const halo = useDisposable(
    () =>
      new THREE.MeshBasicMaterial({
        map: lineGlowTexture(),
        color: PALETTE.warmLight,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );

  const slotBase = useMemo(() => new THREE.Color(PALETTE.warmLight), []);
  useHouseLevel((house) => {
    slot.color.copy(slotBase).multiplyScalar(0.03 + 1.45 * house);
    halo.opacity = 0.42 * house;
  });

  return (
    <group name="ceiling">
      <mesh position={[0, ceilingY, (frontZ + backZ) / 2]} rotation={[Math.PI / 2, 0, 0]} material={ceilingMaterial}>
        <planeGeometry args={[width, depth]} />
      </mesh>
      <instancedMesh ref={slotRef} args={[plane, slot, Math.max(1, slots.length)]} />
      <instancedMesh ref={haloRef} args={[plane, halo, Math.max(1, halos.length)]} renderOrder={2} />
      {vip && <StarCeiling geometry={g} />}
    </group>
  );
}

/** Fibre-optic star field — the VIP lounge's signature ceiling. */
function StarCeiling({ geometry: g }: HallPartProps) {
  const material = useRef<THREE.PointsMaterial>(null);
  const positions = useMemo(() => {
    const { minX, maxX, frontZ, backZ, ceilingY } = g.room;
    const count = 340;
    const array = new Float32Array(count * 3);
    let seed = 1337;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < count; i++) {
      array[i * 3] = minX + 0.4 + rand() * (maxX - minX - 0.8);
      array[i * 3 + 1] = ceilingY - 0.03;
      array[i * 3 + 2] = frontZ + 1.5 + rand() * (backZ - frontZ - 2);
    }
    return array;
  }, [g]);
  useFrame(({ clock }) => {
    if (!material.current) return;
    const twinkle = 0.85 + 0.15 * Math.sin(clock.elapsedTime * 1.7);
    material.current.opacity = (0.35 + 0.65 * (1 - lightState.house)) * twinkle;
  });
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={material}
        map={glowTexture()}
        color="#fff1d0"
        size={0.07}
        sizeAttenuation
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

// ───────────────────────────── front ─────────────────────────────

/** A low black plinth under the screen, wall to wall, with a crimson light line along its edge. */
function Plinth({ geometry: g }: HallPartProps) {
  const { room, screen } = g;
  const front = 1.0;
  const depth = front - room.frontZ;
  const height = Math.min(0.38, screen.bottom - 0.4);
  const width = room.width - 0.02;
  const edge = useRef<THREE.MeshBasicMaterial>(null);
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  const base = useMemo(() => new THREE.Color(PALETTE.brandLine), []);
  useFrame(() => {
    edge.current?.color.copy(base).multiplyScalar(byHouse(0.22, 1.1));
    if (glow.current) glow.current.opacity = byHouse(0.06, 0.4);
  });
  return (
    <group name="plinth">
      <mesh position={[0, height / 2, room.frontZ + depth / 2]}>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={PALETTE.stage} roughness={0.85} />
      </mesh>
      <mesh position={[0, height - 0.03, front + 0.003]}>
        <planeGeometry args={[width, 0.024]} />
        <meshBasicMaterial ref={edge} color={PALETTE.brandLine} toneMapped={false} />
      </mesh>
      <mesh position={[0, height - 0.03, front + 0.006]}>
        <planeGeometry args={[width, 0.5]} />
        <meshBasicMaterial
          ref={glow}
          map={lineGlowTexture()}
          color={PALETTE.brandLine}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
