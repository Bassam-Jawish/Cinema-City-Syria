/**
 * The seats — modern leather stadium seats — drawn as a handful of instanced meshes (one draw
 * call per part, whatever the hall size):
 *   fabric  — cushion + high backrest, coloured per seat by its state (instance colours, eased)
 *   accent  — the sculpted headrest: gold on premium and VIP seats, the seat's own colour otherwise
 *   arms    — wide armrests with cup holders on solid side panels, shared between neighbours
 *   hit     — invisible, slightly oversized pick volumes so seats are easy to click
 *   people  — dark silhouettes in sold seats, so the hall feels occupied from your seat
 * plus glowing markers on the customer's own seats, a hover highlight with a tooltip, and row letters.
 */
import { Html } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SEAT_STYLES, type HallGeometry, type SeatInfo, type SeatStyle, type SeatStyleSpec } from '@shared/hall';
import { useI18n } from '@/i18n';
import { formatPrice } from '@/lib/format';
import { seatPrice, seatUiState, useBooking, type BookingState } from '@/store/booking';
import { byHouse } from '../../lightState';
import { PALETTE, seatFabricColor } from '../../palette';
import { runtime } from '../../runtime';
import { fadeTexture, letterTexture } from '../../textures';
import type { HallPartProps } from '../HallScene';

interface SeatParts {
  fabric: THREE.BufferGeometry;
  accent: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  hit: THREE.BufferGeometry;
  person: THREE.BufferGeometry;
}

const UP = new THREE.Vector3(0, 1, 0);
const HOVER = new THREE.Color(PALETTE.seatHover);

/** Deterministic 0–1 value from a string (so the audience doesn't reshuffle on every update). */
function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10007) / 10007;
}

const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

/**
 * Merges parts into one geometry. RoundedBoxGeometry is non-indexed while Box/Capsule/Sphere
 * are indexed, and mergeGeometries needs them all alike, so everything is de-indexed first.
 */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((part) => (part.index ? part.toNonIndexed() : part));
  const merged = mergeGeometries(flat);
  for (const part of flat) if (!parts.includes(part)) part.dispose();
  if (!merged) throw new Error('Seat geometry could not be merged');
  return merged;
}

/** Eases `now` towards `target` in place; returns whether anything changed. */
function approach(now: Float32Array, target: Float32Array, k: number): boolean {
  let dirty = false;
  for (let i = 0; i < now.length; i++) {
    const d = target[i] - now[i];
    if (d > 0.0005 || d < -0.0005) {
      now[i] += d * k;
      dirty = true;
    } else if (d !== 0) {
      now[i] = target[i];
      dirty = true;
    }
  }
  return dirty;
}

