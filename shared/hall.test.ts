import { describe, expect, it } from 'vitest';
import {
  SEAT_STYLES,
  buildHallGeometry,
  floorHeightAt,
  neighboursOf,
  parseSeatId,
  piecewise,
  scoreView,
  validateLayout,
  type HallLayout,
} from './hall';
import { CONCEPT_VIP_LOUNGE, HALLS } from './halls';

const ALL_LAYOUTS = [...HALLS, CONCEPT_VIP_LOUNGE];

/** A three-block hall with a short front row, for the layout rules that single-block halls don't exercise. */
const THREE_BLOCKS: HallLayout = {
  blocks: [5, 12, 5],
  rows: [
    { label: 'A', seats: [4, 10, 4], type: 'standard' },
    { label: 'B', seats: [5, 12, 5], type: 'standard' },
    { label: 'C', seats: [5, 12, 5], type: ['standard', 'premium', 'standard'] },
  ],
  seatWidth: 0.58,
  rowPitch: 1.08,
  rowRise: 0.36,
  aisleWidth: 1.2,
  sideAisle: 1.3,
  frontDistance: 7.5,
  rearDepth: 2.4,
  ceilingClearance: 3.8,
  screen: { width: 13.5, aspect: 2.39, bottom: 1.4 },
  seatStyle: 'classic',
  numberFrom: 'left',
};

