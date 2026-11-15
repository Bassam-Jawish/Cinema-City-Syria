/**
 * The room itself: stepped floor, aisles with step lights, walls with lattice panels and
 * sconces, doors with exit signs, the ceiling with downlights, and the stage with its curtains.
 *
 * Walls and ceiling are single-sided planes facing INTO the room, so from the overview camera
 * (which floats outside, above and behind the hall) they vanish and the hall reads like a
 * cut-away model, while from a seat everything is solid.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, type DependencyList, type RefObject } from 'react';
import * as THREE from 'three';
import { floorHeightAt, type HallGeometry } from '@shared/hall';
import { byHouse, lightState } from '../../lightState';
import { PALETTE } from '../../palette';
import { carpetTexture, exitSignTexture, glowTexture, latticeTexture, washTexture } from '../../textures';
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
/** Plane facing straight down. */
const FACING_DOWN = new THREE.Quaternion().setFromAxisAngle(X_AXIS, Math.PI / 2);
/** Plane lying flat, facing up. */
const FACING_UP = new THREE.Quaternion().setFromAxisAngle(X_AXIS, -Math.PI / 2);

const wallQuat = (side: -1 | 1) => (side < 0 ? ON_LEFT_WALL : ON_RIGHT_WALL);

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

export function HallArchitecture({ geometry }: HallPartProps) {
  return (
    <group name="architecture">
      <SteppedFloor geometry={geometry} />
      <Aisles geometry={geometry} />
      <Walls geometry={geometry} />
      <WallDecor geometry={geometry} />
      <Ceiling geometry={geometry} />
      <Proscenium geometry={geometry} />
    </group>
  );
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
    // UVs of an extrusion are in metres; tile the carpet motif every 0.9 m.
    const map = carpetTexture().clone();
    map.repeat.set(1 / 0.9, 1 / 0.9);
    map.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ color: PALETTE.carpet, map, roughness: 0.97, metalness: 0 });
  }, []);

  return <mesh name="floor" geometry={geometry} material={material} />;
}

/** Aisle runners on every platform and an amber LED strip on every step nosing. */
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
          strips.push({ p: { x: aisle.x, y: row.y + 0.01, z: row.zFront + 0.025 }, q: identity, s: { x: w * 0.82, y: 1, z: 1 } });
        }
      }
    }
    return { runners, strips };
  }, [g]);

  useInstances(runnerRef, runners);
  useInstances(stripRef, strips);

  const plane = useDisposable(() => new THREE.PlaneGeometry(1, 1), []);
  const bar = useDisposable(() => new THREE.BoxGeometry(1, 0.016, 0.03), []);
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

  return (
    <group name="aisles">
      <instancedMesh ref={runnerRef} args={[plane, runnerMaterial, Math.max(1, runners.length)]} />
      <instancedMesh ref={stripRef} args={[bar, stripMaterial, Math.max(1, strips.length)]} />
    </group>
  );
}

// ───────────────────────────── walls & ceiling ─────────────────────────────

function Walls({ geometry: g }: HallPartProps) {
  const { minX, maxX, frontZ, backZ, ceilingY, width } = g.room;
  const depth = backZ - frontZ;
  const midZ = (frontZ + backZ) / 2;
  const wall = useDisposable(() => new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.95 }), []);
  const front = useDisposable(() => new THREE.MeshStandardMaterial({ color: '#0a0506', roughness: 1 }), []);

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

interface Placed {
  p: THREE.Vector3Like;
  q: THREE.Quaternion;
  s: THREE.Vector3Like;
  color?: string;
}

