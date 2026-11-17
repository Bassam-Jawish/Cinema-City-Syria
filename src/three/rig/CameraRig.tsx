/**
 * The camera rig — the heart of the "view from your seat" experience.
 *
 *   overview  the whole hall from above and behind, like an architect's model.
 *             Drag to orbit, wheel or pinch to zoom, arrow keys to turn.
 *   flight    a smooth ~2 s swoop from wherever the camera is into a seat (or back out),
 *             along a curved path that clears the rows, settling in from behind the seat.
 *   pov       seated at eye height, facing the screen. The view follows the mouse
 *             (pointer to the left edge = look left), or a finger drag on touch screens,
 *             or the arrow keys. Wheel / pinch zooms. Esc stands up again.
 *
 * The rig follows the booking store: whenever `view` / `povSeatId` change it flies to match.
 * Each frame it publishes povBlend, heading, fov… in `runtime` for the scene and the HUD.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { HallGeometry } from '@shared/hall';
import { useBooking } from '@/store/booking';
import { runtime } from '../runtime';
import { prefersReducedMotion } from '../support';

export interface CameraRigProps {
  geometry: HallGeometry;
}

const DEG = Math.PI / 180;
const OVERVIEW_FOV = 40;
/** Horizontal field of view when seated — roughly what you take in without turning your head. */
const POV_HFOV = 84 * DEG;
const AZIMUTH_LIMIT = 80 * DEG;
const POLAR_MIN = 20 * DEG;
const POLAR_MAX = 76 * DEG;
const YAW_LIMIT = 80 * DEG;
const PITCH_UP = 30 * DEG;
const PITCH_DOWN = 38 * DEG;
const DRAG_THRESHOLD = 5;
/** Width the seat-map panel takes from the view on large screens (panel + margin), in CSS pixels. */
const MAP_PANEL_PX = 344;

const { clamp, damp, lerp } = THREE.MathUtils;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
/** Pointer position (−1…1) → look amount (−1…1) with a small dead zone in the middle. */
const lookCurve = (n: number) => Math.sign(n) * clamp((Math.abs(n) - 0.05) / 0.9, 0, 1);

interface Orbit {
  azimuth: number;
  polar: number;
  radius: number;
}

interface Flight {
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  p2: THREE.Vector3;
  p3: THREE.Vector3;
  look0: THREE.Vector3;
  look1: THREE.Vector3;
  fov0: number;
  fov1: number;
  blend0: number;
  blend1: number;
  t: number;
  duration: number;
  toSeat: string | null;
}

interface RigState {
  phase: 'overview' | 'flying' | 'pov';
  seatId: string | null;
  flight: Flight | null;
  target: THREE.Vector3;
  orbit: Orbit;
  goal: Orbit;
  baseRadius: number;
  zoom: number;
  intro: number;
  yaw: number;
  pitch: number;
  yawGoal: number;
  pitchGoal: number;
  lookGain: number;
  lookArmed: boolean;
  armAt: { x: number; y: number } | null;
  povZoom: number;
  lookPoint: THREE.Vector3;
  lastReset: number;
  /** Current sideways shift of the overview image (px), easing towards the free area beside the map panel. */
  viewShift: number;
}

function cubicBezier(
  out: THREE.Vector3,
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  t: number,
): THREE.Vector3 {
  const u = 1 - t;
  return out
    .copy(p0)
    .multiplyScalar(u * u * u)
    .addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t)
    .addScaledVector(p3, t * t * t);
}

function orbitPosition(out: THREE.Vector3, target: THREE.Vector3, o: Orbit): THREE.Vector3 {
  const s = Math.sin(o.polar);
  return out.set(
    target.x + o.radius * s * Math.sin(o.azimuth),
    target.y + o.radius * Math.cos(o.polar),
    target.z + o.radius * s * Math.cos(o.azimuth),
  );
}

/** Vertical FOV that gives the seated horizontal field of view at the current aspect ratio. */
function povFov(aspect: number, zoom: number): number {
  const vertical = (2 * Math.atan(Math.tan(POV_HFOV / 2) / aspect)) / DEG;
  return clamp(vertical, 46, 92) * zoom;
}