function buildSeatParts(styleName: SeatStyle, seatWidth: number): SeatParts {
  const s = SEAT_STYLES[styleName];
  const recliner = styleName === 'recliner';
  const width = s.bodyWidth - 0.02;
  const depth = s.back - s.front;
  const scratch: THREE.BufferGeometry[] = [];
  const keep = <T extends THREE.BufferGeometry>(geo: T): T => {
    scratch.push(geo);
    return geo;
  };

  // Seat cushion: thick and well rounded.
  const cushionT = recliner ? 0.2 : 0.13;
  const cushionD = depth * 0.7;
  const cushion = keep(new RoundedBoxGeometry(width, cushionT, cushionD, 3, recliner ? 0.06 : 0.05));
  cushion.translate(0, s.cushionHeight - cushionT / 2, s.front + cushionD / 2 + 0.01);

  // High backrest, tilted back so its top rear edge sits on the seat's rear line.
  const tilt = recliner ? 0.2 : 0.14;
  const backT = recliner ? 0.22 : 0.15;
  const backH = s.backHeight - s.cushionHeight + (recliner ? 0.02 : 0.03);
  const pivotY = s.cushionHeight - 0.03;
  const pivotZ = s.back - backH * Math.sin(tilt) - (backT / 2) * Math.cos(tilt);
  const onBackrest = <T extends THREE.BufferGeometry>(geo: T, y: number, z = 0): T => {
    geo.translate(0, y, z);
    geo.rotateX(tilt);
    geo.translate(0, pivotY, pivotZ);
    return geo;
  };
  const back = onBackrest(keep(new RoundedBoxGeometry(width, backH, backT, 3, recliner ? 0.07 : 0.06)), backH / 2);

  const fabricParts: THREE.BufferGeometry[] = [cushion, back];
  if (recliner) {
    // Upholstered base down to the floor.
    const baseH = s.cushionHeight - cushionT + 0.02;
    const base = keep(new RoundedBoxGeometry(width, baseH, depth * 0.84, 1, 0.04));
    base.translate(0, baseH / 2, s.front + depth * 0.42 + 0.04);
    fabricParts.push(base);
  }
  const fabric = merge(fabricParts);

  // Accent: a sculpted headrest wrapping the top of the backrest (a pillow on recliners).
  const accent = recliner
    ? onBackrest(new RoundedBoxGeometry(width * 0.7, 0.17, 0.09, 2, 0.045), backH - 0.13, -backT / 2 - 0.035)
    : onBackrest(new RoundedBoxGeometry(width + 0.008, 0.12, backT + 0.014, 3, 0.045), backH - 0.06, -0.004);

  // Armrest: a wide pad with a cup holder at its front end, on a solid side panel.
  // One sits between every pair of neighbouring seats.
  const armZ = (s.front + s.back) / 2 - (recliner ? 0.04 : 0.06);
  const padW = recliner ? 0.15 : 0.085;
  const padH = recliner ? 0.08 : 0.055;
  const padD = depth * (recliner ? 0.82 : 0.74);
  const pad = keep(new RoundedBoxGeometry(padW, padH, padD, 2, recliner ? 0.03 : 0.024));
  pad.translate(0, s.armHeight - padH / 2, armZ);
  const panelH = s.armHeight - padH + 0.01;
  const panel = keep(new RoundedBoxGeometry(recliner ? 0.12 : 0.05, panelH, depth * (recliner ? 0.8 : 0.66), 1, 0.012));
  panel.translate(0, panelH / 2, armZ + 0.02);
  const cupR = recliner ? 0.055 : 0.046;
  const cup = keep(new THREE.CylinderGeometry(cupR, cupR * 0.86, 0.075, 20, 1, true));
  const cupZ = armZ - padD / 2 + cupR - 0.012;
  cup.translate(0, s.armHeight - 0.03, cupZ);
  const rim = keep(new THREE.TorusGeometry(cupR, 0.009, 6, 20));
  rim.rotateX(Math.PI / 2);
  rim.translate(0, s.armHeight + 0.003, cupZ);
  const arm = merge([pad, panel, cup, rim]);

  // Generous invisible pick volume — makes small seats easy to hit.
  const hitH = s.backHeight + 0.08;
  const hit = new THREE.BoxGeometry(seatWidth * 0.96, hitH, depth + 0.06);
  hit.translate(0, hitH / 2, (s.front + s.back) / 2);

  // A seated silhouette for sold seats.
  const torso = keep(new THREE.CapsuleGeometry(0.16, 0.34, 4, 12));
  torso.scale(1.3, 1, 0.74);
  const head = keep(new THREE.SphereGeometry(0.102, 14, 10));
  head.scale(0.9, 1.1, 1);
  if (recliner) {
    torso.rotateX(0.22);
    torso.translate(0, s.cushionHeight + 0.33, 0.12);
    head.translate(0, s.eyeHeight + 0.05, s.eyeBack + 0.04);
  } else {
    torso.rotateX(0.1);
    torso.translate(0, s.cushionHeight + 0.34, 0.05);
    head.translate(0, s.eyeHeight + 0.05, s.eyeBack + 0.03);
  }
  const person = merge([torso, head]);

  for (const geo of scratch) geo.dispose();
  return { fabric, accent, arm, hit, person };
}

/** Armrests go at both ends of every run of adjacent seats and between neighbours. */
function armrestPositions(g: HallGeometry): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const half = g.layout.seatWidth / 2;
  for (const row of g.rows) {
    let run: SeatInfo[] = [];
    const flush = () => {
      if (run.length === 0) return;
      out.push([run[0].position[0] - half, row.y, row.z]);
      for (const seat of run) out.push([seat.position[0] + half, row.y, row.z]);
      run = [];
    };
    for (const seat of row.seats) {
      const previous = run[run.length - 1];
      if (previous && (seat.block !== previous.block || seat.position[0] - previous.position[0] > g.layout.seatWidth * 1.5)) {
        flush();
      }
      run.push(seat);
    }
    flush();
  }
  return out;
}