describe('hall layouts', () => {
  it('has the two halls of the real cinema on sale', () => {
    expect(HALLS.map((h) => [h.id, buildHallGeometry(h.layout).seatCount])).toEqual([
      ['hall-1', 280],
      ['hall-2', 180],
    ]);
  });

  it.each(ALL_LAYOUTS.map((h) => [h.id, h] as const))('%s builds a consistent geometry', (_id, hall) => {
    const g = buildHallGeometry(hall.layout);
    const expected = hall.layout.rows.reduce((sum, row) => sum + row.seats.reduce((a, b) => a + b, 0), 0);
    expect(g.seatCount).toBe(expected);
    expect(g.seats).toHaveLength(expected);

    // Seat ids are unique and parse back to their row and number.
    expect(new Set(g.seats.map((s) => s.id)).size).toBe(expected);
    for (const seat of g.seats) {
      expect(parseSeatId(seat.id)).toEqual({ row: seat.row, number: seat.number });
      expect(g.seatById[seat.id]).toBe(seat);
    }

    // Seats never overlap and never sit in an aisle or outside the walls.
    for (const row of g.rows) {
      const xs = row.seats.map((s) => s.position[0]);
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(hall.layout.seatWidth - 1e-6);
      }
      for (const seat of row.seats) {
        const [x] = seat.position;
        expect(x - hall.layout.seatWidth / 2).toBeGreaterThanOrEqual(g.room.minX + hall.layout.sideAisle - 1e-6);
        expect(x + hall.layout.seatWidth / 2).toBeLessThanOrEqual(g.room.maxX - hall.layout.sideAisle + 1e-6);
        for (const aisle of g.aisles.filter((a) => a.kind === 'inner')) {
          expect(Math.abs(x - aisle.x)).toBeGreaterThanOrEqual(aisle.width / 2 + hall.layout.seatWidth / 2 - 1e-6);
        }
      }
    }

    // The room encloses the screen and the seating, with headroom.
    expect(g.screen.top).toBeLessThan(g.room.ceilingY - 0.2);
    expect(g.screen.width).toBeLessThan(g.room.width - 0.5);
    expect(g.room.backZ).toBeGreaterThan(g.seating.maxZ + SEAT_STYLES[hall.layout.seatStyle].back);

    // Row platforms tile the floor without gaps and rise towards the back.
    for (let i = 1; i < g.rows.length; i++) {
      expect(g.rows[i].zFront).toBeCloseTo(g.rows[i - 1].zBack, 6);
      expect(g.rows[i].y).toBeGreaterThan(g.rows[i - 1].y);
    }
    expect(g.rows[0].zFront).toBeGreaterThan(1.5);

    // Every seat can see over the row in front: eyes clear the backrest ahead.
    const style = SEAT_STYLES[hall.layout.seatStyle];
    for (const row of g.rows.slice(1)) {
      const backrestAhead = g.rows[row.index - 1].y + style.backHeight;
      expect(row.y + style.eyeHeight).toBeGreaterThan(backrestAhead + 0.1);
    }
  });

  it('applies premium zones by row and seat number', () => {
    const g = buildHallGeometry(HALLS[0].layout);
    expect(g.seatCountByType).toEqual({ standard: 208, premium: 72, vip: 0 });
    expect(g.seatById.F5.type).toBe('premium');
    expect(g.seatById.K16.type).toBe('premium');
    expect(g.seatById.F4.type).toBe('standard');
    expect(g.seatById.E10.type).toBe('standard');
    expect(g.seatById.L10.type).toBe('standard');
  });

  it('numbers seats 1..n from the left by default and from the right on request', () => {
    const base = HALLS[1].layout;
    const left = buildHallGeometry(base);
    const rowB = left.rows[1].seats;
    expect(rowB.map((s) => s.number)).toEqual(rowB.map((_, i) => i + 1));
    expect(rowB[0].position[0]).toBeLessThan(rowB[rowB.length - 1].position[0]);

    const right = buildHallGeometry({ ...base, numberFrom: 'right' });
    const rowBRight = right.rows[1].seats;
    expect(rowBRight[0].number).toBe(rowBRight.length);
    expect(rowBRight[rowBRight.length - 1].number).toBe(1);
  });

  it('keeps short rows against the aisles', () => {
    const g = buildHallGeometry(THREE_BLOCKS);
    const [front, second] = g.rows;
    // The front row is shorter, so its outer seats start further in than the row behind…
    expect(front.seats[0].position[0]).toBeGreaterThan(second.seats[0].position[0]);
    // …but its aisle-side seats line up with the row behind.
    const lastOfLeftBlock = (row: typeof front) => row.seats.filter((s) => s.block === 0).at(-1)!;
    expect(lastOfLeftBlock(front).position[0]).toBeCloseTo(lastOfLeftBlock(second).position[0], 6);
    // Per-block seat types.
    expect(g.rows[2].seats.filter((s) => s.type === 'premium')).toHaveLength(12);
  });

  it('rates centre seats above edge and front-row seats', () => {
    const g = buildHallGeometry(HALLS[0].layout);
    const best = g.seatById[g.bestSeatId];
    expect(best.viewRating).toBe('excellent');
    expect(Math.abs(best.position[0])).toBeLessThan(1);
    const frontCorner = g.rows[0].seats[0];
    expect(frontCorner.viewScore).toBeLessThan(best.viewScore - 25);
    // Premium seats are, on average, better than standard ones.
    const avg = (type: string) => {
      const list = g.seats.filter((s) => s.type === type);
      return list.reduce((a, s) => a + s.viewScore, 0) / list.length;
    };
    expect(avg('premium')).toBeGreaterThan(avg('standard'));
  });

  it('reports floor heights that step up row by row', () => {
    const g = buildHallGeometry(HALLS[0].layout);
    expect(floorHeightAt(g, 1)).toBe(0);
    for (const row of g.rows) {
      expect(floorHeightAt(g, row.z)).toBe(row.y);
    }
    expect(floorHeightAt(g, g.room.backZ - 0.1)).toBe(g.room.rearFloorY);
  });

  it('finds neighbours only within the same block', () => {
    const g = buildHallGeometry(THREE_BLOCKS);
    const rowC = g.rows[2].seats;
    const aisleSeat = rowC.filter((s) => s.block === 0).at(-1)!;
    const n = neighboursOf(g, aisleSeat.id);
    expect(n.left?.block).toBe(0);
    expect(n.right).toBeNull();
    expect(neighboursOf(g, 'ZZ99')).toEqual({ left: null, right: null });
  });

  it('rejects inconsistent layouts', () => {
    const base = HALLS[0].layout;
    const bad = (patch: Partial<HallLayout>) => () => validateLayout({ ...base, ...patch });
    expect(bad({ blocks: [] })).toThrow();
    expect(bad({ rows: [{ label: 'A', seats: [25], type: 'standard' }], zones: [] })).toThrow(/does not fit/);
    expect(bad({ rows: [{ label: 'a1', seats: [20], type: 'standard' }], zones: [] })).toThrow(/letters/);
    expect(bad({ rows: [base.rows[0], base.rows[0]], zones: [] })).toThrow(/duplicate/);
    expect(bad({ seatWidth: 0 })).toThrow();
    expect(bad({ zones: [{ rows: ['Z'], from: 1, to: 2, type: 'premium' }] })).toThrow(/unknown row/);
    expect(bad({ zones: [{ rows: ['A'], from: 5, to: 2, type: 'premium' }] })).toThrow(/range/);
  });
});

describe('view scoring helpers', () => {
  it('interpolates and clamps', () => {
    const pts = [
      [0, 0],
      [10, 1],
    ] as const;
    expect(piecewise(-5, pts)).toBe(0);
    expect(piecewise(5, pts)).toBeCloseTo(0.5);
    expect(piecewise(50, pts)).toBe(1);
  });

  it('prefers a centred mid-distance seat', () => {
    const screen = { center: [0, 4, 0] as const, width: 12 };
    const ideal = scoreView([0, 3.6, 14], screen).score;
    expect(ideal).toBeGreaterThanOrEqual(95);
    expect(scoreView([0, 1.2, 5], screen).score).toBeLessThan(ideal - 20);
    expect(scoreView([8, 3.6, 14], screen).score).toBeLessThan(ideal);
    expect(scoreView([0, 6, 40], screen).score).toBeLessThan(ideal - 20);
  });
});
