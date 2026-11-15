/**
 * Booking business logic, independent of Express so tests and scripts can drive it directly.
 *
 * Every rule that decides whether a seat can be held or booked is checked inside a SQLite
 * transaction, and the schema itself guarantees no double booking (see db.ts). Holds whose
 * expiry has passed are ignored by every query; the sweeper only tidies them up and tells the
 * live streams. The clock is injectable (`now`) so tests can move time forward.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import { DEFAULT_HOLD_MINUTES, FILLING_FAST_THRESHOLD, MAX_SEATS_PER_BOOKING, normalizeSyrianMobile } from '../shared/constants';
import { parseSeatId, type SeatType } from '../shared/hall';
import { cinemaDate } from '../shared/time';
import type {
  AdminBookingRow,
  AdminOverview,
  AdminShowtimeRow,
  Booking,
  BookingStatus,
  Format,
  HallSummary,
  HoldResult,
  Movie,
  MovieWithShowtimes,
  PaymentMethod,
  PaymentStatus,
  Prices,
  ReleaseResult,
  ScheduleDay,
  SeatMap,
  SeatStreamEvent,
  Showtime,
  ShowtimeDetail,
  ShowtimeStatus,
  ShowtimeSummary,
} from '../shared/types';
import { loadCatalog, syncCatalog, type CatalogRuntime, type HallRuntime } from './catalog-store';
import { normalizeBookingCode, randomBookingCode } from './codes';
import { isUniqueViolation, transaction } from './db';
import { HttpError, notFound } from './errors';
import type { LiveHub, SeatUpdate } from './live';
import { ensureScheduleWindow, resetDemoData, scheduleWindow, type ScheduleSummary } from './seed';
import { normalizeName, type BookingRequest } from './validation';

/** How many upcoming showtimes each film carries in GET /api/movies. */
export const NEXT_SHOWTIMES_PER_MOVIE = 4;
/** The schedule window is re-checked at most this often (and whenever the cinema date changes). */
const SCHEDULE_CHECK_INTERVAL_MS = 60_000;
const ADMIN_PAGE_DEFAULT = 100;
const ADMIN_PAGE_MAX = 500;

// ───────────────────────────── Rows ─────────────────────────────

interface ShowtimeRow {
  id: string;
  movie_id: string;
  hall_id: string;
  date: string;
  starts_at: number;
  ends_at: number;
  format: Format;
  prices: string;
}

/** A showtime with its live seat counts. */
interface ShowtimeStatsRow extends ShowtimeRow {
  booked: number;
  held: number;
}

interface AdminShowtimeStatsRow extends ShowtimeStatsRow {
  revenue: number;
}

interface BookingRow {
  code: string;
  showtime_id: string;
  session_id: string | null;
  status: BookingStatus;
  customer_name: string;
  customer_phone: string;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  total: number;
  seeded: number;
  created_at: number;
  cancelled_at: number | null;
  checked_in_at: number | null;
}

interface BookingSeatRow {
  booking_code: string;
  showtime_id: string;
  seat_id: string;
  row_label: string;
  seat_number: number;
  seat_type: SeatType;
  price: number;
}

interface HoldRow {
  seat_id: string;
  session_id: string;
  expires_at: number;
}

type Params = Record<string, SQLInputValue>;

// ───────────────────────────── Helpers ─────────────────────────────

export const iso = (ms: number): string => new Date(ms).toISOString();

/** Seat ids in row order (A…Z, AA…), then by number. */
export function compareSeatIds(a: string, b: string): number {
  const pa = parseSeatId(a);
  const pb = parseSeatId(b);
  if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;
  if (pa.row !== pb.row) return pa.row.length - pb.row.length || (pa.row < pb.row ? -1 : 1);
  return pa.number - pb.number;
}

const sortSeatIds = (ids: Iterable<string>): string[] => [...ids].sort(compareSeatIds);

export function showtimeStatus(startsAt: number, seatsTotal: number, seatsAvailable: number, now: number): ShowtimeStatus {
  if (now >= startsAt) return 'closed';
  if (seatsAvailable <= 0) return 'sold_out';
  if (seatsTotal > 0 && (seatsTotal - seatsAvailable) / seatsTotal >= FILLING_FAST_THRESHOLD) return 'filling_fast';
  return 'open';
}

function toShowtime(row: ShowtimeRow): Showtime {
  return {
    id: row.id,
    movieId: row.movie_id,
    hallId: row.hall_id,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    format: row.format,
    prices: JSON.parse(row.prices) as Prices,
    currency: 'SYP',
  };
}

const ratio = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : 0);