export function Seats({ geometry: g }: HallPartProps) {
  const parts = useMemo(() => buildSeatParts(g.layout.seatStyle, g.layout.seatWidth), [g]);
  useEffect(
    () => () => {
      for (const geo of Object.values(parts)) geo.dispose();
    },
    [parts],
  );
  const arms = useMemo(() => armrestPositions(g), [g]);

  const materials = useMemo(
    () => ({
      // Leather: a soft satin clear coat. Kept subtle, or dark (sold) seats turn grey under the house lights.
      fabric: new THREE.MeshPhysicalMaterial({
        roughness: 0.62,
        clearcoat: 0.32,
        clearcoatRoughness: 0.42,
      }),
      accent: new THREE.MeshPhysicalMaterial({ roughness: 0.5, metalness: 0.1, clearcoat: 0.4, clearcoatRoughness: 0.35 }),
      arm: new THREE.MeshStandardMaterial({ color: PALETTE.seatFrame, roughness: 0.42, metalness: 0.35 }),
      // Invisible but still raycast: the mesh stays "visible", only its material is skipped.
      hit: new THREE.MeshBasicMaterial({ visible: false }),
      person: new THREE.MeshStandardMaterial({ color: PALETTE.audience, roughness: 0.92 }),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const material of Object.values(materials)) material.dispose();
    },
    [materials],
  );

  const fabricRef = useRef<THREE.InstancedMesh>(null);
  const accentRef = useRef<THREE.InstancedMesh>(null);
  const armRef = useRef<THREE.InstancedMesh>(null);
  const hitRef = useRef<THREE.InstancedMesh>(null);
  const personRef = useRef<THREE.InstancedMesh>(null);

  const count = g.seatCount;
  const buffers = useMemo(
    () => ({
      fabricTarget: new Float32Array(count * 3),
      fabricNow: new Float32Array(count * 3),
      accentTarget: new Float32Array(count * 3),
      accentNow: new Float32Array(count * 3),
      /** Seats someone else is choosing right now — they pulse. */
      held: [] as number[],
    }),
    [count],
  );

  const computeTargets = useCallback(
    (state: BookingState) => {
      const hovered = state.view === 'overview' ? state.hoveredSeatId : null;
      const fabric = new THREE.Color();
      const accent = new THREE.Color();
      buffers.held.length = 0;
      g.seats.forEach((seat, i) => {
        const ui = seatUiState(state, seat.id);
        fabric.set(seatFabricColor(ui, seat.type));
        accent.set(
          ui === 'available'
            ? PALETTE.seatAccent[seat.type]
            : ui === 'selected'
              ? PALETTE.seatSelectedGlow
              : seatFabricColor(ui, seat.type),
        );
        if (seat.id === hovered && ui === 'available') {
          fabric.lerp(HOVER, 0.4);
          accent.lerp(HOVER, 0.4);
        }
        if (ui === 'held') buffers.held.push(i);
        fabric.toArray(buffers.fabricTarget, i * 3);
        accent.toArray(buffers.accentTarget, i * 3);
      });
    },
    [g, buffers],
  );

  /** Seat whose silhouette is hidden because the camera is (nearly) sitting in it. */
  const hiddenSeat = useRef<string | null>(null);
  /** The seat the camera last flew to — still occupied by the camera while it flies back out. */
  const lastPovSeat = useRef<string | null>(null);

  const updateAudience = useCallback(
    (state: BookingState) => {
      const mesh = personRef.current;
      if (!mesh) return;
      let n = 0;
      if (state.showAudience) {
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const p = new THREE.Vector3();
        const s = new THREE.Vector3();
        for (const seat of g.seats) {
          // Nobody sits in the seat the camera occupies (e.g. previewing your own booked seat).
          if (state.taken[seat.id] !== 'booked' || seat.id === hiddenSeat.current) continue;
          const r = hash01(seat.id);
          const size = r < 0.1 ? 0.8 : 0.93 + r * 0.12; // a few children
          q.setFromAxisAngle(UP, (hash01(`${seat.id}~`) - 0.5) * 0.35);
          m.compose(p.set(seat.position[0], seat.position[1], seat.position[2]), q, s.set(size * (0.94 + r * 0.12), size, size));
          mesh.setMatrixAt(n++, m);
        }
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    },
    [g],
  );

  // Static transforms and initial colours, before the first frame is drawn.
  useLayoutEffect(() => {
    const fabric = fabricRef.current;
    const accent = accentRef.current;
    const hit = hitRef.current;
    const arm = armRef.current;
    if (!fabric || !accent || !hit || !arm) return;
    const m = new THREE.Matrix4();
    g.seats.forEach((seat, i) => {
      m.makeTranslation(seat.position[0], seat.position[1], seat.position[2]);
      fabric.setMatrixAt(i, m);
      accent.setMatrixAt(i, m);
      hit.setMatrixAt(i, m);
    });
    arms.forEach((position, i) => {
      m.makeTranslation(position[0], position[1], position[2]);
      arm.setMatrixAt(i, m);
    });
    const state = useBooking.getState();
    computeTargets(state);
    buffers.fabricNow.set(buffers.fabricTarget);
    buffers.accentNow.set(buffers.accentTarget);
    fabric.instanceColor = new THREE.InstancedBufferAttribute(buffers.fabricNow.slice(), 3);
    accent.instanceColor = new THREE.InstancedBufferAttribute(buffers.accentNow.slice(), 3);
    for (const mesh of [fabric, accent, hit, arm]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    updateAudience(state);
  }, [g, arms, buffers, computeTargets, updateAudience]);

  // React to seat changes without re-rendering: recompute colour targets, ease towards them per frame.
  useEffect(
    () =>
      useBooking.subscribe((state, prev) => {
        if (
          state.taken !== prev.taken ||
          state.selected !== prev.selected ||
          state.hoveredSeatId !== prev.hoveredSeatId ||
          state.view !== prev.view
        ) {
          computeTargets(state);
        }
        if (state.povSeatId) lastPovSeat.current = state.povSeatId;
        if (state.taken !== prev.taken || state.showAudience !== prev.showAudience) updateAudience(state);
      }),
    [computeTargets, updateAudience],
  );

  useFrame(({ clock }, delta) => {
    // Hide the silhouette in the seat only while the camera is (nearly) in it, so it never pops in
    // around the camera on the way out.
    const occupied = runtime.povBlend > 0.55 ? lastPovSeat.current : null;
    if (occupied !== hiddenSeat.current) {
      hiddenSeat.current = occupied;
      updateAudience(useBooking.getState());
    }

    const fabric = fabricRef.current;
    const accent = accentRef.current;
    if (!fabric?.instanceColor || !accent?.instanceColor) return;
    const k = 1 - Math.exp(-Math.min(delta, 0.1) * 10);
    const fabricDirty = approach(buffers.fabricNow, buffers.fabricTarget, k);
    const accentDirty = approach(buffers.accentNow, buffers.accentTarget, k);
    const pulsing = buffers.held.length > 0;
    if (fabricDirty || pulsing) {
      const out = fabric.instanceColor.array as Float32Array;
      out.set(buffers.fabricNow);
      if (pulsing) {
        const pulse = 0.72 + 0.28 * Math.sin(clock.elapsedTime * 3.4);
        for (const i of buffers.held) {
          out[i * 3] *= pulse;
          out[i * 3 + 1] *= pulse;
          out[i * 3 + 2] *= pulse;
        }
      }
      fabric.instanceColor.needsUpdate = true;
    }
    if (accentDirty) {
      (accent.instanceColor.array as Float32Array).set(buffers.accentNow);
      accent.instanceColor.needsUpdate = true;
    }
  });

  // ── picking ──
  const gl = useThree((s) => s.gl);
  const hover = useBooking((s) => s.hover);
  const pickSeat = useBooking((s) => s.pickSeat);
  const canInteract = () => {
    const s = useBooking.getState();
    return s.view === 'overview' && !runtime.travelling && !s.submitting;
  };

  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (event.instanceId === undefined || event.pointerType === 'touch' || !canInteract()) return;
    const seat = g.seats[event.instanceId];
    if (seat && useBooking.getState().hoveredSeatId !== seat.id) hover(seat.id);
  };
  const onPointerOut = () => hover(null);
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    // Ignore the end of a drag (the camera rig uses drags to orbit). `delta` is only the straight-line
    // distance from press to release, so the rig also flags any drag that crossed its threshold.
    if (event.instanceId === undefined || event.delta > 8 || performance.now() < runtime.suppressClickUntil || !canInteract()) {
      return;
    }
    const seat = g.seats[event.instanceId];
    if (seat) pickSeat(seat.id);
  };

  const hoveredState = useBooking((s) =>
    s.hoveredSeatId && s.view === 'overview' ? seatUiState(s, s.hoveredSeatId) : null,
  );
  useEffect(() => {
    gl.domElement.style.cursor =
      hoveredState === null ? '' : hoveredState === 'available' || hoveredState === 'selected' ? 'pointer' : 'not-allowed';
  }, [gl, hoveredState]);
  useEffect(
    () => () => {
      gl.domElement.style.cursor = '';
    },
    [gl],
  );

  return (
    <group name="seats">
      <instancedMesh ref={fabricRef} args={[parts.fabric, materials.fabric, count]} />
      <instancedMesh ref={accentRef} args={[parts.accent, materials.accent, count]} />
      <instancedMesh ref={armRef} args={[parts.arm, materials.arm, Math.max(1, arms.length)]} />
      <instancedMesh ref={personRef} args={[parts.person, materials.person, count]} />
      <instancedMesh
        ref={hitRef}
        args={[parts.hit, materials.hit, count]}
        onPointerMove={onPointerMove}
        onPointerOut={onPointerOut}
        onClick={onClick}
      />
      <SelectedSeats geometry={g} parts={parts} />
      <HoverHighlight geometry={g} parts={parts} />
      <RowLabels geometry={g} />
    </group>
  );
}