/** Points that must be in view in the overview: the seating block (at seat-back height) and the screen. */
function keyPoints(g: HallGeometry): THREE.Vector3[] {
  const margin = g.layout.seatWidth;
  const points: THREE.Vector3[] = [];
  for (const x of [g.seating.minX - margin, g.seating.maxX + margin]) {
    points.push(new THREE.Vector3(x, g.seating.minY + 1.1, g.seating.minZ - 0.6));
    points.push(new THREE.Vector3(x, g.seating.maxY + 1.1, g.seating.maxZ + 0.7));
  }
  // The screen's lower two-thirds: enough to read it as the screen without spending the
  // whole frame on the empty space above the seats.
  const half = g.screen.width / 2;
  for (const x of [-half, half]) {
    points.push(new THREE.Vector3(x, g.screen.bottom + g.screen.height * 0.65, 0));
    points.push(new THREE.Vector3(x, g.screen.bottom, 0));
  }
  return points;
}

/** Usable part of the viewport in normalised device coordinates — the HUD covers the top and bottom edges. */
const FIT_WINDOW = { x: 0.94, top: 0.8, bottom: -0.66 };

const fitCamera = new THREE.PerspectiveCamera();
const fitPoint = new THREE.Vector3();

function placeFitCamera(target: THREE.Vector3, orbit: Orbit, aspect: number): void {
  fitCamera.fov = OVERVIEW_FOV;
  fitCamera.aspect = aspect;
  fitCamera.near = 0.1;
  fitCamera.far = 500;
  fitCamera.updateProjectionMatrix();
  orbitPosition(fitCamera.position, target, orbit);
  fitCamera.lookAt(target);
  fitCamera.updateMatrixWorld(true);
}

/** Bounds of the key points in normalised device coordinates for the fit camera. */
function projectedBounds(points: THREE.Vector3[]): { x0: number; x1: number; y0: number; y1: number; behind: boolean } {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, behind: false };
  for (const p of points) {
    fitPoint.copy(p).project(fitCamera);
    if (fitPoint.z >= 1) b.behind = true;
    b.x0 = Math.min(b.x0, fitPoint.x);
    b.x1 = Math.max(b.x1, fitPoint.x);
    b.y0 = Math.min(b.y0, fitPoint.y);
    b.y1 = Math.max(b.y1, fitPoint.y);
  }
  return b;
}