/** Acoustic panels, gold trims, sconces with their wall wash, doors, exit signs and the booth window. */
function WallDecor({ geometry: g }: HallPartProps) {
  const layout = useMemo(() => {
    const { minX, maxX, backZ, ceilingY } = g.room;
    const panels: Placed[] = [];
    const trims: Placed[] = [];
    const sconces: Placed[] = [];
    const washes: Placed[] = [];
    const doors: Placed[] = [];
    const frames: Placed[] = [];
    const signs: Placed[] = [];

    const start = 3.4;
    const end = backZ - 1.8;
    const pitch = 2.7;
    const panelWidth = 2.3;
    const count = Math.max(1, Math.floor((end - start) / pitch));
    const z0 = start + (end - start - count * pitch) / 2;
    const top = ceilingY - 0.75;

    for (const side of [-1, 1] as const) {
      const wallX = side < 0 ? minX : maxX;
      const inward = -side; // +x for the left wall, −x for the right wall
      const q = wallQuat(side);

      for (let i = 0; i < count; i++) {
        const zc = z0 + pitch * (i + 0.5);
        const bottom = floorHeightAt(g, zc + panelWidth / 2) + 1.15;
        if (top - bottom < 0.6) continue;
        panels.push({
          p: { x: wallX + inward * 0.03, y: (top + bottom) / 2, z: zc },
          q,
          s: { x: panelWidth, y: top - bottom, z: 1 },
          color: i % 2 === 0 ? PALETTE.wallPanel : PALETTE.wallPanelAlt,
        });
      }
      for (let i = 0; i <= count; i++) {
        const z = z0 + pitch * i;
        const floor = floorHeightAt(g, z);
        const bottom = floor + 1.0;
        trims.push({
          p: { x: wallX + inward * 0.04, y: (top + bottom) / 2, z },
          q,
          s: { x: 0.06, y: top - bottom, z: 1 },
        });
        const sconceY = Math.min(floor + 2.4, top - 1.2);
        sconces.push({ p: { x: wallX + inward * 0.07, y: sconceY, z }, q, s: { x: 1, y: 1, z: 1 } });
        // Light thrown up the wall, and a smaller pool below the fitting.
        washes.push({ p: { x: wallX + inward * 0.05, y: sconceY + 1.05, z }, q, s: { x: 1.2, y: 2.2, z: 1 } });
        const down = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
        washes.push({ p: { x: wallX + inward * 0.05, y: sconceY - 0.45, z }, q: down, s: { x: 0.8, y: 0.9, z: 1 } });
      }

      // A door near the screen and one at the back, each with an exit sign.
      const frontDoorZ = Math.min(2.3, z0 - 0.9);
      const rearDoorZ = backZ - 1.0;
      for (const z of [frontDoorZ, rearDoorZ]) {
        const floor = floorHeightAt(g, z);
        frames.push({ p: { x: wallX + inward * 0.02, y: floor + 1.16, z }, q, s: { x: 1.36, y: 2.32, z: 1 } });
        doors.push({ p: { x: wallX + inward * 0.03, y: floor + 1.1, z }, q, s: { x: 1.2, y: 2.2, z: 1 } });
        signs.push({ p: { x: wallX + inward * 0.05, y: floor + 2.62, z }, q, s: { x: 0.52, y: 0.195, z: 1 } });
      }
    }
    return { panels, trims, sconces, washes, doors, frames, signs };
  }, [g]);

  const panelRef = useRef<THREE.InstancedMesh>(null);
  const trimRef = useRef<THREE.InstancedMesh>(null);
  const sconceRef = useRef<THREE.InstancedMesh>(null);
  const washRef = useRef<THREE.InstancedMesh>(null);
  const doorRef = useRef<THREE.InstancedMesh>(null);
  const frameRef = useRef<THREE.InstancedMesh>(null);
  const signRef = useRef<THREE.InstancedMesh>(null);
  useInstances(panelRef, layout.panels);
  useInstances(trimRef, layout.trims);
  useInstances(sconceRef, layout.sconces);
  useInstances(washRef, layout.washes);
  useInstances(doorRef, layout.doors);
  useInstances(frameRef, layout.frames);
  useInstances(signRef, layout.signs);

  const plane = useDisposable(() => new THREE.PlaneGeometry(1, 1), []);
  // A half-cylinder uplighter: the curved side bulges towards local +z, which the wall
  // orientation turns into the room.
  const sconceShape = useDisposable(
    () => new THREE.CylinderGeometry(0.11, 0.07, 0.26, 16, 1, false, -Math.PI / 2, Math.PI),
    [],
  );

  const materials = useMemo(() => {
    const lattice = latticeTexture().clone();
    lattice.repeat.set(2.4, 4.2);
    lattice.needsUpdate = true;
    return {
      panel: new THREE.MeshStandardMaterial({ map: lattice, roughness: 0.92 }),
      trim: new THREE.MeshStandardMaterial({ color: PALETTE.wallTrim, roughness: 0.4, metalness: 0.35 }),
      sconce: new THREE.MeshBasicMaterial({ color: PALETTE.sconce, toneMapped: false }),
      wash: new THREE.MeshBasicMaterial({
        map: washTexture(),
        color: PALETTE.sconce,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      door: new THREE.MeshStandardMaterial({ color: '#140a0c', roughness: 0.7 }),
      frame: new THREE.MeshStandardMaterial({ color: '#2b1a1d', roughness: 0.6 }),
      sign: new THREE.MeshBasicMaterial({ map: exitSignTexture(), toneMapped: false }),
    };
  }, []);
  useEffect(
    () => () => {
      for (const material of Object.values(materials)) material.dispose();
      materials.panel.map?.dispose();
    },
    [materials],
  );

  const sconceBase = useMemo(() => new THREE.Color(PALETTE.sconce), []);
  const lastHouse = useRef(-1);
  useFrame(() => {
    const house = lightState.house;
    if (Math.abs(house - lastHouse.current) < 0.002) return;
    lastHouse.current = house;
    // Sconces dim but never go fully dark, like a real auditorium during the film.
    materials.sconce.color.copy(sconceBase).multiplyScalar(byHouse(0.22, 1.35));
    materials.wash.opacity = byHouse(0.05, 0.5);
  });

  return (
    <group name="wall-decor">
      <instancedMesh ref={panelRef} args={[plane, materials.panel, Math.max(1, layout.panels.length)]} />
      <instancedMesh ref={trimRef} args={[plane, materials.trim, Math.max(1, layout.trims.length)]} />
      <instancedMesh ref={sconceRef} args={[sconceShape, materials.sconce, Math.max(1, layout.sconces.length)]} />
      <instancedMesh
        ref={washRef}
        args={[plane, materials.wash, Math.max(1, layout.washes.length)]}
        renderOrder={2}
        frustumCulled={false}
      />
      <instancedMesh ref={frameRef} args={[plane, materials.frame, layout.frames.length]} />
      <instancedMesh ref={doorRef} args={[plane, materials.door, layout.doors.length]} />
      <instancedMesh ref={signRef} args={[plane, materials.sign, layout.signs.length]} />
      <BoothWindow geometry={g} />
    </group>
  );
}

/** The projection booth's windows high on the back wall — the source of the beam. */
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
        <meshStandardMaterial color="#0b0708" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0, 0.004]}>
        <planeGeometry args={[0.95, 0.5]} />
        <meshBasicMaterial ref={glass} color={PALETTE.projector} toneMapped={false} />
      </mesh>
      {[-0.85, 0.85].map((x) => (
        <mesh key={x} position={[x, 0, 0.004]}>
          <planeGeometry args={[0.42, 0.3]} />
          <meshBasicMaterial color="#2a2f3a" toneMapped={false} />
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

function Ceiling({ geometry: g }: HallPartProps) {
  const { width, frontZ, backZ, ceilingY } = g.room;
  const depth = backZ - frontZ;
  const vip = g.layout.seatStyle === 'recliner';

  const downlights = useMemo(() => {
    const list: Placed[] = [];
    const xs = width > 14 ? [-width * 0.34, -width * 0.12, width * 0.12, width * 0.34] : [-width * 0.3, 0, width * 0.3];
    for (let z = 2.6; z < backZ - 0.8; z += 3.1) {
      for (const x of xs) list.push({ p: { x, y: ceilingY - 0.012, z }, q: FACING_DOWN, s: { x: 1, y: 1, z: 1 } });
    }
    return list;
  }, [width, backZ, ceilingY]);
  const halos = useMemo(
    () => downlights.map((d) => ({ ...d, p: { ...d.p, y: ceilingY - 0.02 }, s: { x: 1.3, y: 1.3, z: 1 } })),
    [downlights, ceilingY],
  );

  const lampRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);
  useInstances(lampRef, downlights);
  useInstances(haloRef, halos);

  const disc = useDisposable(() => new THREE.CircleGeometry(0.13, 20), []);
  const plane = useDisposable(() => new THREE.PlaneGeometry(1, 1), []);
  const ceilingMaterial = useDisposable(() => new THREE.MeshStandardMaterial({ color: PALETTE.ceiling, roughness: 1 }), []);
  const lamp = useDisposable(() => new THREE.MeshBasicMaterial({ color: PALETTE.warmLight, toneMapped: false }), []);
  const halo = useDisposable(
    () =>
      new THREE.MeshBasicMaterial({
        map: glowTexture(),
        color: PALETTE.warmLight,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );

  const lampBase = useMemo(() => new THREE.Color(PALETTE.warmLight), []);
  const lastHouse = useRef(-1);
  useFrame(() => {
    const house = lightState.house;
    if (Math.abs(house - lastHouse.current) < 0.002) return;
    lastHouse.current = house;
    lamp.color.copy(lampBase).multiplyScalar(byHouse(0.04, 1.6));
    halo.opacity = byHouse(0.0, 0.45);
  });

  return (
    <group name="ceiling">
      <mesh position={[0, ceilingY, (frontZ + backZ) / 2]} rotation={[Math.PI / 2, 0, 0]} material={ceilingMaterial}>
        <planeGeometry args={[width, depth]} />
      </mesh>
      <instancedMesh ref={lampRef} args={[disc, lamp, Math.max(1, downlights.length)]} />
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

// ───────────────────────────── stage & curtains ─────────────────────────────

/** A curtain: a plane rippled into soft vertical folds. */
function curtainGeometry(width: number, height: number, foldWidth: number, depth: number): THREE.BufferGeometry {
  const folds = Math.max(2, Math.round(width / foldWidth));
  const geometry = new THREE.PlaneGeometry(width, height, folds * 10, 1);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const u = position.getX(i) / width + 0.5;
    position.setZ(i, Math.sin(u * folds * Math.PI * 2) * depth);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function Proscenium({ geometry: g }: HallPartProps) {
  const { screen, room } = g;
  const half = screen.width / 2;
  const stageHalf = Math.min(half + 1.0, room.width / 2 - 0.3);
  const stageFront = 1.25;
  const stageDepth = stageFront - room.frontZ;
  const stageHeight = Math.min(0.45, screen.bottom - 0.3);
  const innerEdge = half + 0.35;
  const sideWidth = room.maxX - innerEdge;
  const valanceHeight = room.ceilingY - (screen.top + 0.16);

  const side = useDisposable(() => curtainGeometry(sideWidth, room.ceilingY, 0.42, 0.09), [sideWidth, room.ceilingY]);
  const valance = useDisposable(
    () => curtainGeometry(room.width, Math.max(0.2, valanceHeight), 0.3, 0.05),
    [room.width, valanceHeight],
  );
  const velvet = useDisposable(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: PALETTE.curtain,
        roughness: 0.74,
        sheen: 1,
        sheenRoughness: 0.38,
        sheenColor: new THREE.Color('#ff6b7d'),
      }),
    [],
  );
  const edgeMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const edgeBase = useMemo(() => new THREE.Color(PALETTE.aisleLed), []);
  useFrame(() => {
    edgeMaterial.current?.color.copy(edgeBase).multiplyScalar(byHouse(0.55, 0.9));
  });

  return (
    <group name="proscenium">
      <mesh position={[0, stageHeight / 2, room.frontZ + stageDepth / 2]}>
        <boxGeometry args={[stageHalf * 2, stageHeight, stageDepth]} />
        <meshStandardMaterial color={PALETTE.stage} roughness={0.8} />
      </mesh>
      <mesh position={[0, stageHeight + 0.006, stageFront - 0.012]}>
        <boxGeometry args={[stageHalf * 2, 0.012, 0.024]} />
        <meshBasicMaterial ref={edgeMaterial} color={PALETTE.aisleLed} toneMapped={false} />
      </mesh>
      <mesh geometry={side} material={velvet} position={[-(innerEdge + sideWidth / 2), room.ceilingY / 2, 0.34]} />
      <mesh geometry={side} material={velvet} position={[innerEdge + sideWidth / 2, room.ceilingY / 2, 0.34]} />
      {valanceHeight > 0.2 && (
        <mesh geometry={valance} material={velvet} position={[0, room.ceilingY - valanceHeight / 2, 0.42]} />
      )}
    </group>
  );
}
