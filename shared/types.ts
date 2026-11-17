/**
 * Domain model and API data-transfer types, shared by the server and the web client.
 * The HTTP contract itself is documented in docs/openapi.yaml — keep the two in step.
 */
import type { HallLayout, SeatType } from './hall';

export type Lang = 'ar' | 'en';

/** A string in both interface languages. */
export interface Localized {
  ar: string;
  en: string;
}

// ───────────────────────────── Movies ─────────────────────────────

/** Age ratings, as the cinema shows them. '13+' is the MPA's PG-13; '16+' is what the cinema gives most R-rated films. */
export type Rating = 'G' | 'PG' | '12+' | '13+' | '15+' | '16+' | '18+';
export type MovieStatus = 'now_showing' | 'coming_soon';
export type Format = '2D' | '3D';

export const GENRES = [
  'action',
  'adventure',
  'animation',
  'comedy',
  'crime',
  'drama',
  'family',
  'fantasy',
  'history',
  'horror',
  'mystery',
  'romance',
  'sci_fi',
  'sport',
  'thriller',
] as const;
export type Genre = (typeof GENRES)[number];

export interface Movie {
  /** URL-safe slug, also the primary key. */
  id: string;
  title: Localized;
  tagline: Localized;
  synopsis: Localized;
  genres: Genre[];
  durationMin: number;
  rating: Rating;
  /** Spoken language of the print being shown. */
  audio: Lang;
  /** Subtitle language, if any. */
  subtitles: Lang | null;
  formats: Format[];
  /** Opening day in the cinema, YYYY-MM-DD. */
  releaseDate: string;
  /** Follows the release date: 'now_showing' from that day on (Asia/Damascus), 'coming_soon' before it. */
  status: MovieStatus;
  /**
   * From this day (YYYY-MM-DD) the film's opening week can be booked in advance, before it opens.
   * null = no advance booking: its shows go on sale with the regular 7-day schedule.
   */
  advanceBookingFrom: string | null;
  director: Localized;
  cast: Localized[];
  /** Audience score out of 10 (demo data). */
  score: number;
  /** Text-free key art, 2:3. The title is typeset by the UI so it follows the interface language. */
  poster: string;
  /** Text-free wide still, 16:9. Also projected onto the 3D cinema screen. */
  backdrop: string;
  /** Signature colour of the film (#rrggbb) — tints glows and the light the 3D screen casts. */
  accent: string;
  featured: boolean;
  /**
   * Video played on the hall's screen when a customer sits down to preview a seat, uploaded by
   * staff on the box-office page. null = no trailer yet: the screen shows the still.
   */
  trailer: Trailer | null;
}

/** A trailer video file uploaded by staff (see server/trailers.ts). */
export interface Trailer {
  /** Where the video is served, versioned so a replaced file is never stale in a cache. */
  url: string;
  /** video/mp4 or video/webm. */
  type: TrailerType;
  /** File size in bytes. */
  size: number;
  /** When the file was uploaded (ISO-8601). */
  updatedAt: string;
}

export type TrailerType = 'video/mp4' | 'video/webm';

/** What the server accepts as a trailer upload (GET /api/admin/trailers/limits). */
export interface TrailerLimits {
  /** Largest file, in bytes (server setting TRAILER_MAX_MB). */
  maxBytes: number;
  accepted: TrailerType[];
}

// ───────────────────────────── Halls ─────────────────────────────

export type HallKind = 'standard' | 'vip';

export interface HallSummary {
  id: string;
  name: Localized;
  kind: HallKind;
  seatCount: number;
  /** Short feature tags, e.g. "Dolby 7.1", "3D". */
  features: Localized[];
}

export interface Hall extends HallSummary {
  layout: HallLayout;
}

// ───────────────────────────── Showtimes ─────────────────────────────

export type Prices = Partial<Record<SeatType, number>>;

export interface Showtime {
  id: string;
  movieId: string;
  hallId: string;
  /** ISO-8601 instant (UTC). Display it in the cinema's time zone, Asia/Damascus. */
  startsAt: string;
  endsAt: string;
  format: Format;
  /** Price per seat type, in whole currency units. Only the types this hall has. */
  prices: Prices;
  currency: Currency;
}

export type Currency = 'SYP';

/** open → bookable; closed → the show has started (or ended) and can no longer be booked. */
export type ShowtimeStatus = 'open' | 'filling_fast' | 'sold_out' | 'closed';

export interface ShowtimeSummary extends Showtime {
  hall: HallSummary;
  seatsTotal: number;
  /** Seats that are neither booked nor currently held by someone. */
  seatsAvailable: number;
  status: ShowtimeStatus;
}

export interface MovieWithShowtimes extends Movie {
  /**
   * The next few showtimes from now, soonest first. Empty for a coming-soon film until its shows
   * go on sale (with the regular schedule, or earlier with advance booking).
   */
  nextShowtimes: ShowtimeSummary[];
}

