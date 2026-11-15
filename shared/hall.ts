/**
 * Hall model — the single source of truth for where every seat physically is.
 *
 * It is shared by the server (seat validation, pricing), the 3D scene (seat meshes,
 * room architecture), the camera rig (the eye position of each seat) and the 2D seat map.
 *
 * COORDINATE SYSTEM (metres, right-handed, Y up — the three.js convention)
 *   - The cinema screen lies in the plane z = 0, centred on x = 0, facing +z.
 *   - The audience sits at z > 0 and looks towards -z.
 *   - Facing the screen, the hall's LEFT is -x and its RIGHT is +x.
 *   - Row index 0 (label "A") is the row nearest the screen. Each row further back
 *     is `rowPitch` deeper (+z) and `rowRise` higher (+y): stadium seating.
 *   - A seat's `position` is its anchor: the centre of its footprint at floor level.
 */

export type SeatType = 'standard' | 'premium' | 'vip';
export const SEAT_TYPES: readonly SeatType[] = ['standard', 'premium', 'vip'];

export type SeatStyle = 'classic' | 'recliner';

export type Vec3 = readonly [x: number, y: number, z: number];

export interface RowSpec {
  /** Row label shown to customers ("A", "B", …). Letters only. Row A is nearest the screen. */
  label: string;
  /** Seats in each block, left → right. Same length as `HallLayout.blocks`; each entry ≤ that block's capacity. */
  seats: number[];
  /** Seat type for the whole row, or one type per block. */
  type: SeatType | SeatType[];
}

export interface HallLayout {
  /** Capacity of each seat block, left → right as you face the screen. Aisles run between blocks. */
  blocks: number[];
  /** Rows from the front (nearest the screen) to the back. */
  rows: RowSpec[];
  /** Centre-to-centre distance between neighbouring seats (m). */
  seatWidth: number;
  /** Row-to-row distance (m). */
  rowPitch: number;
  /** Height gained per row (m). */
  rowRise: number;
  /** Width of the aisles between blocks (m). */
  aisleWidth: number;
  /** Width of the walkway between the outermost seats and each side wall (m). */
  sideAisle: number;
  /** Distance from the screen plane to the first row's seat anchors (m). */
  frontDistance: number;
  /** Distance from the last row's seat anchors to the back wall (m). */
  rearDepth: number;
  /** Ceiling height above the floor of the LAST row (m). The ceiling is flat. */
  ceilingClearance: number;
  screen: {
    /** Screen width (m). */
    width: number;
    /** Width / height, e.g. 2.39 for scope. */
    aspect: number;
    /** Height of the screen's lower edge above the front floor (m). */
    bottom: number;
  };
  seatStyle: SeatStyle;
  /** Which side seat number 1 is on, as you face the screen. */
  numberFrom: 'left' | 'right';
  /**
   * Optional seat-type overrides for a range of seat numbers in some rows — e.g. a premium
   * "sweet spot" in the middle of a single block. Applied after numbering; later zones win.
   */
  zones?: SeatZone[];
}

export interface SeatZone {
  /** Row labels the zone covers. */
  rows: string[];
  /** First and last seat number of the zone (inclusive). */
  from: number;
  to: number;
  type: SeatType;
}

/** Physical dimensions per seat style. The seat meshes and the POV camera must both honour these. */
export interface SeatStyleSpec {
  /** Upholstered width of one seat (m) — narrower than the layout's seatWidth; the rest is armrest. */
  bodyWidth: number;
  /** Front edge of the cushion relative to the anchor (m, negative = towards the screen). */
  front: number;
  /** Rear face of the backrest relative to the anchor (m, positive = away from the screen). */
  back: number;
  /** Top of the seat cushion above the row floor (m). */
  cushionHeight: number;
  /** Top of the backrest above the row floor (m). */
  backHeight: number;
  /** Top of the armrests above the row floor (m). */
  armHeight: number;
  /** Eye height of a seated adult above the row floor (m). */
  eyeHeight: number;
  /** Eye position relative to the anchor along z (m, positive = away from the screen). */
  eyeBack: number;
  /** Gap between the seat anchor and the back edge of its row platform (m). */
  platformBack: number;
}

