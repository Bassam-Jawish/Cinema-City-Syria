/**
 * Colours and material constants for the 3D hall — one place, so the room, the seats,
 * the lights and the 2D seat map all tell the same story.
 *
 * All colours are sRGB hex strings. three.js converts them to linear for lighting.
 */
import type { SeatType } from '@shared/hall';
import type { SeatUiState } from '@/store/booking';

export const PALETTE = {
  /** Clear colour and fog: what you see beyond the hall. */
  void: '#050304',

  // ── room: crimson fabric walls and a black ceiling, like the cinema's auditorium ──
  carpet: '#3a2224',
  carpetDark: '#221416',
  riser: '#16080a',
  wall: '#1d0d10',
  wallPanel: '#6a1119',
  wallPanelAlt: '#5a0e15',
  wallTrim: '#1a1112',
  ceiling: '#050404',
  stage: '#0a0606',
  curtain: '#6d0f1c',
  curtainDeep: '#3d0810',
  screenFrame: '#030202',
  screenIdle: '#141112',

  // ── light ──
  /** Warm tungsten of the house lights and wall sconces. */
  warmLight: '#ffcf8a',
  sconce: '#ffb86b',
  /** LED strips on the aisle steps. */
  aisleLed: '#ffb347',
  exitSign: '#39d98a',
  projector: '#cfe0ff',

  // ── seats ──
  seatFrame: '#0d0a0b',
  /** Fabric colour per seat type while the seat is free. */
  seatFabric: {
    standard: '#b5121e',
    premium: '#7e0d24',
    vip: '#6e3a12',
  } satisfies Record<SeatType, string>,
  /** Piping / headrest accent per seat type — how premium and VIP seats stand out when free. */
  seatAccent: {
    standard: '#b5121e',
    premium: '#e9b44c',
    vip: '#f0c66e',
  } satisfies Record<SeatType, string>,
  /** The customer's own seats glow marquee gold. */
  seatSelected: '#f2b53a',
  seatSelectedGlow: '#ffcc55',
  /** Sold seats fade into the dark. */
  seatBooked: '#1c1718',
  /** Seats another customer is choosing right now. */
  seatHeld: '#6a5230',
  /** Hover highlight. */
  seatHover: '#ffe2a8',
  audience: '#13141a',
} as const;

/** Fabric colour of a seat for a given state (free seats use their type's colour). */
export function seatFabricColor(state: SeatUiState, type: SeatType): string {
  switch (state) {
    case 'selected':
      return PALETTE.seatSelected;
    case 'booked':
      return PALETTE.seatBooked;
    case 'held':
      return PALETTE.seatHeld;
    default:
      return PALETTE.seatFabric[type];
  }
}

/**
 * Flat colours for the 2D seat map (CSS). Kept next to the 3D palette so the two views agree.
 */
export const MAP_COLORS = {
  available: { standard: '#c41f2c', premium: '#8e1028', vip: '#b07a2a' } satisfies Record<SeatType, string>,
  /** Outline that marks premium / VIP seats on the map, like their gold piping in 3D. */
  accent: { standard: 'transparent', premium: '#e9b44c', vip: '#f0c66e' } satisfies Record<SeatType, string>,
  selected: '#ffd166',
  booked: '#3a3234',
  held: '#7a5f38',
} as const;