/** Smallest orbit radius at which every key point projects inside the usable window. */
function fitRadius(points: THREE.Vector3[], target: THREE.Vector3, orbit: Orbit, aspect: number): number {
  const fits = (radius: number) => {
    placeFitCamera(target, { ...orbit, radius }, aspect);
    const b = projectedBounds(points);
    return !b.behind && b.x0 >= -FIT_WINDOW.x && b.x1 <= FIT_WINDOW.x && b.y0 >= FIT_WINDOW.bottom && b.y1 <= FIT_WINDOW.top;
  };
  let lo = 2;
  let hi = 200;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Default overview: seating and screen fill the usable part of the view, seen from above and
 * behind at a three-quarter angle. The target is re-centred on the projected content a few
 * times, which lets the camera come much closer than a naive "look at the middle" fit.
 */
function overviewFraming(g: HallGeometry, aspect: number): { target: THREE.Vector3; orbit: Orbit } {
  const points = keyPoints(g);
  const target = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  // Portrait screens look along the hall's length; landscape ones get a three-quarter view.
  const orbit: Orbit = { azimuth: (aspect < 1 ? 4 : 22) * DEG, polar: (aspect < 1 ? 44 : 58) * DEG, radius: 30 };
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const centreY = (FIT_WINDOW.top + FIT_WINDOW.bottom) / 2;
  for (let pass = 0; pass < 6; pass++) {
    orbit.radius = fitRadius(points, target, orbit, aspect);
    placeFitCamera(target, orbit, aspect);
    const b = projectedBounds(points);
    const halfHeight = orbit.radius * Math.tan((OVERVIEW_FOV * DEG) / 2);
    right.setFromMatrixColumn(fitCamera.matrixWorld, 0);
    up.setFromMatrixColumn(fitCamera.matrixWorld, 1);
    target
      .addScaledVector(right, ((b.x0 + b.x1) / 2) * halfHeight * aspect)
      .addScaledVector(up, ((b.y0 + b.y1) / 2 - centreY) * halfHeight);
  }
  orbit.radius = fitRadius(points, target, orbit, aspect);
  return { target, orbit };
}

export function CameraRig({ geometry: g }: CameraRigProps) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);

  const r = useMemo<RigState>(
    () => ({
      phase: 'overview',
      seatId: null,
      flight: null,
      target: new THREE.Vector3(),
      orbit: { azimuth: 0, polar: 1, radius: 20 },
      goal: { azimuth: 0, polar: 1, radius: 20 },
      baseRadius: 20,
      zoom: 1,
      intro: 0,
      yaw: 0,
      pitch: 0,
      yawGoal: 0,
      pitchGoal: 0,
      lookGain: 0,
      lookArmed: false,
      armAt: null,
      povZoom: 1,
      lookPoint: new THREE.Vector3(),
      lastReset: 0,
      viewShift: 0,
    }),
    [],
  );

  // The seat-map panel covers one side of the view on large screens: frame the hall in the rest.
  const mapOpen = useBooking((s) => s.mapOpen);
  const panel = mapOpen && size.width >= 768 ? MAP_PANEL_PX : 0;
  const frameAspect = (size.width - panel) / Math.max(1, size.height);

  const scratch = useMemo(
    () => ({ eye: new THREE.Vector3(), toScreen: new THREE.Vector3(), dir: new THREE.Vector3() }),
    [],
  );
  if (import.meta.env.DEV) (window as unknown as { __rig?: unknown }).__rig = { r, camera };

  // New hall: start with an establishing shot that glides into the default framing.
  useEffect(() => {
    const { target, orbit } = overviewFraming(g, frameAspect);
    const reduced = prefersReducedMotion();
    r.target.copy(target);
    r.baseRadius = orbit.radius;
    r.zoom = 1;
    r.goal = { ...orbit };
    r.orbit = reduced
      ? { ...orbit }
      : { azimuth: orbit.azimuth + 30 * DEG, polar: orbit.polar - 16 * DEG, radius: orbit.radius * 1.6 };
    r.intro = reduced ? 0 : 2.6;
    r.phase = 'overview';
    r.flight = null;
    r.seatId = null;
    r.lastReset = useBooking.getState().lookResetNonce;
    runtime.travelling = false;
    runtime.povBlend = 0;
    orbitPosition(camera.position, r.target, r.orbit);
    camera.fov = OVERVIEW_FOV;
    camera.updateProjectionMatrix();
    camera.lookAt(r.target);
    r.lookPoint.copy(r.target);
    // Only on a new hall — resizes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, camera, r]);

  // Keep the overview framed when the viewport changes shape or the map panel opens/closes.
  useEffect(() => {
    const { target, orbit } = overviewFraming(g, frameAspect);
    r.target.copy(target);
    r.baseRadius = orbit.radius;
    r.goal.radius = r.baseRadius * r.zoom;
  }, [g, r, frameAspect]);

  // ── input ──
  useEffect(() => {
    const el = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { id: number; startX: number; startY: number; lastX: number; lastY: number; moved: boolean; type: string } | null =
      null;
    let pinch = 0;

    const ndc = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      };
    };
    const pinchDistance = () => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const takeOverLook = () => {
      r.lookArmed = true;
      r.lookGain = 1;
    };
    const zoomBy = (factor: number) => {
      r.intro = 0;
      if (r.phase === 'overview') {
        r.zoom = clamp(r.zoom * factor, 0.55, 1.5);
        r.goal.radius = r.baseRadius * r.zoom;
      } else if (r.phase === 'pov') {
        r.povZoom = clamp(r.povZoom * factor, 0.55, 1.12);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        pinch = pinchDistance();
        drag = null;
        return;
      }
      drag = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
        type: e.pointerType,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const d = pinchDistance();
        if (pinch > 0 && d > 0) zoomBy(pinch / d);
        pinch = d;
        return;
      }

      if (drag && e.pointerId === drag.id) {
        const dx = e.clientX - drag.lastX;
        const dy = e.clientY - drag.lastY;
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        if (!drag.moved) {
          if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
          drag.moved = true;
          if (r.phase === 'overview') {
            el.style.cursor = 'grabbing';
            useBooking.getState().hover(null);
          }
        }
        if (r.phase === 'overview') {
          r.intro = 0;
          r.goal.azimuth = clamp(r.goal.azimuth - dx * 0.0055, -AZIMUTH_LIMIT, AZIMUTH_LIMIT);
          r.goal.polar = clamp(r.goal.polar - dy * 0.0045, POLAR_MIN, POLAR_MAX);
          return;
        }
        if (r.phase === 'pov' && drag.type !== 'mouse') {
          // Touch: drag the view around.
          takeOverLook();
          r.yawGoal = clamp(r.yawGoal - dx * 0.0045, -YAW_LIMIT, YAW_LIMIT);
          r.pitchGoal = clamp(r.pitchGoal + dy * 0.004, -PITCH_DOWN, PITCH_UP);
          return;
        }
      }

      // Mouse: while the pointer is over the 3D view, the view follows it.
      if (r.phase === 'pov' && e.pointerType === 'mouse') {
        if (e.target !== el) return; // over the HUD: hold the view still
        const p = ndc(e);
        if (!r.lookArmed) {
          // Wait for a deliberate movement after sitting down, so the view doesn't lurch
          // towards wherever the pointer happened to be when the seat was clicked.
          if (!r.armAt) {
            r.armAt = p;
            return;
          }
          if (Math.hypot(p.x - r.armAt.x, p.y - r.armAt.y) < 0.04) return;
          r.lookArmed = true;
        }
        r.yawGoal = lookCurve(p.x) * YAW_LIMIT;
        r.pitchGoal = lookCurve(p.y) * (p.y >= 0 ? PITCH_UP : PITCH_DOWN);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (drag && e.pointerId === drag.id) {
        if (drag.moved) {
          // The click that follows this pointerup ends a drag, not a seat pick.
          runtime.suppressClickUntil = performance.now() + 250;
          if (r.phase === 'overview') el.style.cursor = '';
        }
        drag = null;
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomBy(Math.exp(clamp(delta, -120, 120) * 0.0011));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return;
      if (e.key === 'Escape') {
        if (r.phase === 'pov' || r.flight?.toSeat) {
          useBooking.getState().exitPov();
          e.preventDefault();
        }
        return;
      }
      // Arrow keys belong to whatever control has focus (tabs, seat map…), except the page and the canvas.
      if (active && active !== document.body && active !== el && !el.parentElement?.contains(active)) return;
      const step = (e.shiftKey ? 22 : 11) * DEG;
      let handled = true;
      if (r.phase === 'pov') {
        switch (e.key) {
          case 'ArrowLeft':
            r.yawGoal = clamp(r.yawGoal - step, -YAW_LIMIT, YAW_LIMIT);
            break;
          case 'ArrowRight':
            r.yawGoal = clamp(r.yawGoal + step, -YAW_LIMIT, YAW_LIMIT);
            break;
          case 'ArrowUp':
            r.pitchGoal = clamp(r.pitchGoal + step * 0.7, -PITCH_DOWN, PITCH_UP);
            break;
          case 'ArrowDown':
            r.pitchGoal = clamp(r.pitchGoal - step * 0.7, -PITCH_DOWN, PITCH_UP);
            break;
          case '+':
          case '=':
            zoomBy(0.9);
            break;
          case '-':
          case '_':
            zoomBy(1.1);
            break;
          default:
            handled = false;
        }
        if (handled && e.key.startsWith('Arrow')) takeOverLook();
      } else if (r.phase === 'overview') {
        r.intro = 0;
        switch (e.key) {
          case 'ArrowLeft':
            r.goal.azimuth = clamp(r.goal.azimuth - step, -AZIMUTH_LIMIT, AZIMUTH_LIMIT);
            break;
          case 'ArrowRight':
            r.goal.azimuth = clamp(r.goal.azimuth + step, -AZIMUTH_LIMIT, AZIMUTH_LIMIT);
            break;
          case 'ArrowUp':
            r.goal.polar = clamp(r.goal.polar - step * 0.6, POLAR_MIN, POLAR_MAX);
            break;
          case 'ArrowDown':
            r.goal.polar = clamp(r.goal.polar + step * 0.6, POLAR_MIN, POLAR_MAX);
            break;
          case '+':
          case '=':
            zoomBy(0.9);
            break;
          case '-':
          case '_':
            zoomBy(1.1);
            break;
          default:
            handled = false;
        }
      } else {
        handled = false;
      }
      if (handled) e.preventDefault();
    };

    const onBlur = () => {
      drag = null;
      pointers.clear();
      pinch = 0;
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onBlur);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [gl, r]);

  // ── per frame ──
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const store = useBooking.getState();
    const aspect = state.size.width / Math.max(1, state.size.height);

    const wanted = store.view === 'pov' && store.povSeatId && g.seatById[store.povSeatId] ? store.povSeatId : null;
    if (wanted !== r.seatId) beginFlight(wanted, aspect);

    if (store.lookResetNonce !== r.lastReset) {
      r.lastReset = store.lookResetNonce;
      resetLook();
    }

    if (r.flight) stepFlight(dt);
    else if (r.phase === 'pov') stepPov(dt, state.clock.elapsedTime, aspect);
    else stepOverview(dt);

    // Shift the overview image into the area beside the map panel (the panel sits on the
    // start side: left in English, right in Arabic). Fades out as you sit down.
    const rtl = document.documentElement.dir === 'rtl';
    const shiftGoal = (store.mapOpen && state.size.width >= 768 ? MAP_PANEL_PX / 2 : 0) * (rtl ? -1 : 1) * (1 - runtime.povBlend);
    r.viewShift = damp(r.viewShift, shiftGoal, 6, dt);
    if (Math.abs(r.viewShift) > 0.5) {
      camera.setViewOffset(state.size.width, state.size.height, -r.viewShift, 0, state.size.width, state.size.height);
    } else if (camera.view?.enabled) {
      r.viewShift = 0;
      camera.clearViewOffset();
    }
  });

  function resetLook() {
    r.yawGoal = 0;
    r.pitchGoal = 0;
    r.lookGain = 0;
    r.lookArmed = false;
    r.armAt = null;
    r.povZoom = 1;
  }

  function beginFlight(to: string | null, aspect: number) {
    const from = camera.position.clone();
    const reduced = prefersReducedMotion();
    const wasSeated = r.phase === 'pov' || Boolean(r.flight?.toSeat);
    let p1: THREE.Vector3;
    let p2: THREE.Vector3;
    let p3: THREE.Vector3;
    let look1: THREE.Vector3;
    let fov1: number;
    let blend1: number;
    let duration: number;

    if (to) {
      const seat = g.seatById[to];
      p3 = new THREE.Vector3(seat.eye[0], seat.eye[1], seat.eye[2]);
      look1 = new THREE.Vector3(g.screen.center[0], g.screen.center[1], g.screen.center[2]);
      fov1 = povFov(aspect, 1);
      blend1 = 1;
      if (wasSeated) {
        // Seat to seat: hop over the rows in between.
        const distance = from.distanceTo(p3);
        const hop = 0.6 + Math.min(1.4, distance * 0.09);
        p1 = from.clone().add(new THREE.Vector3(0, hop, 0.35));
        p2 = p3.clone().add(new THREE.Vector3(0, hop, 0.35));
        duration = clamp(0.85 + distance * 0.07, 1.0, 1.9);
      } else {
        // Overview to seat: swoop down and settle in from behind and above the seat.
        p1 = from.clone().lerp(p3, 0.35);
        p1.y = Math.max(from.y, p3.y + 3.2);
        p2 = p3.clone().add(new THREE.Vector3(0, 1.15, 1.7));
        duration = 2.2;
      }
    } else {
      p3 = orbitPosition(new THREE.Vector3(), r.target, r.goal);
      look1 = r.target.clone();
      fov1 = OVERVIEW_FOV;
      blend1 = 0;
      // Stand up, rise and pull back.
      p1 = from.clone().add(new THREE.Vector3(0, 1.3, 1.5));
      p2 = p3.clone().lerp(from, 0.3);
      p2.y = Math.max(p3.y, from.y + 3);
      duration = 1.8;
    }

    r.flight = {
      p0: from,
      p1,
      p2,
      p3,
      look0: r.lookPoint.clone(),
      look1,
      fov0: camera.fov,
      fov1,
      blend0: runtime.povBlend,
      blend1,
      t: 0,
      duration: reduced ? 0.001 : duration,
      toSeat: to,
    };
    r.seatId = to;
    r.phase = 'flying';
    runtime.travelling = true;
  }

  function stepFlight(dt: number) {
    const f = r.flight!;
    f.t = Math.min(1, f.t + dt / f.duration);
    const e = easeInOutCubic(f.t);
    cubicBezier(camera.position, f.p0, f.p1, f.p2, f.p3, e);
    // The gaze leads the body slightly: it settles on its target just before the camera lands.
    r.lookPoint.lerpVectors(f.look0, f.look1, easeInOutSine(Math.min(1, f.t * 1.12)));
    camera.lookAt(r.lookPoint);
    camera.fov = lerp(f.fov0, f.fov1, e);
    camera.updateProjectionMatrix();
    runtime.povBlend = lerp(f.blend0, f.blend1, e);
    runtime.fov = camera.fov;
    if (f.t >= 1) {
      r.flight = null;
      runtime.travelling = false;
      if (f.toSeat) {
        r.phase = 'pov';
        resetLook();
        r.yaw = 0;
        r.pitch = 0;
      } else {
        r.phase = 'overview';
        r.orbit = { ...r.goal };
      }
    }
  }

  function stepPov(dt: number, time: number, aspect: number) {
    const seat = r.seatId ? g.seatById[r.seatId] : null;
    if (!seat) return;
    const { eye, toScreen, dir } = scratch;
    eye.set(seat.eye[0], seat.eye[1], seat.eye[2]);
    toScreen.set(g.screen.center[0], g.screen.center[1], g.screen.center[2]).sub(eye);
    const heading0 = Math.atan2(toScreen.x, -toScreen.z);
    const pitch0 = Math.atan2(toScreen.y, Math.hypot(toScreen.x, toScreen.z));

    if (r.lookArmed && r.lookGain < 1) r.lookGain = Math.min(1, r.lookGain + dt * 1.8);
    r.yaw = damp(r.yaw, r.yawGoal * r.lookGain, 5, dt);
    r.pitch = damp(r.pitch, r.pitchGoal * r.lookGain, 5, dt);

    const heading = heading0 + r.yaw;
    const pitch = clamp(pitch0 + r.pitch, -65 * DEG, 55 * DEG);
    // A barely perceptible breathing motion keeps the seated view alive.
    const breathe = prefersReducedMotion() ? 0 : Math.sin(time * 1.3) * 0.0035;
    camera.position.set(eye.x, eye.y + breathe, eye.z);
    const cp = Math.cos(pitch);
    dir.set(Math.sin(heading) * cp, Math.sin(pitch), -Math.cos(heading) * cp);
    r.lookPoint.copy(camera.position).addScaledVector(dir, toScreen.length());
    camera.lookAt(r.lookPoint);

    const fov = povFov(aspect, r.povZoom);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = damp(camera.fov, fov, 7, dt);
      camera.updateProjectionMatrix();
    }
    runtime.povBlend = 1;
    runtime.lookYaw = r.yaw;
    runtime.lookPitch = r.pitch;
    runtime.heading = heading;
    runtime.fov = camera.fov;
  }

  function stepOverview(dt: number) {
    // The opening establishing shot glides in more slowly than user-driven moves.
    const lambda = r.intro > 0 ? 1.5 : 4.5;
    r.intro = Math.max(0, r.intro - dt);
    r.orbit.azimuth = damp(r.orbit.azimuth, r.goal.azimuth, lambda, dt);
    r.orbit.polar = damp(r.orbit.polar, r.goal.polar, lambda, dt);
    r.orbit.radius = damp(r.orbit.radius, r.goal.radius, lambda, dt);
    orbitPosition(camera.position, r.target, r.orbit);
    r.lookPoint.copy(r.target);
    camera.lookAt(r.target);
    if (Math.abs(camera.fov - OVERVIEW_FOV) > 0.01) {
      camera.fov = damp(camera.fov, OVERVIEW_FOV, 6, dt);
      camera.updateProjectionMatrix();
    }
    runtime.povBlend = 0;
    runtime.heading = -r.orbit.azimuth;
    runtime.fov = camera.fov;
  }

  return null;
}