export const SEAT_STYLES: Record<SeatStyle, SeatStyleSpec> = {
  classic: {
    bodyWidth: 0.5,
    front: -0.3,
    back: 0.36,
    cushionHeight: 0.46,
    backHeight: 1.04,
    armHeight: 0.64,
    eyeHeight: 1.19,
    eyeBack: 0.08,
    platformBack: 0.42,
  },
  recliner: {
    bodyWidth: 0.74,
    front: -0.52,
    back: 0.5,
    cushionHeight: 0.48,
    backHeight: 1.12,
    armHeight: 0.66,
    eyeHeight: 1.14,
    eyeBack: 0.16,
    platformBack: 0.58,
  },
};

export type ViewRating = 'excellent' | 'great' | 'good' | 'fair';

export interface SeatInfo {
  /** Stable id: row label + seat number, e.g. "F12". */
  id: string;
  row: string;
  /** 0-based, 0 = nearest the screen. */
  rowIndex: number;
  /** 1-based seat number within the row. */
  number: number;
  type: SeatType;
  /** Index of the block the seat belongs to. */
  block: number;
  /** Anchor: centre of the seat footprint at floor level. */
  position: Vec3;
  /** World position of a seated person's eyes. */
  eye: Vec3;
  /** 0–100: how good the view of the screen is from this seat. */
  viewScore: number;
  viewRating: ViewRating;
  /** Diagnostics behind the score, in degrees. */
  view: {
    /** Horizontal angle the screen fills. Around 40–55° is ideal. */
    screenAngle: number;
    /** How far off the screen's centre axis the seat is (0 = dead centre). */
    offAxis: number;
    /** Head tilt needed to look at the screen centre (+ = up). */
    tilt: number;
    /** Straight-line distance from the eyes to the screen centre (m). */
    distance: number;
  };
}

export interface RowInfo {
  label: string;
  index: number;
  /** Floor height of this row's platform. */
  y: number;
  /** z of this row's seat anchors. */
  z: number;
  /** The platform (tread) this row stands on spans [zFront, zBack] at height y. */
  zFront: number;
  zBack: number;
  seats: SeatInfo[];
}

export interface AisleInfo {
  /** Centre line of the aisle. */
  x: number;
  width: number;
  kind: 'inner' | 'side';
}

export interface BlockInfo {
  index: number;
  xMin: number;
  xMax: number;
  capacity: number;
}

export interface HallGeometry {
  layout: HallLayout;
  style: SeatStyleSpec;
  seats: SeatInfo[];
  seatById: Record<string, SeatInfo>;
  rows: RowInfo[];
  blocks: BlockInfo[];
  aisles: AisleInfo[];
  seatCount: number;
  seatCountByType: Record<SeatType, number>;
  room: {
    width: number;
    /** Side walls. */
    minX: number;
    maxX: number;
    /** Front wall (just behind the screen) and back wall. */
    frontZ: number;
    backZ: number;
    /** Front floor level (0) and the flat ceiling. */
    floorY: number;
    ceilingY: number;
    /** Floor level behind the last row (same as the last row's platform). */
    rearFloorY: number;
  };
  screen: {
    center: Vec3;
    width: number;
    height: number;
    bottom: number;
    top: number;
  };
  /** Bounding box of all seat anchors — handy for framing the overview camera. */
  seating: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    minY: number;
    maxY: number;
    center: Vec3;
  };
  /** The seat with the highest view score. */
  bestSeatId: string;
}

const DEG = 180 / Math.PI;
const SCREEN_RECESS = 0.6;

const round = (n: number, digits = 4): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Piecewise-linear interpolation through sorted [x, y] points, clamped at both ends. */
export function piecewise(x: number, points: ReadonlyArray<readonly [number, number]>): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