export interface ScheduleDay {
  /** Calendar day in Asia/Damascus, YYYY-MM-DD. */
  date: string;
  showtimes: ShowtimeSummary[];
}

/** How a seat that is NOT available looks to the requesting session. Available seats are simply absent. */
export type SeatAvailability = 'booked' | 'held' | 'mine';
export type SeatMap = Record<string, SeatAvailability>;

export interface ShowtimeDetail {
  showtime: ShowtimeSummary;
  movie: Movie;
  hall: Hall;
  /** Unavailable seats only. "mine" = held by the requesting session. */
  seats: SeatMap;
  /** When the requesting session's holds on this showtime lapse (ISO), or null if it holds nothing. */
  holdExpiresAt: string | null;
  /** Server clock (ISO) so the client can run an accurate countdown. */
  serverTime: string;
}

// ───────────────────────────── Holds ─────────────────────────────

export interface HoldResult {
  seatId: string;
  /** All holds of this session on the showtime share one expiry, pushed forward on every new seat. */
  holdExpiresAt: string;
  /** Every seat this session now holds on the showtime. */
  seatIds: string[];
  serverTime: string;
}

export interface ReleaseResult {
  seatIds: string[];
  holdExpiresAt: string | null;
}

// ───────────────────────────── Live seat events (SSE) ─────────────────────────────

/**
 * Sent over GET /api/showtimes/:id/events as Server-Sent Events.
 * Each message is one JSON-encoded SeatStreamEvent in the `data:` field.
 */
export type SeatStreamEvent =
  | { type: 'snapshot'; seats: SeatMap; holdExpiresAt: string | null; serverTime: string }
  | { type: 'seats'; changes: SeatChange[]; serverTime: string }
  | { type: 'reset'; serverTime: string }
  /** Staff uploaded, replaced or removed a film's trailer (sent to every open stream). */
  | { type: 'trailer'; movieId: string; trailer: Trailer | null; serverTime: string };

export interface SeatChange {
  seatId: string;
  /** New state as seen by the receiving session. */
  state: SeatAvailability | 'available';
}

// ───────────────────────────── Bookings ─────────────────────────────

/** box_office = reserve now, pay at the cinema. online_demo = simulated online payment (no real money moves). */
export type PaymentMethod = 'box_office' | 'online_demo';
export type PaymentStatus = 'due' | 'paid';
export type BookingStatus = 'confirmed' | 'checked_in' | 'cancelled';

export interface Customer {
  name: string;
  /** Normalised to +9639XXXXXXXX. */
  phone: string;
}

export interface BookingSeat {
  seatId: string;
  row: string;
  number: number;
  type: SeatType;
  price: number;
}

export interface Booking {
  /** Customer-facing reference, e.g. "CC-7K4M2Q". */
  code: string;
  status: BookingStatus;
  createdAt: string;
  cancelledAt: string | null;
  checkedInAt: string | null;
  showtime: Showtime;
  movie: Movie;
  hall: HallSummary;
  seats: BookingSeat[];
  total: number;
  currency: Currency;
  customer: Customer;
  payment: { method: PaymentMethod; status: PaymentStatus };
}

export interface CreateBookingRequest {
  showtimeId: string;
  seatIds: string[];
  customer: { name: string; phone: string };
  paymentMethod: PaymentMethod;
}

// ───────────────────────────── Admin ─────────────────────────────

export interface AdminShowtimeRow extends ShowtimeSummary {
  movieTitle: Localized;
  seatsBooked: number;
  seatsHeld: number;
  revenue: number;
  /** 0–1 */
  occupancy: number;
}

export interface AdminOverview {
  /** Calendar day in Asia/Damascus the figures are for. */
  date: string;
  /** Days staff can pick: today … today + 6, then any later days already on sale (advance booking). */
  days: string[];
  totals: {
    bookings: number;
    tickets: number;
    revenue: number;
    /** 0–1 across all of the day's showtimes. */
    occupancy: number;
    checkedIn: number;
    seatsHeldNow: number;
  };
  showtimes: AdminShowtimeRow[];
  currency: Currency;
  serverTime: string;
}

export interface AdminBookingRow extends Booking {
  /** true for the bookings generated to make the demo look lived-in. */
  seeded: boolean;
}

// ───────────────────────────── Errors ─────────────────────────────

export const ERROR_CODES = [
  'VALIDATION',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'SESSION_REQUIRED',
  'SEAT_UNKNOWN',
  'SEAT_UNAVAILABLE',
  'SEAT_LIMIT',
  'SHOWTIME_CLOSED',
  'BOOKING_NOT_CANCELLABLE',
  'BOOKING_NOT_CHECKINABLE',
  'RATE_LIMITED',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_FILE',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Every non-2xx JSON response has this shape. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    /** English, for developers and logs. The UI localises by `code`. */
    message: string;
    /** e.g. the seat ids that could not be booked. */
    details?: unknown;
  };
}