// ───────────────────────────── the customer's seats ─────────────────────────────

interface SelectionMaterials {
  fabric: THREE.Material;
  accent: THREE.Material;
  marker: THREE.Material;
}

function SelectedSeats({ geometry: g, parts }: HallPartProps & { parts: SeatParts }) {
  const selected = useBooking((s) => s.selected);
  const povSeatId = useBooking((s) => s.povSeatId);
  const materials = useMemo<SelectionMaterials>(
    () => ({
      fabric: new THREE.MeshStandardMaterial({
        color: PALETTE.seatSelected,
        emissive: PALETTE.seatSelected,
        emissiveIntensity: 0.42,
        roughness: 0.62,
      }),
      accent: new THREE.MeshStandardMaterial({
        color: PALETTE.seatSelectedGlow,
        emissive: PALETTE.seatSelectedGlow,
        emissiveIntensity: 0.85,
        roughness: 0.4,
      }),
      marker: new THREE.MeshStandardMaterial({
        color: PALETTE.seatSelectedGlow,
        emissive: PALETTE.seatSelectedGlow,
        emissiveIntensity: 1.6,
        roughness: 0.3,
        toneMapped: false,
      }),
    }),
    [],
  );
  const beam = useMemo(() => new THREE.CylinderGeometry(0.06, 0.32, 2.6, 28, 1, true), []);
  useEffect(
    () => () => {
      beam.dispose();
      for (const material of Object.values(materials)) material.dispose();
    },
    [beam, materials],
  );

  return (
    <group name="selection">
      {selected.map((id) => {
        const seat = g.seatById[id];
        return seat ? (
          <SelectedSeat
            key={id}
            seat={seat}
            style={g.style}
            parts={parts}
            materials={materials}
            beam={beam}
            inPov={id === povSeatId}
          />
        ) : null;
      })}
    </group>
  );
}