export function makeSeatId(row: string, number: number): string {
  return `${row}${number}`;
}

export function parseSeatId(id: string): { row: string; number: number } | null {
  const m = /^([A-Z]+)(\d{1,3})$/.exec(id);
  if (!m) return null;
  return { row: m[1], number: Number(m[2]) };
}

export function ratingForScore(score: number): ViewRating {
  if (score >= 90) return 'excellent';
  if (score >= 76) return 'great';
  if (score >= 60) return 'good';
  return 'fair';
}

/**
 * Scores the view from an eye position. Three things matter to a cinema-goer:
 * how much of your vision the screen fills, how far off-centre you sit, and
 * whether you have to crane your neck.
 */
export function scoreView(
  eye: Vec3,
  screen: { center: Vec3; width: number },
): { score: number; screenAngle: number; offAxis: number; tilt: number; distance: number } {
  const dx = eye[0] - screen.center[0];
  const dy = screen.center[1] - eye[1];
  const dz = Math.max(0.01, eye[2] - screen.center[2]);
  const ground = Math.hypot(dx, dz);
  const distance = Math.hypot(ground, dy);
  const half = screen.width / 2;
  // True horizontal angle between the screen's left and right edges as seen from the seat.
  const screenAngle = (Math.atan2(half - dx, dz) + Math.atan2(half + dx, dz)) * DEG;
  const offAxis = Math.abs(Math.atan2(dx, dz)) * DEG;
  const tilt = Math.atan2(dy, ground) * DEG;

  // Too far and the screen looks small; too close and you cannot take it in at once.
  const angleScore = piecewise(screenAngle, [
    [24, 0.35],
    [30, 0.52],
    [36, 0.72],
    [40, 0.86],
    [44, 1],
    [54, 1],
    [60, 0.85],
    [70, 0.6],
    [85, 0.35],
  ]);
  const axisScore = piecewise(offAxis, [
    [6, 1],
    [12, 0.9],
    [20, 0.72],
    [30, 0.52],
    [40, 0.36],
    [55, 0.2],
  ]);
  const tiltScore = piecewise(tilt, [
    [-20, 0.7],
    [-12, 0.9],
    [-6, 1],
    [8, 1],
    [14, 0.8],
    [20, 0.6],
    [28, 0.4],
    [36, 0.25],
  ]);

  // Weighted geometric mean: one bad factor drags the score down, as it does in a real hall.
  const score = 100 * angleScore ** 0.5 * axisScore ** 0.3 * tiltScore ** 0.2;
  return {
    score: Math.round(score),
    screenAngle: round(screenAngle, 1),
    offAxis: round(offAxis, 1),
    tilt: round(tilt, 1),
    distance: round(distance, 2),
  };
}

/** Throws a descriptive error if the layout is internally inconsistent. */
export function validateLayout(layout: HallLayout): void {
  const fail = (msg: string): never => {
    throw new Error(`Invalid hall layout: ${msg}`);
  };
  if (layout.blocks.length === 0) fail('at least one block is required');
  if (layout.blocks.some((b) => !Number.isInteger(b) || b <= 0)) fail('block capacities must be positive integers');
  if (layout.rows.length === 0) fail('at least one row is required');
  const labels = new Set<string>();
  for (const row of layout.rows) {
    if (!/^[A-Z]+$/.test(row.label)) fail(`row label "${row.label}" must be upper-case letters`);
    if (labels.has(row.label)) fail(`duplicate row label "${row.label}"`);
    labels.add(row.label);
    if (row.seats.length !== layout.blocks.length) fail(`row ${row.label} must list ${layout.blocks.length} blocks`);
    row.seats.forEach((count, b) => {
      if (!Number.isInteger(count) || count < 0 || count > layout.blocks[b]) {
        fail(`row ${row.label}, block ${b}: ${count} seats does not fit a block of ${layout.blocks[b]}`);
      }
    });
    if (row.seats.reduce((a, b) => a + b, 0) === 0) fail(`row ${row.label} has no seats`);
    if (Array.isArray(row.type) && row.type.length !== layout.blocks.length) {
      fail(`row ${row.label} must give one seat type per block`);
    }
  }
  const positive: Array<keyof HallLayout> = [
    'seatWidth',
    'rowPitch',
    'aisleWidth',
    'sideAisle',
    'frontDistance',
    'rearDepth',
    'ceilingClearance',
  ];
  for (const key of positive) {
    if (!((layout[key] as number) > 0)) fail(`${key} must be positive`);
  }
  if (layout.rowRise < 0) fail('rowRise cannot be negative');
  if (!(layout.screen.width > 0 && layout.screen.aspect > 0 && layout.screen.bottom >= 0)) fail('bad screen spec');
  for (const zone of layout.zones ?? []) {
    if (!(Number.isInteger(zone.from) && Number.isInteger(zone.to) && zone.from >= 1 && zone.from <= zone.to)) {
      fail(`zone ${zone.from}–${zone.to} is not a valid seat range`);
    }
    for (const row of zone.rows) if (!labels.has(row)) fail(`zone refers to unknown row "${row}"`);
  }
}