/** Digits to look for in phone numbers when an admin search looks like a phone number, else null. */
function phoneQuery(q: string): string | null {
  const latin = q.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (!/^[\d\s+().-]+$/.test(latin)) return null;
  let digits = latin.replace(/\D/g, '');
  if (digits.startsWith('00963')) digits = digits.slice(5);
  else if (digits.startsWith('963')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.length >= 3 ? digits : null;
}

const STATS_COLUMNS = `
  s.id, s.movie_id, s.hall_id, s.date, s.starts_at, s.ends_at, s.format, s.prices,
  (SELECT COUNT(*) FROM booking_seats b WHERE b.showtime_id = s.id AND b.active = 1) AS booked,
  (SELECT COUNT(*) FROM holds h WHERE h.showtime_id = s.id AND h.expires_at > :now) AS held`;

function prepareStatements(db: DatabaseSync) {
  const sql = (text: string): StatementSync => db.prepare(text);
  return {
    showtime: sql('SELECT * FROM showtimes WHERE id = ?'),
    showtimeStats: sql(`SELECT ${STATS_COLUMNS} FROM showtimes s WHERE s.id = :id`),
    upcomingStats: sql(`
      SELECT * FROM (
        SELECT ${STATS_COLUMNS}, hl.sort_order AS hall_order,
          ROW_NUMBER() OVER (PARTITION BY s.movie_id ORDER BY s.starts_at, hl.sort_order) AS rn
        FROM showtimes s JOIN halls hl ON hl.id = s.hall_id
        WHERE s.starts_at > :now AND hl.active = 1
      ) WHERE rn <= :limit
      ORDER BY movie_id, starts_at, hall_order`),
    // Customer listings skip halls no longer in shared/halls.ts (their old showtimes stay reachable by id).
    movieDayStats: sql(`
      SELECT ${STATS_COLUMNS} FROM showtimes s JOIN halls hl ON hl.id = s.hall_id
      WHERE s.movie_id = :movieId AND s.date >= :from AND s.date <= :to AND hl.active = 1
      ORDER BY s.starts_at, hl.sort_order`),
    dayStats: sql(`
      SELECT ${STATS_COLUMNS},
        (SELECT COALESCE(SUM(b.price), 0) FROM booking_seats b WHERE b.showtime_id = s.id AND b.active = 1) AS revenue
      FROM showtimes s JOIN halls hl ON hl.id = s.hall_id
      WHERE s.date = :date
      ORDER BY s.starts_at, hl.sort_order`),
    dayBookingCounts: sql(`
      SELECT COUNT(*) AS bookings, COALESCE(SUM(b.status = 'checked_in'), 0) AS checked_in
      FROM bookings b JOIN showtimes s ON s.id = b.showtime_id
      WHERE s.date = ? AND b.status <> 'cancelled'`),

    bookedSeats: sql('SELECT seat_id FROM booking_seats WHERE showtime_id = ? AND active = 1'),
    liveHolds: sql('SELECT seat_id, session_id, expires_at FROM holds WHERE showtime_id = ? AND expires_at > ?'),
    seatBooked: sql('SELECT 1 AS hit FROM booking_seats WHERE showtime_id = ? AND seat_id = ? AND active = 1'),
    holdOf: sql('SELECT seat_id, session_id, expires_at FROM holds WHERE showtime_id = ? AND seat_id = ?'),
    sessionHolds: sql(
      'SELECT seat_id, session_id, expires_at FROM holds WHERE showtime_id = ? AND session_id = ? AND expires_at > ?',
    ),
    upsertHold: sql(`
      INSERT INTO holds (showtime_id, seat_id, session_id, expires_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (showtime_id, seat_id) DO UPDATE SET session_id = excluded.session_id, expires_at = excluded.expires_at`),
    slideHolds: sql('UPDATE holds SET expires_at = ? WHERE showtime_id = ? AND session_id = ? AND expires_at > ?'),
    releaseHold: sql('DELETE FROM holds WHERE showtime_id = ? AND seat_id = ? AND session_id = ? RETURNING seat_id'),
    releaseSessionHolds: sql('DELETE FROM holds WHERE showtime_id = ? AND session_id = ? RETURNING seat_id'),
    sweepHolds: sql('DELETE FROM holds WHERE expires_at <= ? RETURNING showtime_id, seat_id'),

    bookedAmong: sql(
      'SELECT seat_id FROM booking_seats WHERE showtime_id = ? AND active = 1 AND seat_id IN (SELECT value FROM json_each(?))',
    ),
    heldByOthersAmong: sql(`
      SELECT seat_id FROM holds
      WHERE showtime_id = ? AND expires_at > ? AND session_id <> ? AND seat_id IN (SELECT value FROM json_each(?))`),
    deleteHoldsOn: sql('DELETE FROM holds WHERE showtime_id = ? AND seat_id IN (SELECT value FROM json_each(?))'),
    codeExists: sql('SELECT 1 AS hit FROM bookings WHERE code = ?'),
    insertBooking: sql(`
      INSERT INTO bookings (code, showtime_id, session_id, status, customer_name, customer_phone, payment_method,
        payment_status, total, currency, seeded, created_at, cancelled_at, checked_in_at)
      VALUES (?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, 'SYP', 0, ?, NULL, NULL)`),
    insertSeat: sql(`
      INSERT INTO booking_seats (booking_code, showtime_id, seat_id, row_label, seat_number, seat_type, price, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)`),
    bookingByCode: sql('SELECT * FROM bookings WHERE code = ?'),
    bookingsBySession: sql('SELECT * FROM bookings WHERE session_id = ? ORDER BY created_at DESC, code DESC'),
    seatsOfBookings: sql(`
      SELECT * FROM booking_seats WHERE booking_code IN (SELECT value FROM json_each(?))
      ORDER BY booking_code, length(row_label), row_label, seat_number`),
    showtimesIn: sql('SELECT * FROM showtimes WHERE id IN (SELECT value FROM json_each(?))'),
    cancelBooking: sql("UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE code = ? AND status = 'confirmed'"),
    releaseBookingSeats: sql('UPDATE booking_seats SET active = 0 WHERE booking_code = ? AND active = 1 RETURNING seat_id'),
    checkIn: sql(`
      UPDATE bookings SET status = 'checked_in', checked_in_at = ?, payment_status = 'paid'
      WHERE code = ? AND status = 'confirmed'`),
    counts: sql(`
      SELECT (SELECT COUNT(*) FROM showtimes) AS showtimes,
        (SELECT COUNT(*) FROM bookings WHERE status <> 'cancelled') AS bookings,
        (SELECT COUNT(*) FROM booking_seats WHERE active = 1) AS seats`),
  };
}

type Statements = ReturnType<typeof prepareStatements>;

// ───────────────────────────── Service ─────────────────────────────

export interface BookingServiceOptions {
  db: DatabaseSync;
  hub: LiveHub;
  now?: () => number;
  holdMinutes?: number;
  adminPin?: string;
  /** Seed demo bookings into newly generated showtimes (and on reset). */
  seedBookings?: boolean;
}

export interface AdminBookingQuery {
  date?: string;
  q?: string;
  limit?: number;
}

export class BookingService {
  readonly db: DatabaseSync;
  readonly now: () => number;
  readonly holdMinutes: number;
  readonly seedBookings: boolean;
  private readonly hub: LiveHub;
  private readonly sql: Statements;
  private readonly adminPinDigest: Buffer;
  private readonly searchStatements = new Map<string, StatementSync>();
  private catalogState: CatalogRuntime;
  private scheduleCheckedAt = Number.NEGATIVE_INFINITY;
  private scheduleCheckedFor = '';

  constructor(options: BookingServiceOptions) {
    this.db = options.db;
    this.hub = options.hub;
    this.now = options.now ?? Date.now;
    this.holdMinutes = options.holdMinutes ?? DEFAULT_HOLD_MINUTES;
    this.seedBookings = options.seedBookings ?? true;
    this.adminPinDigest = createHash('sha256').update(options.adminPin ?? '').digest();
    if (!(this.holdMinutes > 0)) throw new Error('holdMinutes must be positive');

    syncCatalog(this.db);
    this.catalogState = loadCatalog(this.db);
    this.sql = prepareStatements(this.db);
    this.ensureSchedule(true);
  }

  get catalog(): CatalogRuntime {
    return this.catalogState;
  }

  serverTime(): string {
    return iso(this.now());
  }

  /** Showtime, live booking and seat totals (for the start-up banner and scripts). */
  counts(): { showtimes: number; bookings: number; seats: number } {
    return this.sql.counts.get() as unknown as { showtimes: number; bookings: number; seats: number };
  }

  /**
   * Rolls the schedule window forward: makes sure today … today + 6 have showtimes. Cheap enough to
   * call on every catalogue request; it only touches the database once a minute or on a new day.
   */
  ensureSchedule(force = false): ScheduleSummary | null {
    const now = this.now();
    const today = cinemaDate(now);
    if (!force && today === this.scheduleCheckedFor && Math.abs(now - this.scheduleCheckedAt) < SCHEDULE_CHECK_INTERVAL_MS) {
      return null;
    }
    this.scheduleCheckedAt = now;
    this.scheduleCheckedFor = today;
    return ensureScheduleWindow(this.db, this.catalogState, now, { seedBookings: this.seedBookings });
  }

  // ───────────── Catalogue ─────────────

  health(): { ok: true; serverTime: string } {
    return { ok: true, serverTime: this.serverTime() };
  }

  listMovies(): { movies: MovieWithShowtimes[]; serverTime: string } {
    this.ensureSchedule();
    const now = this.now();
    const upcoming = this.sql.upcomingStats.all({ now, limit: NEXT_SHOWTIMES_PER_MOVIE }) as unknown as ShowtimeStatsRow[];
    const byMovie = new Map<string, ShowtimeSummary[]>();
    for (const row of upcoming) {
      const list = byMovie.get(row.movie_id) ?? [];
      list.push(this.summary(row, now));
      byMovie.set(row.movie_id, list);
    }
    const movies = [...this.catalogState.activeMovies].sort(this.compareMovies).map(
      (movie): MovieWithShowtimes => ({
        ...movie,
        nextShowtimes: movie.status === 'now_showing' ? (byMovie.get(movie.id) ?? []) : [],
      }),
    );
    return { movies, serverTime: iso(now) };
  }

  getMovie(movieId: string): { movie: Movie; days: ScheduleDay[]; serverTime: string } {
    this.ensureSchedule();
    const movie = this.catalogState.movieOrder.has(movieId) ? this.catalogState.movies.get(movieId) : undefined;
    if (!movie) throw notFound(`No film with id "${movieId}"`);
    const now = this.now();
    const dates = scheduleWindow(now);
    const days: ScheduleDay[] = dates.map((date) => ({ date, showtimes: [] }));
    const byDate = new Map(days.map((day) => [day.date, day.showtimes]));
    const rows = this.sql.movieDayStats.all({ movieId, from: dates[0], to: dates[dates.length - 1], now }) as unknown as ShowtimeStatsRow[];
    for (const row of rows) byDate.get(row.date)?.push(this.summary(row, now));
    return { movie, days, serverTime: iso(now) };
  }

  listHalls(): { halls: HallSummary[] } {
    return { halls: this.catalogState.activeHalls.map((hall) => hall.summary) };
  }

  getShowtimeDetail(showtimeId: string, sessionId: string | null): ShowtimeDetail {
    const now = this.now();
    const row = this.sql.showtimeStats.get({ id: showtimeId, now }) as unknown as ShowtimeStatsRow | undefined;
    if (!row) throw notFound(`No showtime with id "${showtimeId}"`);
    const { seats, holdExpiresAt } = this.seatMap(showtimeId, sessionId, now);
    return {
      showtime: this.summary(row, now),
      movie: this.movieOf(row.movie_id),
      hall: this.hallOf(row.hall_id).hall,
      seats,
      holdExpiresAt: holdExpiresAt === null ? null : iso(holdExpiresAt),
      serverTime: iso(now),
    };
  }

  hasShowtime(showtimeId: string): boolean {
    return this.sql.showtime.get(showtimeId) !== undefined;
  }

  /** The first message of a live seat stream: the whole seat map as this session sees it. */
  seatSnapshot(showtimeId: string, sessionId: string | null): Extract<SeatStreamEvent, { type: 'snapshot' }> {
    if (!this.hasShowtime(showtimeId)) throw notFound(`No showtime with id "${showtimeId}"`);
    const now = this.now();
    const { seats, holdExpiresAt } = this.seatMap(showtimeId, sessionId, now);
    return { type: 'snapshot', seats, holdExpiresAt: holdExpiresAt === null ? null : iso(holdExpiresAt), serverTime: iso(now) };
  }

  // ───────────── Holds ─────────────

  holdSeat(showtimeId: string, seatId: string, sessionId: string): HoldResult {
    const now = this.now();
    const expiresAt = now + this.holdMinutes * 60_000;
    const { seatIds, fresh } = transaction(this.db, () => {
      const show = this.showtimeRow(showtimeId);
      const hall = this.hallOf(show.hall_id);
      if (!hall.geometry.seatById[seatId]) {
        throw new HttpError(404, 'SEAT_UNKNOWN', `${hall.definition.id} has no seat "${seatId}"`, { seatIds: [seatId] });
      }
      if (now >= show.starts_at) throw this.closedError();
      if (this.sql.seatBooked.get(showtimeId, seatId)) throw this.unavailableError([seatId]);
      const holder = this.sql.holdOf.get(showtimeId, seatId) as unknown as HoldRow | undefined;
      if (holder && holder.expires_at > now && holder.session_id !== sessionId) throw this.unavailableError([seatId]);

      const mine = (this.sql.sessionHolds.all(showtimeId, sessionId, now) as unknown as HoldRow[]).map((h) => h.seat_id);
      const alreadyMine = mine.includes(seatId);
      if (!alreadyMine && mine.length >= MAX_SEATS_PER_BOOKING) {
        throw new HttpError(409, 'SEAT_LIMIT', `At most ${MAX_SEATS_PER_BOOKING} seats can be held per showtime`, {
          max: MAX_SEATS_PER_BOOKING,
        });
      }
      this.sql.upsertHold.run(showtimeId, seatId, sessionId, expiresAt);
      // Sliding window: every live hold of this session on the showtime now expires together.
      this.sql.slideHolds.run(expiresAt, showtimeId, sessionId, now);
      return { seatIds: sortSeatIds(alreadyMine ? mine : [...mine, seatId]), fresh: !alreadyMine };
    });
    if (fresh) this.publish(showtimeId, [{ seatId, state: 'held', holder: sessionId }]);
    return { seatId, holdExpiresAt: iso(expiresAt), seatIds, serverTime: iso(now) };
  }

  /** Releases one seat. Idempotent: releasing a seat the session does not hold changes nothing. */
  releaseSeat(showtimeId: string, seatId: string, sessionId: string): ReleaseResult {
    const released = this.sql.releaseHold.all(showtimeId, seatId, sessionId) as unknown as Array<{ seat_id: string }>;
    if (released.length > 0) this.publish(showtimeId, [{ seatId, state: 'available' }]);
    return this.releaseResult(showtimeId, sessionId);
  }

  releaseAllSeats(showtimeId: string, sessionId: string): ReleaseResult {
    const released = this.sql.releaseSessionHolds.all(showtimeId, sessionId) as unknown as Array<{ seat_id: string }>;
    this.publish(
      showtimeId,
      sortSeatIds(released.map((r) => r.seat_id)).map((seatId) => ({ seatId, state: 'available' })),
    );
    return { seatIds: [], holdExpiresAt: null };
  }

  /** Deletes expired holds and tells the live streams those seats are free. Returns how many were removed. */
  sweepExpiredHolds(): number {
    const now = this.now();
    const expired = this.sql.sweepHolds.all(now) as unknown as Array<{ showtime_id: string; seat_id: string }>;
    if (expired.length === 0) return 0;
    const byShowtime = new Map<string, string[]>();
    for (const row of expired) byShowtime.set(row.showtime_id, [...(byShowtime.get(row.showtime_id) ?? []), row.seat_id]);
    for (const [showtimeId, seatIds] of byShowtime) {
      // Defensive: never announce a seat as free while a live booking holds it.
      const booked = new Set(
        (this.sql.bookedAmong.all(showtimeId, JSON.stringify(seatIds)) as unknown as Array<{ seat_id: string }>).map((r) => r.seat_id),
      );
      this.publish(
        showtimeId,
        sortSeatIds(seatIds.filter((id) => !booked.has(id))).map((seatId) => ({ seatId, state: 'available' })),
      );
    }
    return expired.length;
  }

  // ───────────── Bookings ─────────────

  createBooking(sessionId: string, request: BookingRequest): Booking {
    const phone = normalizeSyrianMobile(request.customer.phone);
    if (!phone) {
      throw new HttpError(400, 'VALIDATION', 'customer.phone is not a Syrian mobile number', { field: 'customer.phone' });
    }
    const seatIds = request.seatIds;
    if (seatIds.length > MAX_SEATS_PER_BOOKING) {
      throw new HttpError(409, 'SEAT_LIMIT', `At most ${MAX_SEATS_PER_BOOKING} seats can be booked at once`, {
        max: MAX_SEATS_PER_BOOKING,
      });
    }
    const now = this.now();
    const seatsJson = JSON.stringify(seatIds);
    let code: string;
    let showtimeId: string;
    try {
      ({ code, showtimeId } = transaction(this.db, () => {
        const show = this.showtimeRow(request.showtimeId);
        const hall = this.hallOf(show.hall_id);
        const unknown = seatIds.filter((id) => !hall.geometry.seatById[id]);
        if (unknown.length > 0) {
          throw new HttpError(404, 'SEAT_UNKNOWN', `${hall.definition.id} has no seat ${unknown.join(', ')}`, {
            seatIds: sortSeatIds(unknown),
          });
        }
        if (now >= show.starts_at) throw this.closedError();

        const taken = new Set<string>();
        for (const row of this.sql.bookedAmong.all(show.id, seatsJson) as unknown as Array<{ seat_id: string }>) taken.add(row.seat_id);
        for (const row of this.sql.heldByOthersAmong.all(show.id, now, sessionId, seatsJson) as unknown as Array<{ seat_id: string }>) {
          taken.add(row.seat_id);
        }
        if (taken.size > 0) throw this.unavailableError([...taken]);

        const prices = JSON.parse(show.prices) as Prices;
        const seats = seatIds.map((id) => {
          const seat = hall.geometry.seatById[id];
          const price = prices[seat.type];
          if (price === undefined) throw new Error(`Showtime ${show.id} has no price for ${seat.type} seats`);
          return { seat, price };
        });
        const total = seats.reduce((sum, { price }) => sum + price, 0);
        const bookingCode = this.newBookingCode();
        const paymentStatus: PaymentStatus = request.paymentMethod === 'online_demo' ? 'paid' : 'due';
        this.sql.insertBooking.run(
          bookingCode,
          show.id,
          sessionId,
          request.customer.name,
          phone,
          request.paymentMethod,
          paymentStatus,
          total,
          now,
        );
        for (const { seat, price } of seats) {
          this.sql.insertSeat.run(bookingCode, show.id, seat.id, seat.row, seat.number, seat.type, price);
        }
        // The caller's holds on these seats are consumed (and any expired leftovers tidied away).
        this.sql.deleteHoldsOn.run(show.id, seatsJson);
        return { code: bookingCode, showtimeId: show.id };
      }));
    } catch (error) {
      // Only reachable if another process booked the same seat in between: the unique index said no.
      if (isUniqueViolation(error)) throw this.unavailableError(seatIds);
      throw error;
    }
    this.publish(
      showtimeId,
      sortSeatIds(seatIds).map((seatId) => ({ seatId, state: 'booked' })),
    );
    return this.bookingByCode(code);
  }

  /** Bookings created by a session, newest first, cancelled ones included. */
  myBookings(sessionId: string): Booking[] {
    return this.hydrate(this.sql.bookingsBySession.all(sessionId) as unknown as BookingRow[]);
  }

  /** Looks a booking up by its reference (any case, with or without "CC-"). */
  findBooking(code: string): Booking {
    return this.bookingByCode(this.canonicalCode(code));
  }

  /** Customer cancellation: only the creating session, only while confirmed and before the show starts. */
  cancelBooking(code: string, sessionId: string): Booking {
    const canonical = this.canonicalCode(code);
    const now = this.now();
    const { showtimeId, seatIds } = transaction(this.db, () => {
      const row = this.sql.bookingByCode.get(canonical) as unknown as BookingRow | undefined;
      // Someone else's booking looks exactly like a missing one, so references cannot be probed.
      if (!row || row.session_id !== sessionId) throw notFound(`No booking ${canonical}`);
      if (row.status !== 'confirmed') {
        throw new HttpError(409, 'BOOKING_NOT_CANCELLABLE', `Booking ${canonical} is ${row.status.replace('_', ' ')}`);
      }
      if (now >= this.showtimeRow(row.showtime_id).starts_at) {
        throw new HttpError(409, 'BOOKING_NOT_CANCELLABLE', 'The show has already started');
      }
      return this.cancelRow(row, now);
    });
    this.publish(
      showtimeId,
      seatIds.map((seatId) => ({ seatId, state: 'available' })),
    );
    return this.bookingByCode(canonical);
  }

  // ───────────── Admin ─────────────

  /** Constant-time comparison with the configured PIN. */
  isAdminPin(pin: unknown): boolean {
    if (typeof pin !== 'string' || pin.length === 0) return false;
    return timingSafeEqual(createHash('sha256').update(pin).digest(), this.adminPinDigest);
  }

  adminOverview(date?: string): AdminOverview {
    this.ensureSchedule();
    const now = this.now();
    const day = date ?? cinemaDate(now);
    const rows = this.sql.dayStats.all({ date: day, now }) as unknown as AdminShowtimeStatsRow[];
    const showtimes = rows.map((row): AdminShowtimeRow => {
      const summary = this.summary(row, now);
      return {
        ...summary,
        movieTitle: this.movieOf(row.movie_id).title,
        seatsBooked: row.booked,
        seatsHeld: row.held,
        revenue: row.revenue,
        occupancy: ratio(row.booked, summary.seatsTotal),
      };
    });
    const counts = this.sql.dayBookingCounts.get(day) as unknown as { bookings: number; checked_in: number };
    const sum = (pick: (row: AdminShowtimeRow) => number): number => showtimes.reduce((total, row) => total + pick(row), 0);
    const tickets = sum((row) => row.seatsBooked);
    return {
      date: day,
      totals: {
        bookings: counts.bookings,
        tickets,
        revenue: sum((row) => row.revenue),
        occupancy: ratio(tickets, sum((row) => row.seatsTotal)),
        checkedIn: counts.checked_in,
        seatsHeldNow: sum((row) => row.seatsHeld),
      },
      showtimes,
      currency: 'SYP',
      serverTime: iso(now),
    };
  }

  /** Newest first. `q` matches the reference, the customer name or the phone number. */
  adminBookings(query: AdminBookingQuery = {}): { bookings: AdminBookingRow[]; total: number } {
    const limit = Math.min(ADMIN_PAGE_MAX, Math.max(1, Math.trunc(query.limit ?? ADMIN_PAGE_DEFAULT)));
    const where: string[] = [];
    const params: Params = {};
    if (query.date) {
      where.push('s.date = :date');
      params.date = query.date;
    }
    const q = normalizeName(query.q ?? '');
    if (q) {
      const clauses = ['instr(b.code, :code) > 0', 'instr(lower(b.customer_name), :name) > 0'];
      params.code = q.toUpperCase();
      params.name = q.toLowerCase();
      const digits = phoneQuery(q);
      if (digits) {
        clauses.push('instr(b.customer_phone, :phone) > 0');
        params.phone = digits;
      }
      where.push(`(${clauses.join(' OR ')})`);
    }
    const from = `FROM bookings b JOIN showtimes s ON s.id = b.showtime_id${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
    const { n: total } = this.search(`SELECT COUNT(*) AS n ${from}`).get(params) as unknown as { n: number };
    const rows = this.search(`SELECT b.* ${from} ORDER BY b.created_at DESC, b.code DESC LIMIT :limit`).all({
      ...params,
      limit,
    }) as unknown as BookingRow[];
    const seeded = new Map(rows.map((row) => [row.code, row.seeded === 1]));
    const bookings = this.hydrate(rows).map((booking): AdminBookingRow => ({ ...booking, seeded: seeded.get(booking.code) ?? false }));
    return { bookings, total };
  }

  /** Admission at the door: confirmed → checked in; a box-office booking is paid now. */
  checkIn(code: string): Booking {
    const canonical = this.canonicalCode(code);
    const now = this.now();
    transaction(this.db, () => {
      const row = this.sql.bookingByCode.get(canonical) as unknown as BookingRow | undefined;
      if (!row) throw notFound(`No booking ${canonical}`);
      if (row.status !== 'confirmed') {
        // The status lets the door staff tell "already admitted" apart from "cancelled".
        throw new HttpError(409, 'BOOKING_NOT_CHECKINABLE', `Booking ${canonical} is ${row.status.replace('_', ' ')}`, {
          status: row.status,
        });
      }
      this.sql.checkIn.run(now, canonical);
    });
    return this.bookingByCode(canonical);
  }

  /** Staff cancellation: any confirmed booking, even after the show has started. */
  adminCancel(code: string): Booking {
    const canonical = this.canonicalCode(code);
    const now = this.now();
    const { showtimeId, seatIds } = transaction(this.db, () => {
      const row = this.sql.bookingByCode.get(canonical) as unknown as BookingRow | undefined;
      if (!row) throw notFound(`No booking ${canonical}`);
      if (row.status !== 'confirmed') {
        throw new HttpError(409, 'BOOKING_NOT_CANCELLABLE', `Booking ${canonical} is ${row.status.replace('_', ' ')}`);
      }
      return this.cancelRow(row, now);
    });
    this.publish(
      showtimeId,
      seatIds.map((seatId) => ({ seatId, state: 'available' })),
    );
    return this.bookingByCode(canonical);
  }

  /** Wipes holds, bookings and showtimes, re-reads films and halls from code and re-seeds the window. */
  resetDemo(): ScheduleSummary {
    const now = this.now();
    const { catalog, summary } = resetDemoData(this.db, now, { seedBookings: this.seedBookings });
    this.catalogState = catalog;
    this.scheduleCheckedAt = now;
    this.scheduleCheckedFor = cinemaDate(now);
    this.hub.publishReset(iso(now));
    return summary;
  }

  // ───────────── Internals ─────────────

  private readonly compareMovies = (a: Movie, b: Movie): number => {
    const group = (movie: Movie): number => (movie.status === 'now_showing' ? 0 : 1);
    if (group(a) !== group(b)) return group(a) - group(b);
    if (a.status === 'now_showing') {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      if (a.releaseDate !== b.releaseDate) return a.releaseDate < b.releaseDate ? 1 : -1; // newest first
    } else if (a.releaseDate !== b.releaseDate) {
      return a.releaseDate < b.releaseDate ? -1 : 1; // soonest first
    }
    const order = this.catalogState.movieOrder;
    return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  };

  private movieOf(id: string): Movie {
    const movie = this.catalogState.movies.get(id);
    if (!movie) throw new Error(`Film ${id} is missing from the catalogue`);
    return movie;
  }

  private hallOf(id: string): HallRuntime {
    const hall = this.catalogState.halls.get(id);
    if (!hall) throw new Error(`Hall ${id} is missing`);
    return hall;
  }

  private showtimeRow(id: string): ShowtimeRow {
    const row = this.sql.showtime.get(id) as unknown as ShowtimeRow | undefined;
    if (!row) throw notFound(`No showtime with id "${id}"`);
    return row;
  }

  private summary(row: ShowtimeStatsRow, now: number): ShowtimeSummary {
    const hall = this.hallOf(row.hall_id);
    const seatsTotal = hall.geometry.seatCount;
    const seatsAvailable = Math.max(0, seatsTotal - row.booked - row.held);
    return {
      ...toShowtime(row),
      hall: hall.summary,
      seatsTotal,
      seatsAvailable,
      status: showtimeStatus(row.starts_at, seatsTotal, seatsAvailable, now),
    };
  }

  /** Unavailable seats as `sessionId` sees them, and when that session's holds lapse. */
  private seatMap(showtimeId: string, sessionId: string | null, now: number): { seats: SeatMap; holdExpiresAt: number | null } {
    const seats: SeatMap = {};
    for (const row of this.sql.bookedSeats.all(showtimeId) as unknown as Array<{ seat_id: string }>) seats[row.seat_id] = 'booked';
    let holdExpiresAt: number | null = null;
    for (const hold of this.sql.liveHolds.all(showtimeId, now) as unknown as HoldRow[]) {
      if (seats[hold.seat_id]) continue;
      if (sessionId !== null && hold.session_id === sessionId) {
        seats[hold.seat_id] = 'mine';
        holdExpiresAt = holdExpiresAt === null ? hold.expires_at : Math.min(holdExpiresAt, hold.expires_at);
      } else {
        seats[hold.seat_id] = 'held';
      }
    }
    return { seats, holdExpiresAt };
  }

  private releaseResult(showtimeId: string, sessionId: string): ReleaseResult {
    const holds = this.sql.sessionHolds.all(showtimeId, sessionId, this.now()) as unknown as HoldRow[];
    return {
      seatIds: sortSeatIds(holds.map((hold) => hold.seat_id)),
      holdExpiresAt: holds.length > 0 ? iso(Math.min(...holds.map((hold) => hold.expires_at))) : null,
    };
  }

  private publish(showtimeId: string, updates: SeatUpdate[]): void {
    if (updates.length > 0) this.hub.publishSeats(showtimeId, updates, this.serverTime());
  }

  private closedError(): HttpError {
    return new HttpError(409, 'SHOWTIME_CLOSED', 'The show has already started');
  }

  private unavailableError(seatIds: string[]): HttpError {
    const ids = sortSeatIds(new Set(seatIds));
    return new HttpError(409, 'SEAT_UNAVAILABLE', `Seat${ids.length > 1 ? 's' : ''} ${ids.join(', ')} not available`, {
      seatIds: ids,
    });
  }

  private canonicalCode(code: string): string {
    const canonical = normalizeBookingCode(code);
    if (!canonical) throw notFound(`No booking ${code}`);
    return canonical;
  }

  private newBookingCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = randomBookingCode();
      if (!this.sql.codeExists.get(code)) return code;
    }
    throw new Error('Could not generate a unique booking code');
  }

  /** Marks a confirmed booking cancelled and frees its seats. Call inside a transaction. */
  private cancelRow(row: BookingRow, now: number): { showtimeId: string; seatIds: string[] } {
    this.sql.cancelBooking.run(now, row.code);
    const freed = this.sql.releaseBookingSeats.all(row.code) as unknown as Array<{ seat_id: string }>;
    return { showtimeId: row.showtime_id, seatIds: sortSeatIds(freed.map((r) => r.seat_id)) };
  }

  private bookingByCode(code: string): Booking {
    const row = this.sql.bookingByCode.get(code) as unknown as BookingRow | undefined;
    if (!row) throw notFound(`No booking ${code}`);
    return this.hydrate([row])[0];
  }

  /** Builds complete Booking DTOs, fetching seats and showtimes for all rows in two queries. */
  private hydrate(rows: readonly BookingRow[]): Booking[] {
    if (rows.length === 0) return [];
    const seatRows = this.sql.seatsOfBookings.all(JSON.stringify(rows.map((row) => row.code))) as unknown as BookingSeatRow[];
    const seatsByCode = new Map<string, BookingSeatRow[]>();
    for (const seat of seatRows) {
      const list = seatsByCode.get(seat.booking_code) ?? [];
      list.push(seat);
      seatsByCode.set(seat.booking_code, list);
    }
    const showtimeIds = [...new Set(rows.map((row) => row.showtime_id))];
    const showtimes = new Map(
      (this.sql.showtimesIn.all(JSON.stringify(showtimeIds)) as unknown as ShowtimeRow[]).map((row) => [row.id, row]),
    );
    return rows.map((row): Booking => {
      const show = showtimes.get(row.showtime_id);
      if (!show) throw new Error(`Booking ${row.code} references a missing showtime`);
      return {
        code: row.code,
        status: row.status,
        createdAt: iso(row.created_at),
        cancelledAt: row.cancelled_at === null ? null : iso(row.cancelled_at),
        checkedInAt: row.checked_in_at === null ? null : iso(row.checked_in_at),
        showtime: toShowtime(show),
        movie: this.movieOf(show.movie_id),
        hall: this.hallOf(show.hall_id).summary,
        seats: (seatsByCode.get(row.code) ?? []).map((seat) => ({
          seatId: seat.seat_id,
          row: seat.row_label,
          number: seat.seat_number,
          type: seat.seat_type,
          price: seat.price,
        })),
        total: row.total,
        currency: 'SYP',
        customer: { name: row.customer_name, phone: row.customer_phone },
        payment: { method: row.payment_method, status: row.payment_status },
      };
    });
  }

  private search(text: string): StatementSync {
    let statement = this.searchStatements.get(text);
    if (!statement) {
      statement = this.db.prepare(text);
      this.searchStatements.set(text, statement);
    }
    return statement;
  }
}