function SelectedSeat({
  seat,
  style,
  parts,
  materials,
  beam,
  inPov,
}: {
  seat: SeatInfo;
  style: SeatStyleSpec;
  parts: SeatParts;
  materials: SelectionMaterials;
  beam: THREE.BufferGeometry;
  inPov: boolean;
}) {
  const marker = useRef<THREE.Mesh>(null);
  const beamMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const appear = useRef(0);
  const markerY = style.backHeight + 0.62;

  useFrame(({ clock }, delta) => {
    appear.current = Math.min(1, appear.current + delta * 2.2);
    // Fade the marker and beam out as the camera settles into this seat.
    const settle = inPov ? runtime.povBlend : 0;
    const visible = easeOutBack(appear.current) * (1 - settle);
    const t = clock.elapsedTime;
    if (marker.current) {
      marker.current.visible = visible > 0.01;
      marker.current.position.y = markerY + Math.sin(t * 2.2) * 0.05;
      marker.current.rotation.y = t * 1.6;
      marker.current.scale.setScalar(Math.max(0.001, visible));
    }
    if (beamMaterial.current) {
      beamMaterial.current.opacity =
        0.34 * Math.min(1, appear.current) * (1 - settle) * (0.85 + 0.15 * Math.sin(t * 2.6)) * byHouse(1.25, 1);
    }
  });

  return (
    <group position={seat.position as unknown as [number, number, number]}>
      <mesh geometry={parts.fabric} material={materials.fabric} scale={1.015} />
      <mesh geometry={parts.accent} material={materials.accent} scale={1.015} />
      <mesh ref={marker} position={[0, markerY, 0.08]} material={materials.marker}>
        <octahedronGeometry args={[0.12, 0]} />
      </mesh>
      <mesh position={[0, 1.5, 0.05]} geometry={beam} renderOrder={4}>
        <meshBasicMaterial
          ref={beamMaterial}
          color={PALETTE.seatSelectedGlow}
          alphaMap={fadeTexture()}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// ───────────────────────────── hover ─────────────────────────────

function HoverHighlight({ geometry: g, parts }: HallPartProps & { parts: SeatParts }) {
  const hoveredId = useBooking((s) => (s.view === 'overview' ? s.hoveredSeatId : null));
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: PALETTE.seatHover,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const seat = hoveredId ? g.seatById[hoveredId] : null;
  if (!seat) return null;
  return (
    <group position={seat.position as unknown as [number, number, number]}>
      <mesh geometry={parts.fabric} material={material} scale={[1.06, 1.03, 1.05]} />
      <Html position={[0, g.style.backHeight + 0.42, 0]} zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
        <SeatTooltip seat={seat} />
      </Html>
    </group>
  );
}

function SeatTooltip({ seat }: { seat: SeatInfo }) {
  const { t, lang, dir } = useI18n();
  const ui = useBooking((s) => seatUiState(s, seat.id));
  const price = useBooking((s) => seatPrice(s.detail, seat));
  return (
    <div dir={dir} className="pointer-events-none w-max -translate-x-1/2 -translate-y-full select-none pb-2">
      <div className="glass rounded-xl px-3 py-2 text-xs leading-snug text-cream">
        <div className="flex items-center gap-2">
          <span dir="ltr" className="font-mono text-sm font-semibold text-marquee-bright">
            {seat.id}
          </span>
          <span className="text-sand">{t(`common.seat.types.${seat.type}`)}</span>
        </div>
        {ui === 'available' || ui === 'selected' ? (
          <div className="mt-1 flex items-center gap-2 whitespace-nowrap">
            <span className="nums font-semibold">{formatPrice(price, lang)}</span>
            <span className="text-dust">·</span>
            <span className="text-ok">{t(`common.seat.view.${seat.viewRating}`)}</span>
          </div>
        ) : (
          <div className="mt-1 text-sand">{t(`common.seat.states.${ui}`)}</div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── row letters ─────────────────────────────

function RowLabels({ geometry: g }: HallPartProps) {
  const items = useMemo(
    () =>
      g.rows.flatMap((row) => {
        const first = row.seats[0];
        const last = row.seats[row.seats.length - 1];
        const y = row.y + g.style.backHeight + 0.2;
        const offset = g.layout.seatWidth * 0.5 + Math.min(0.55, g.layout.sideAisle * 0.45);
        return [
          { key: `${row.label}-l`, label: row.label, position: [first.position[0] - offset, y, row.z] as [number, number, number] },
          { key: `${row.label}-r`, label: row.label, position: [last.position[0] + offset, y, row.z] as [number, number, number] },
        ];
      }),
    [g],
  );
  const materials = useMemo(
    () =>
      new Map(
        g.rows.map((row) => [
          row.label,
          new THREE.SpriteMaterial({ map: letterTexture(row.label), transparent: true, depthWrite: false, toneMapped: false }),
        ]),
      ),
    [g],
  );
  useEffect(
    () => () => {
      for (const material of materials.values()) material.dispose();
    },
    [materials],
  );
  useFrame(() => {
    // Wayfinding for the overview; they fade away when you sit down.
    const opacity = byHouse(0, 0.95) * (1 - runtime.povBlend);
    for (const material of materials.values()) material.opacity = opacity;
  });
  return (
    <group name="row-labels">
      {items.map((item) => (
        <sprite key={item.key} position={item.position} scale={0.36} material={materials.get(item.label)} />
      ))}
    </group>
  );
}