function zoneTypeFor(layout: HallLayout, row: string, number: number): SeatType | null {
  let type: SeatType | null = null;
  for (const zone of layout.zones ?? []) {
    if (zone.rows.includes(row) && number >= zone.from && number <= zone.to) type = zone.type;
  }
  return type;
}

/**
 * Turns a declarative layout into concrete world-space geometry.
 * Pure and deterministic: the same layout always yields the same geometry.
 */
export function buildHallGeometry(layout: HallLayout): HallGeometry {
  validateLayout(layout);
  const style = SEAT_STYLES[layout.seatStyle];
  const { blocks: caps, seatWidth, aisleWidth, rowPitch, rowRise } = layout;

  const seatingWidth = caps.reduce((a, b) => a + b, 0) * seatWidth + (caps.length - 1) * aisleWidth;
  const blocks: BlockInfo[] = [];
  let cursor = -seatingWidth / 2;
  caps.forEach((capacity, index) => {
    const xMin = cursor;
    const xMax = cursor + capacity * seatWidth;
    blocks.push({ index, xMin: round(xMin), xMax: round(xMax), capacity });
    cursor = xMax + aisleWidth;
  });

  const aisles: AisleInfo[] = [];
  for (let b = 0; b < blocks.length - 1; b++) {
    aisles.push({ x: round((blocks[b].xMax + blocks[b + 1].xMin) / 2), width: aisleWidth, kind: 'inner' });
  }
  const roomWidth = seatingWidth + 2 * layout.sideAisle;
  const minX = -roomWidth / 2;
  const maxX = roomWidth / 2;
  aisles.push({ x: round(minX + layout.sideAisle / 2), width: layout.sideAisle, kind: 'side' });
  aisles.push({ x: round(maxX - layout.sideAisle / 2), width: layout.sideAisle, kind: 'side' });

  const screenHeight = layout.screen.width / layout.screen.aspect;
  const screen = {
    center: [0, round(layout.screen.bottom + screenHeight / 2), 0] as Vec3,
    width: layout.screen.width,
    height: round(screenHeight),
    bottom: layout.screen.bottom,
    top: round(layout.screen.bottom + screenHeight),
  };

  const seats: SeatInfo[] = [];
  const seatById: Record<string, SeatInfo> = {};
  const rows: RowInfo[] = [];
  const seatCountByType: Record<SeatType, number> = { standard: 0, premium: 0, vip: 0 };

  layout.rows.forEach((spec, rowIndex) => {
    const y = round(rowIndex * rowRise);
    const z = round(layout.frontDistance + rowIndex * rowPitch);
    const zBack = round(z + style.platformBack);
    const zFront = round(zBack - rowPitch);
    const rowSeats: SeatInfo[] = [];

    // Collect seats left → right first; numbering is applied afterwards.
    const slots: Array<{ x: number; block: number; type: SeatType }> = [];
    spec.seats.forEach((count, b) => {
      const cap = caps[b];
      const isFirst = b === 0;
      const isLast = b === caps.length - 1;
      // Short rows hug the aisle: outer blocks push inwards, middle blocks stay centred.
      let startSlot: number;
      if (caps.length === 1) startSlot = (cap - count) / 2;
      else if (isFirst) startSlot = cap - count;
      else if (isLast) startSlot = 0;
      else startSlot = (cap - count) / 2;
      const type = Array.isArray(spec.type) ? spec.type[b] : spec.type;
      for (let i = 0; i < count; i++) {
        slots.push({ x: blocks[b].xMin + (startSlot + i + 0.5) * seatWidth, block: b, type });
      }
    });

    slots.forEach((slot, i) => {
      const number = layout.numberFrom === 'left' ? i + 1 : slots.length - i;
      const position: Vec3 = [round(slot.x), y, z];
      const eye: Vec3 = [round(slot.x), round(y + style.eyeHeight), round(z + style.eyeBack)];
      const scored = scoreView(eye, screen);
      const seat: SeatInfo = {
        id: makeSeatId(spec.label, number),
        row: spec.label,
        rowIndex,
        number,
        type: zoneTypeFor(layout, spec.label, number) ?? slot.type,
        block: slot.block,
        position,
        eye,
        viewScore: scored.score,
        viewRating: ratingForScore(scored.score),
        view: {
          screenAngle: scored.screenAngle,
          offAxis: scored.offAxis,
          tilt: scored.tilt,
          distance: scored.distance,
        },
      };
      rowSeats.push(seat);
      seats.push(seat);
      seatById[seat.id] = seat;
      seatCountByType[seat.type]++;
    });

    rows.push({ label: spec.label, index: rowIndex, y, z, zFront, zBack, seats: rowSeats });
  });

  const last = rows[rows.length - 1];
  const xs = seats.map((s) => s.position[0]);
  const seating = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: rows[0].z,
    maxZ: last.z,
    minY: rows[0].y,
    maxY: last.y,
    center: [0, round((rows[0].y + last.y) / 2), round((rows[0].z + last.z) / 2)] as Vec3,
  };

  let best = seats[0];
  for (const seat of seats) {
    if (
      seat.viewScore > best.viewScore ||
      (seat.viewScore === best.viewScore && Math.abs(seat.position[0]) < Math.abs(best.position[0]))
    ) {
      best = seat;
    }
  }

  return {
    layout,
    style,
    seats,
    seatById,
    rows,
    blocks,
    aisles,
    seatCount: seats.length,
    seatCountByType,
    room: {
      width: round(roomWidth),
      minX: round(minX),
      maxX: round(maxX),
      frontZ: -SCREEN_RECESS,
      backZ: round(last.z + layout.rearDepth),
      floorY: 0,
      ceilingY: round(last.y + layout.ceilingClearance),
      rearFloorY: last.y,
    },
    screen,
    seating,
    bestSeatId: best.id,
  };
}

/** Floor height at a given depth: the front floor, then one platform per row, then the rear landing. */
export function floorHeightAt(geometry: HallGeometry, z: number): number {
  let y = 0;
  for (const row of geometry.rows) {
    if (z >= row.zFront) y = row.y;
    else break;
  }
  return y;
}

/** Seats directly beside `seatId` in the same row and block (used to detect orphaned single seats). */
export function neighboursOf(geometry: HallGeometry, seatId: string): { left: SeatInfo | null; right: SeatInfo | null } {
  const seat = geometry.seatById[seatId];
  if (!seat) return { left: null, right: null };
  const row = geometry.rows[seat.rowIndex].seats;
  const i = row.indexOf(seat);
  const left = i > 0 && row[i - 1].block === seat.block ? row[i - 1] : null;
  const right = i < row.length - 1 && row[i + 1].block === seat.block ? row[i + 1] : null;
  return { left, right };
}
