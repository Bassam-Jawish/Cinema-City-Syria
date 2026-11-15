/**
 * The cinema's halls. Each layout is declarative — change the numbers here and the 3D model,
 * the 2D seat map, seat validation and pricing all follow.
 *
 * Cinema City Damascus runs two digital 3D screens (about 280 and 180 seats, per published
 * reports) with straight, stadium-raked rows and side aisles. The rows, seat counts and room
 * dimensions below are a faithful approximation for the demo — replace them with the surveyed
 * plan of each hall before going live. The premium "sweet spot" zones are an illustrative
 * pricing idea; delete the `zones` entries to sell every seat at one price.
 */
import type { HallLayout, RowSpec, SeatType } from './hall';
import type { HallKind, Localized } from './types';

export interface HallDefinition {
  id: string;
  name: Localized;
  kind: HallKind;
  features: Localized[];
  layout: HallLayout;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Rows A, B, C… with the same seats per block and seat type. */
function uniformRows(count: number, seats: number[], type: SeatType = 'standard'): RowSpec[] {
  return Array.from({ length: count }, (_, i) => ({ label: LETTERS[i], seats, type }));
}

const rowRange = (from: string, to: string): string[] =>
  LETTERS.slice(LETTERS.indexOf(from), LETTERS.indexOf(to) + 1).split('');

/** Hall 1 — the large hall: 280 seats in 14 straight rows of 20. */
const hall1: HallDefinition = {
  id: 'hall-1',
  name: { en: 'Hall 1', ar: 'الصالة 1' },
  kind: 'standard',
  features: [
    { en: '280 seats', ar: '280 مقعداً' },
    { en: 'Digital 3D', ar: 'رقمية ثلاثية الأبعاد' },
    { en: 'Surround sound', ar: 'صوت محيطي' },
  ],
  layout: {
    blocks: [20],
    rows: uniformRows(14, [20]),
    zones: [{ rows: rowRange('F', 'K'), from: 5, to: 16, type: 'premium' }],
    seatWidth: 0.56,
    rowPitch: 1.05,
    rowRise: 0.32,
    aisleWidth: 1.1,
    sideAisle: 1.25,
    frontDistance: 6.8,
    rearDepth: 2.3,
    ceilingClearance: 3.6,
    screen: { width: 11.6, aspect: 2.39, bottom: 1.2 },
    seatStyle: 'classic',
    numberFrom: 'left',
  },
};

/** Hall 2 — the smaller hall: 180 seats in 12 straight rows of 15. */
const hall2: HallDefinition = {
  id: 'hall-2',
  name: { en: 'Hall 2', ar: 'الصالة 2' },
  kind: 'standard',
  features: [
    { en: '180 seats', ar: '180 مقعداً' },
    { en: 'Digital 3D', ar: 'رقمية ثلاثية الأبعاد' },
    { en: 'Surround sound', ar: 'صوت محيطي' },
  ],
  layout: {
    blocks: [15],
    rows: uniformRows(12, [15]),
    zones: [{ rows: rowRange('D', 'H'), from: 4, to: 12, type: 'premium' }],
    seatWidth: 0.56,
    rowPitch: 1.02,
    rowRise: 0.3,
    aisleWidth: 1.1,
    sideAisle: 1.15,
    frontDistance: 5.8,
    rearDepth: 2.1,
    ceilingClearance: 3.4,
    screen: { width: 8.6, aspect: 2.39, bottom: 1.1 },
    seatStyle: 'classic',
    numberFrom: 'left',
  },
};

/** The halls on sale. */
export const HALLS: HallDefinition[] = [hall1, hall2];

/**
 * A concept for a future upgrade: a 40-seat VIP lounge with reclining seats in pairs.
 * It is NOT on sale — add it to HALLS (and to the schedule) to enable it.
 */
export const CONCEPT_VIP_LOUNGE: HallDefinition = {
  id: 'hall-vip',
  name: { en: 'VIP Lounge', ar: 'صالة كبار الزوار' },
  kind: 'vip',
  features: [
    { en: '40 recliners', ar: '40 مقعداً مريحاً' },
    { en: 'Seats in pairs', ar: 'مقاعد ثنائية' },
    { en: 'At-seat service', ar: 'خدمة إلى المقعد' },
  ],
  layout: {
    blocks: [2, 2, 2, 2],
    rows: uniformRows(5, [2, 2, 2, 2], 'vip'),
    seatWidth: 0.98,
    rowPitch: 1.95,
    rowRise: 0.42,
    aisleWidth: 0.85,
    sideAisle: 1.2,
    frontDistance: 6,
    rearDepth: 2.6,
    ceilingClearance: 3.9,
    screen: { width: 9.6, aspect: 2.39, bottom: 1.1 },
    seatStyle: 'recliner',
    numberFrom: 'left',
  },
};
