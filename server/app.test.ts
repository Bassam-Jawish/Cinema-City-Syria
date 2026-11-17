/**
 * Integration tests for the booking server: the HTTP API through supertest, the live seat stream
 * over a real socket, and the schedule / pricing / demo-data generators.
 *
 * Each test gets a fresh in-memory database, a clock that only moves when the test says so, and no
 * seeded bookings (every seat starts free).
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_PIN_HEADER, DEFAULT_HOLD_MINUTES, FILLING_FAST_THRESHOLD, MAX_SEATS_PER_BOOKING, SCHEDULE_DAYS, SESSION_HEADER } from '../shared/constants';
import { SEAT_TYPES, buildHallGeometry, type SeatType } from '../shared/hall';
import { HALLS } from '../shared/halls';
import { addDays, cinemaDate, cinemaDateTimeToUtc, cinemaMinutesOfDay } from '../shared/time';
import type {
  AdminBookingRow,
  AdminOverview,
  Booking,
  HoldResult,
  MovieWithShowtimes,
  ScheduleDay,
  SeatStreamEvent,
  ShowtimeDetail,
  ShowtimeSummary,
  Trailer,
} from '../shared/types';
import { createApp, type AppContext, type AppOptions } from './app';
import { BOOKING_CODE_ALPHABET } from './codes';
import { CATALOG } from './data/catalog';
import { PRICING, seatPrice, showtimePrices } from './data/pricing';
import { PROGRAMMES, canStartAt, planDay, showtimeIdFor } from './data/schedule';

// ───────────────────────────── Fixtures ─────────────────────────────

const TODAY = '2026-11-15'; // a Sunday
const START = cinemaDateTimeToUtc(TODAY, '12:00').getTime(); // before the first show of the day
const HOLD_MS = DEFAULT_HOLD_MINUTES * 60_000;
const PIN = '4321';
const ALICE = 'alice-session-0001';
const BOB = 'bob-session-000002';
const CAROL = 'carol-session-00003';

const HALL = HALLS[0];
const GEOMETRY = buildHallGeometry(HALL.layout);
const SLOTS = PROGRAMMES[HALL.id].slots;
/** Today's last show in the first hall: still open however far a test moves the clock within the day. */
const SHOW = showtimeIdFor(TODAY, HALL.id, SLOTS[SLOTS.length - 1]);
/** Today's first show in the first hall. */
const EARLY_SHOW = showtimeIdFor(TODAY, HALL.id, SLOTS[0]);
const EARLY_START = cinemaDateTimeToUtc(TODAY, SLOTS[0]).getTime();
const PREMIUM_SEATS = GEOMETRY.seats.filter((seat) => seat.type === 'premium').map((seat) => seat.id);
const STANDARD_SEATS = GEOMETRY.seats.filter((seat) => seat.type === 'standard').map((seat) => seat.id);

const seatTypesOf = (layout: (typeof HALLS)[number]['layout']): SeatType[] => {
  const geometry = buildHallGeometry(layout);
  return SEAT_TYPES.filter((type) => geometry.seatCountByType[type] > 0);
};
const SCHEDULE_HALLS = HALLS.map((hall) => ({ id: hall.id, seatTypes: seatTypesOf(hall.layout) }));
const MOVIES = new Map(CATALOG.map((movie) => [movie.id, movie]));

const SHOWTIME_KEYS = ['currency', 'endsAt', 'format', 'hallId', 'id', 'movieId', 'prices', 'startsAt'];
const SUMMARY_KEYS = [...SHOWTIME_KEYS, 'hall', 'seatsAvailable', 'seatsTotal', 'status'].sort();
const BOOKING_KEYS = [
  'cancelledAt',
  'checkedInAt',
  'code',
  'createdAt',
  'currency',
  'customer',
  'hall',
  'movie',
  'payment',
  'seats',
  'showtime',
  'status',
  'total',
];
const CODE_PATTERN = new RegExp(`^CC-[${BOOKING_CODE_ALPHABET}]{6}$`);

const iso = (ms: number): string => new Date(ms).toISOString();

let clock = START;
let ctx: AppContext;

function setup(options: Partial<AppOptions> = {}): AppContext {
  clock = START;
  ctx = createApp({
    db: ':memory:',
    now: () => clock,
    seedBookings: false,
    adminPin: PIN,
    log: false,
    sweepIntervalMs: 0,
    ...options,
  });
  return ctx;
}

beforeEach(() => {
  setup();
});
afterEach(() => {
  ctx.close();
});

const advance = (ms: number): void => {
  clock += ms;
};

interface CallOptions {
  session?: string;
  pin?: string;
  body?: object;
}

function call(method: 'get' | 'post' | 'delete', url: string, options: CallOptions = {}) {
  let req = request(ctx.app)[method](url);
  if (options.session) req = req.set(SESSION_HEADER, options.session);
  if (options.pin) req = req.set(ADMIN_PIN_HEADER, options.pin);
  if (options.body !== undefined) req = req.send(options.body);
  return req;
}

const detail = (session?: string, showtimeId = SHOW) => call('get', `/api/showtimes/${showtimeId}`, { session });
const hold = (session: string, seatId: string, showtimeId = SHOW) =>
  call('post', `/api/showtimes/${showtimeId}/holds`, { session, body: { seatId } });
const release = (session: string, seatId?: string, showtimeId = SHOW) =>
  call('delete', `/api/showtimes/${showtimeId}/holds${seatId ? `/${seatId}` : ''}`, { session });

interface BookingInput {
  showtimeId?: string;
  customer?: { name: string; phone: string };
  paymentMethod?: string;
  [key: string]: unknown;
}

const book = (session: string | undefined, seatIds: string[], input: BookingInput = {}) =>
  call('post', '/api/bookings', {
    session,
    body: {
      showtimeId: SHOW,
      seatIds,
      customer: { name: 'Rami Haddad', phone: '0944 123 456' },
      paymentMethod: 'box_office',
      ...input,
    },
  });

async function booked(session: string, seatIds: string[], input: BookingInput = {}): Promise<Booking> {
  const res = await book(session, seatIds, input);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.booking as Booking;
}

const adminGet = (url: string, pin = PIN) => call('get', url, { pin });
const adminPost = (url: string, pin = PIN) => call('post', url, { pin });

/** Today's showtimes of a hall, in start order (straight from the database). */
function showtimesOf(hallId: string, date = TODAY): Array<{ id: string; movie_id: string; starts_at: number }> {
  return ctx.db
    .prepare('SELECT id, movie_id, starts_at FROM showtimes WHERE hall_id = ? AND date = ? ORDER BY starts_at')
    .all(hallId, date) as unknown as Array<{ id: string; movie_id: string; starts_at: number }>;
}

// ───────────────────────────── Live stream helper ─────────────────────────────

interface EventStream {
  status: number;
  headers: http.IncomingHttpHeaders;
  raw: () => string;
  /** The next event (of `type`, skipping others), waiting up to 3 s. */
  next: (type?: SeatStreamEvent['type']) => Promise<SeatStreamEvent>;
  close: () => void;
}

function openStream(port: number, showtimeId: string, session?: string): Promise<EventStream> {
  const query = session ? `?session=${encodeURIComponent(session)}` : '';
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: `/api/showtimes/${encodeURIComponent(showtimeId)}/events${query}`, headers: { accept: 'text/event-stream' } },
      (res) => {
        let raw = '';
        let buffer = '';
        const events: SeatStreamEvent[] = [];
        let wake: (() => void) | null = null;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          raw += chunk;
          buffer += chunk;
          for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = frame
              .split('\n')
              .filter((line) => line.startsWith('data: '))
              .map((line) => line.slice(6))
              .join('\n');
            if (data) events.push(JSON.parse(data) as SeatStreamEvent);
          }
          wake?.();
        });
        const next = async (type?: SeatStreamEvent['type']): Promise<SeatStreamEvent> => {
          const deadline = Date.now() + 3000;
          for (;;) {
            while (events.length > 0) {
              const event = events.shift() as SeatStreamEvent;
              if (!type || event.type === type) return event;
            }
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error(`No ${type ?? ''} event within 3 s. Stream so far:\n${raw}`);
            await new Promise<void>((done) => {
              const timer = setTimeout(done, remaining);
              wake = () => {
                clearTimeout(timer);
                wake = null;
                done();
              };
            });
          }
        };
        resolve({ status: res.statusCode ?? 0, headers: res.headers, raw: () => raw, next, close: () => req.destroy() });
      },
    );
    req.on('error', reject);
  });
}

async function listen(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(ctx.app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        ctx.hub.closeAll();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

// ───────────────────────────── Catalogue ─────────────────────────────

describe('catalogue', () => {
  it('reports health with the server clock', async () => {
    const res = await call('get', '/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, serverTime: iso(START) });
  });

  it('lists now-showing films first (featured, then newest), then coming-soon films by release date', async () => {
    const res = await call('get', '/api/movies');
    expect(res.status).toBe(200);
    expect(res.body.serverTime).toBe(iso(START));
    const movies = res.body.movies as MovieWithShowtimes[];
    expect(movies.map((movie) => movie.id)).toEqual([
      // featured, newest release first
      'the-last-caravan',
      'the-silent-orbit',
      'jasmine-street',
      // the rest, newest release first (ties keep catalogue order)
      'rooftop-kings',
      'the-whisper-below',
      'iron-tide',
      'noor-and-the-paper-dragon',
      'midnight-in-aleppo',
      // coming soon, soonest release first
      'salt-and-thunder',
      'echoes-of-ugarit',
      'the-lantern-keeper',
    ]);

    for (const movie of movies) {
      const { nextShowtimes, ...film } = movie;
      expect(film).toEqual(MOVIES.get(movie.id));
      if (movie.status === 'coming_soon') {
        expect(nextShowtimes).toEqual([]);
        continue;
      }
      expect(nextShowtimes).toHaveLength(4);
      const starts = nextShowtimes.map((show) => show.startsAt);
      expect(starts).toEqual([...starts].sort());
      for (const show of nextShowtimes) {
        expect(Object.keys(show).sort()).toEqual(SUMMARY_KEYS);
        expect(show.movieId).toBe(movie.id);
        expect(Date.parse(show.startsAt)).toBeGreaterThan(START);
        expect(show.status).toBe('open');
      }
    }
  });

  it('drops started shows from nextShowtimes and keeps sold-out ones, flagged', async () => {
    const first = showtimesOf(HALL.id)[0];
    const before = (await call('get', '/api/movies')).body.movies as MovieWithShowtimes[];
    expect(before.find((m) => m.id === first.movie_id)?.nextShowtimes[0].id).toBe(first.id);

    // Fill another hall's next show completely, straight in the database.
    const other = HALLS[1];
    const target = showtimesOf(other.id)[0];
    ctx.db.prepare(
      `INSERT INTO bookings (code, showtime_id, session_id, status, customer_name, customer_phone, payment_method, payment_status, total, created_at)
       VALUES ('CC-FULL22', ?, NULL, 'confirmed', 'Test', '+963944000000', 'box_office', 'due', 0, ?)`,
    ).run(target.id, START);
    const insertSeat = ctx.db.prepare(
      `INSERT INTO booking_seats (booking_code, showtime_id, seat_id, row_label, seat_number, seat_type, price) VALUES ('CC-FULL22', ?, ?, ?, ?, ?, 0)`,
    );
    for (const seat of buildHallGeometry(other.layout).seats) insertSeat.run(target.id, seat.id, seat.row, seat.number, seat.type);

    clock = first.starts_at; // the first show of the day has just started
    const after = (await call('get', '/api/movies')).body.movies as MovieWithShowtimes[];
    expect(after.find((m) => m.id === first.movie_id)?.nextShowtimes.map((s) => s.id)).not.toContain(first.id);
    const soldOut = after.flatMap((m) => m.nextShowtimes).find((s) => s.id === target.id);
    expect(soldOut).toMatchObject({ status: 'sold_out', seatsAvailable: 0 });
  });

  it("gives a film exactly 7 days of showtimes, with today's started shows marked closed", async () => {
    const first = showtimesOf(HALL.id)[0];
    clock = first.starts_at + 30 * 60_000;
    const res = await call('get', `/api/movies/${first.movie_id}`);
    expect(res.status).toBe(200);
    expect(res.body.movie).toEqual(MOVIES.get(first.movie_id));
    expect(res.body.serverTime).toBe(iso(clock));
    const days = res.body.days as ScheduleDay[];
    expect(days.map((day) => day.date)).toEqual(Array.from({ length: SCHEDULE_DAYS }, (_, i) => addDays(TODAY, i)));
    for (const day of days) {
      const starts = day.showtimes.map((show) => show.startsAt);
      expect(starts).toEqual([...starts].sort());
      for (const show of day.showtimes) {
        expect(show.movieId).toBe(first.movie_id);
        expect(cinemaDate(show.startsAt)).toBe(day.date);
        expect(show.status).toBe(Date.parse(show.startsAt) <= clock ? 'closed' : 'open');
      }
    }
    expect(days[0].showtimes.find((show) => show.id === first.id)?.status).toBe('closed');

    const comingSoon = await call('get', '/api/movies/salt-and-thunder');
    expect(comingSoon.body.days).toHaveLength(SCHEDULE_DAYS);
    expect((comingSoon.body.days as ScheduleDay[]).every((day) => day.showtimes.length === 0)).toBe(true);

    const missing = await call('get', '/api/movies/no-such-film');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('lists the halls from shared/halls.ts', async () => {
    const res = await call('get', '/api/halls');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      halls: HALLS.map((hall) => ({
        id: hall.id,
        name: hall.name,
        kind: hall.kind,
        seatCount: buildHallGeometry(hall.layout).seatCount,
        features: hall.features,
      })),
    });
  });

  it('rolls the schedule window forward and keeps old showtimes', async () => {
    const count = (): number => (ctx.db.prepare('SELECT COUNT(*) AS n FROM showtimes').get() as { n: number }).n;
    const initial = count();
    const perDay = HALLS.reduce((sum, hall) => sum + PROGRAMMES[hall.id].slots.length, 0);
    expect(initial).toBe(SCHEDULE_DAYS * perDay);

    advance(24 * 60 * 60_000);
    const res = await call('get', `/api/movies/${showtimesOf(HALL.id)[0].movie_id}`);
    expect((res.body.days as ScheduleDay[])[0].date).toBe(addDays(TODAY, 1));
    expect((res.body.days as ScheduleDay[])[SCHEDULE_DAYS - 1].date).toBe(addDays(TODAY, SCHEDULE_DAYS));
    expect(count()).toBe(initial + perDay);
    expect(showtimesOf(HALL.id, TODAY)).toHaveLength(SLOTS.length); // yesterday's shows are still there
    expect(showtimesOf(HALL.id, addDays(TODAY, SCHEDULE_DAYS))).toHaveLength(SLOTS.length);
  });
});

// ───────────────────────────── Showtime detail ─────────────────────────────

describe('showtime detail', () => {
  it('returns the showtime, its film, the hall layout and an empty seat map', async () => {
    const res = await detail();
    expect(res.status).toBe(200);
    const body = res.body as ShowtimeDetail;
    expect(Object.keys(body).sort()).toEqual(['hall', 'holdExpiresAt', 'movie', 'seats', 'serverTime', 'showtime']);
    expect(body.hall).toEqual({
      id: HALL.id,
      name: HALL.name,
      kind: HALL.kind,
      seatCount: GEOMETRY.seatCount,
      features: HALL.features,
      layout: HALL.layout,
    });
    expect(Object.keys(body.showtime).sort()).toEqual(SUMMARY_KEYS);
    expect(body.showtime).toMatchObject({
      id: SHOW,
      hallId: HALL.id,
      seatsTotal: GEOMETRY.seatCount,
      seatsAvailable: GEOMETRY.seatCount,
      status: 'open',
      currency: 'SYP',
      startsAt: iso(cinemaDateTimeToUtc(TODAY, SLOTS[SLOTS.length - 1]).getTime()),
    });
    // Only the seat types this hall has are priced, from the pricing table.
    expect(body.showtime.prices).toEqual(showtimePrices(seatTypesOf(HALL.layout), { format: body.showtime.format }));
    expect(Object.keys(body.showtime.prices).sort()).toEqual(seatTypesOf(HALL.layout).sort());
    expect(body.movie).toEqual(MOVIES.get(body.showtime.movieId));
    expect(Date.parse(body.showtime.endsAt) - Date.parse(body.showtime.startsAt)).toBe(
      (body.movie.durationMin + 15) * 60_000,
    );
    expect(body.seats).toEqual({});
    expect(body.holdExpiresAt).toBeNull();
    expect(body.serverTime).toBe(iso(START));
  });

  it('answers 404 for an unknown showtime', async () => {
    const res = await detail(ALICE, 'st-19990101-hall-1-1200');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });
});

// ───────────────────────────── Holds ─────────────────────────────

describe('seat holds', () => {
  it("shows a hold as 'mine' to the holder and 'held' to everyone else", async () => {
    const res = await hold(ALICE, 'F12');
    expect(res.status).toBe(200);
    expect(res.body as HoldResult).toEqual({
      seatId: 'F12',
      holdExpiresAt: iso(START + HOLD_MS),
      seatIds: ['F12'],
      serverTime: iso(START),
    });

    const mine = (await detail(ALICE)).body as ShowtimeDetail;
    expect(mine.seats).toEqual({ F12: 'mine' });
    expect(mine.holdExpiresAt).toBe(iso(START + HOLD_MS));
    expect(mine.showtime.seatsAvailable).toBe(GEOMETRY.seatCount - 1);

    const theirs = (await detail(BOB)).body as ShowtimeDetail;
    expect(theirs.seats).toEqual({ F12: 'held' });
    expect(theirs.holdExpiresAt).toBeNull();
    expect(((await detail()).body as ShowtimeDetail).seats).toEqual({ F12: 'held' });
  });

  it('re-holding is idempotent and every hold slides to the newest expiry', async () => {
    expect((await hold(ALICE, 'A1')).status).toBe(200);
    advance(4 * 60_000);
    const again = await hold(ALICE, 'A1');
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ seatIds: ['A1'], holdExpiresAt: iso(clock + HOLD_MS) });

    advance(3 * 60_000);
    const second = await hold(ALICE, 'A2');
    expect(second.body).toMatchObject({ seatId: 'A2', seatIds: ['A1', 'A2'], holdExpiresAt: iso(clock + HOLD_MS) });

    // Without the slide A1 would have lapsed at +14 min; at +16 min both seats are still held.
    advance(9 * 60_000);
    const view = (await detail(ALICE)).body as ShowtimeDetail;
    expect(view.seats).toEqual({ A1: 'mine', A2: 'mine' });
    expect(view.holdExpiresAt).toBe(iso(START + 7 * 60_000 + HOLD_MS));
  });

  it('refuses a seat held by another session or already booked', async () => {
    await hold(ALICE, 'F12');
    const res = await hold(BOB, 'F12');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'SEAT_UNAVAILABLE', details: { seatIds: ['F12'] } });

    await booked(CAROL, ['F14']);
    const taken = await hold(ALICE, 'F14');
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('SEAT_UNAVAILABLE');
  });

  it(`refuses the ${MAX_SEATS_PER_BOOKING + 1}th seat with SEAT_LIMIT`, async () => {
    const seats = Array.from({ length: MAX_SEATS_PER_BOOKING + 1 }, (_, i) => `A${i + 1}`);
    for (const seat of seats.slice(0, MAX_SEATS_PER_BOOKING)) expect((await hold(ALICE, seat)).status).toBe(200);
    const res = await hold(ALICE, seats[MAX_SEATS_PER_BOOKING]);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'SEAT_LIMIT', details: { max: MAX_SEATS_PER_BOOKING } });

    // Re-holding one of the eight is fine, and other customers are not affected.
    const again = await hold(ALICE, 'A1');
    expect(again.status).toBe(200);
    expect(again.body.seatIds).toHaveLength(MAX_SEATS_PER_BOOKING);
    expect((await hold(BOB, seats[MAX_SEATS_PER_BOOKING])).status).toBe(200);
  });

  it('lets a hold lapse after the hold window, without waiting for the sweeper', async () => {
    await hold(ALICE, 'F12');
    advance(HOLD_MS - 1);
    expect(((await detail(BOB)).body as ShowtimeDetail).seats).toEqual({ F12: 'held' });

    advance(1);
    const forBob = (await detail(BOB)).body as ShowtimeDetail;
    expect(forBob.seats).toEqual({});
    expect(forBob.showtime.seatsAvailable).toBe(GEOMETRY.seatCount);
    const forAlice = (await detail(ALICE)).body as ShowtimeDetail;
    expect(forAlice.seats).toEqual({});
    expect(forAlice.holdExpiresAt).toBeNull();

    expect((await hold(BOB, 'F12')).status).toBe(200);
    expect(((await detail(ALICE)).body as ShowtimeDetail).seats).toEqual({ F12: 'held' });
    // The lapsed row was replaced by Bob's hold, so there is nothing left to sweep.
    expect(ctx.service.sweepExpiredHolds()).toBe(0);
  });

  it('releases one seat (idempotently) or all of them', async () => {
    for (const seat of ['A1', 'A2', 'A3']) await hold(ALICE, seat);

    const one = await release(ALICE, 'A2');
    expect(one.status).toBe(200);
    expect(one.body).toEqual({ seatIds: ['A1', 'A3'], holdExpiresAt: iso(START + HOLD_MS) });
    expect((await release(ALICE, 'A2')).body).toEqual({ seatIds: ['A1', 'A3'], holdExpiresAt: iso(START + HOLD_MS) });

    // Bob cannot release Alice's seat; for him it is a no-op.
    expect((await release(BOB, 'A1')).body).toEqual({ seatIds: [], holdExpiresAt: null });
    expect(((await detail(BOB)).body as ShowtimeDetail).seats).toEqual({ A1: 'held', A3: 'held' });

    const all = await release(ALICE);
    expect(all.status).toBe(200);
    expect(all.body).toEqual({ seatIds: [], holdExpiresAt: null });
    expect(((await detail(ALICE)).body as ShowtimeDetail).seats).toEqual({});
  });

  it('answers SEAT_UNKNOWN, NOT_FOUND, SESSION_REQUIRED and VALIDATION', async () => {
    const unknownSeat = await hold(ALICE, 'Z99');
    expect(unknownSeat.status).toBe(404);
    expect(unknownSeat.body.error.code).toBe('SEAT_UNKNOWN');

    const unknownShow = await hold(ALICE, 'A1', 'st-19990101-hall-1-1200');
    expect(unknownShow.status).toBe(404);
    expect(unknownShow.body.error.code).toBe('NOT_FOUND');

    const noSession = await call('post', `/api/showtimes/${SHOW}/holds`, { body: { seatId: 'A1' } });
    expect(noSession.status).toBe(400);
    expect(noSession.body.error.code).toBe('SESSION_REQUIRED');
    expect((await hold('too-short', 'A1')).body.error.code).toBe('SESSION_REQUIRED');
    expect((await release('bad session id with spaces')).body.error.code).toBe('SESSION_REQUIRED');

    const badBody = await call('post', `/api/showtimes/${SHOW}/holds`, { session: ALICE, body: { seat: 'A1' } });
    expect(badBody.status).toBe(400);
    expect(badBody.body.error.code).toBe('VALIDATION');
    expect(badBody.body.error.details).toEqual([{ path: ['seatId'], message: expect.any(String) }]);

    const malformed = await request(ctx.app)
      .post(`/api/showtimes/${SHOW}/holds`)
      .set(SESSION_HEADER, ALICE)
      .set('Content-Type', 'application/json')
      .send('{"seatId": ');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION');
  });

  it('refuses holds once the show has started', async () => {
    clock = EARLY_START;
    const res = await hold(ALICE, 'A1', EARLY_SHOW);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SHOWTIME_CLOSED');
    expect(((await detail(ALICE, EARLY_SHOW)).body as ShowtimeDetail).showtime.status).toBe('closed');
  });
});

// ───────────────────────────── Bookings ─────────────────────────────

describe('bookings', () => {
  it('books held and free seats atomically, priced by the server', async () => {
    const [premiumA, premiumB] = PREMIUM_SEATS;
    const standard = STANDARD_SEATS[0];
    await hold(ALICE, premiumA);
    await hold(ALICE, premiumB);

    const res = await book(ALICE, [premiumB, standard, premiumA], {
      customer: { name: '  رامي    حداد ', phone: '٠٩٤٤ ١٢٣ ٤٥٦' },
      total: 1, // a client-sent total is ignored
    });
    expect(res.status).toBe(201);
    const booking = res.body.booking as Booking;
    expect(Object.keys(booking).sort()).toEqual(BOOKING_KEYS);
    expect(booking.code).toMatch(CODE_PATTERN);
    expect(booking).toMatchObject({
      status: 'confirmed',
      createdAt: iso(START),
      cancelledAt: null,
      checkedInAt: null,
      currency: 'SYP',
      customer: { name: 'رامي حداد', phone: '+963944123456' },
      payment: { method: 'box_office', status: 'due' },
      hall: { id: HALL.id, name: HALL.name, kind: HALL.kind, seatCount: GEOMETRY.seatCount, features: HALL.features },
    });
    expect(Object.keys(booking.showtime).sort()).toEqual([...SHOWTIME_KEYS].sort());
    expect(booking.showtime.id).toBe(SHOW);
    expect(booking.movie).toEqual(MOVIES.get(booking.showtime.movieId));

    const prices = booking.showtime.prices;
    const expectedSeats = [premiumA, premiumB, standard]
      .map((id) => GEOMETRY.seatById[id])
      .sort((a, b) => a.rowIndex - b.rowIndex || a.number - b.number)
      .map((seat) => ({ seatId: seat.id, row: seat.row, number: seat.number, type: seat.type, price: prices[seat.type] }));
    expect(booking.seats).toEqual(expectedSeats);
    expect(booking.total).toBe(2 * (prices.premium ?? 0) + (prices.standard ?? 0));

    // The holds were consumed; the seats are booked for everyone.
    const view = (await detail(ALICE)).body as ShowtimeDetail;
    expect(view.seats).toEqual({ [premiumA]: 'booked', [premiumB]: 'booked', [standard]: 'booked' });
    expect(view.holdExpiresAt).toBeNull();
    expect(view.showtime.seatsAvailable).toBe(GEOMETRY.seatCount - 3);
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM holds').get() as { n: number }).n).toBe(0);
  });

  it('marks an online (demo) payment as paid', async () => {
    const booking = await booked(ALICE, ['A1'], { paymentMethod: 'online_demo' });
    expect(booking.payment).toEqual({ method: 'online_demo', status: 'paid' });
  });

  it('rejects the whole booking when a seat is held by someone else', async () => {
    await hold(BOB, 'F12');
    const res = await book(ALICE, ['F11', 'F12']);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'SEAT_UNAVAILABLE', details: { seatIds: ['F12'] } });
    expect(((await detail(CAROL)).body as ShowtimeDetail).seats).toEqual({ F12: 'held' }); // F11 was not booked

    await booked(CAROL, ['F13']);
    const again = await book(ALICE, ['F13', 'F12', 'F11']);
    expect(again.body.error).toMatchObject({ code: 'SEAT_UNAVAILABLE', details: { seatIds: ['F12', 'F13'] } });
  });

  it('validates the request', async () => {
    const badPhone = await book(ALICE, ['A1'], { customer: { name: 'Rami Haddad', phone: '12345' } });
    expect(badPhone.status).toBe(400);
    expect(badPhone.body.error).toMatchObject({ code: 'VALIDATION', details: { field: 'customer.phone' } });

    const empty = await book(ALICE, []);
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION');
    expect(empty.body.error.details).toEqual([{ path: ['seatIds'], message: expect.any(String) }]);

    const duplicate = await book(ALICE, ['A1', 'A1']);
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error.code).toBe('VALIDATION');

    const tooMany = await book(ALICE, Array.from({ length: MAX_SEATS_PER_BOOKING + 1 }, (_, i) => `B${i + 1}`));
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.code).toBe('SEAT_LIMIT');

    const shortName = await book(ALICE, ['A1'], { customer: { name: '  R  ', phone: '0944123456' } });
    expect(shortName.status).toBe(400);
    expect(shortName.body.error.details).toEqual([{ path: ['customer', 'name'], message: expect.any(String) }]);
    const longName = await book(ALICE, ['A1'], { customer: { name: 'x'.repeat(61), phone: '0944123456' } });
    expect(longName.status).toBe(400);

    const badMethod = await book(ALICE, ['A1'], { paymentMethod: 'cash' });
    expect(badMethod.status).toBe(400);
    expect(badMethod.body.error.details[0].path).toEqual(['paymentMethod']);

    expect((await book(undefined, ['A1'])).body.error.code).toBe('SESSION_REQUIRED');
    expect((await book(ALICE, ['A1'], { showtimeId: 'st-19990101-hall-1-1200' })).body.error.code).toBe('NOT_FOUND');
    const unknownSeat = await book(ALICE, ['A1', 'Z99']);
    expect(unknownSeat.status).toBe(404);
    expect(unknownSeat.body.error).toMatchObject({ code: 'SEAT_UNKNOWN', details: { seatIds: ['Z99'] } });

    clock = EARLY_START + 60_000;
    const closed = await book(ALICE, ['A1'], { showtimeId: EARLY_SHOW });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('SHOWTIME_CLOSED');

    // Nothing above created a booking.
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM bookings').get() as { n: number }).n).toBe(0);
  });

  it("lists the session's own bookings, newest first, cancelled ones included", async () => {
    const first = await booked(ALICE, ['A1']);
    advance(60_000);
    const second = await booked(ALICE, ['A2']);
    await call('post', `/api/bookings/${first.code}/cancel`, { session: ALICE });
    await booked(BOB, ['A3']);

    const mine = await call('get', '/api/bookings', { session: ALICE });
    expect(mine.status).toBe(200);
    expect((mine.body.bookings as Booking[]).map((b) => [b.code, b.status])).toEqual([
      [second.code, 'confirmed'],
      [first.code, 'cancelled'],
    ]);
    expect((await call('get', '/api/bookings', { session: CAROL })).body).toEqual({ bookings: [] });
    expect((await call('get', '/api/bookings')).body.error.code).toBe('SESSION_REQUIRED');
  });

  it('looks a booking up by reference in any case, with or without the prefix', async () => {
    const booking = await booked(ALICE, ['A1']);
    const body = booking.code.slice(3);
    for (const ref of [booking.code, body, booking.code.toLowerCase(), body.toLowerCase()]) {
      const res = await call('get', `/api/bookings/${ref}`);
      expect(res.status, ref).toBe(200);
      expect(res.body).toEqual({ booking });
    }
    expect((await call('get', '/api/bookings/CC-222222')).status).toBe(404);
    expect((await call('get', '/api/bookings/not-a-code')).body.error.code).toBe('NOT_FOUND');
  });

  it('lets only the booking session cancel, before the show, once', async () => {
    const booking = await booked(ALICE, ['F12']);

    const stranger = await call('post', `/api/bookings/${booking.code}/cancel`, { session: BOB });
    expect(stranger.status).toBe(404);
    expect(stranger.body.error.code).toBe('NOT_FOUND');

    advance(5 * 60_000);
    const res = await call('post', `/api/bookings/${booking.code.toLowerCase()}/cancel`, { session: ALICE });
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ code: booking.code, status: 'cancelled', cancelledAt: iso(clock) });
    expect(((await detail(BOB)).body as ShowtimeDetail).seats).toEqual({});
    expect((await hold(BOB, 'F12')).status).toBe(200);

    const twice = await call('post', `/api/bookings/${booking.code}/cancel`, { session: ALICE });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('BOOKING_NOT_CANCELLABLE');
  });

  it('refuses a customer cancellation once the show has started', async () => {
    const booking = await booked(ALICE, ['A1'], { showtimeId: EARLY_SHOW });
    clock = EARLY_START;
    const res = await call('post', `/api/bookings/${booking.code}/cancel`, { session: ALICE });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BOOKING_NOT_CANCELLABLE');
  });
});

// ───────────────────────────── Admin ─────────────────────────────

describe('admin', () => {
  it('requires the staff PIN', async () => {
    for (const res of [await adminGet('/api/admin/overview', ''), await adminGet('/api/admin/overview', '0000')]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
    expect((await adminPost('/api/admin/reset', 'nope')).status).toBe(401);

    const wrong = await call('post', '/api/admin/login', { body: { pin: '0000' } });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('UNAUTHORIZED');
    const right = await call('post', '/api/admin/login', { body: { pin: PIN } });
    expect(right.status).toBe(200);
    expect(right.body).toEqual({ ok: true });
  });

  it('locks out an address after 10 wrong PINs in a minute', async () => {
    for (let i = 0; i < 10; i++) expect((await call('post', '/api/admin/login', { body: { pin: `${i}` } })).status).toBe(401);
    const locked = await call('post', '/api/admin/login', { body: { pin: PIN } });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('RATE_LIMITED');
    expect((await adminGet('/api/admin/overview')).status).toBe(429);
    // A made-up X-Forwarded-For does not buy a fresh allowance.
    const spoofed = await request(ctx.app).post('/api/admin/login').set('X-Forwarded-For', '203.0.113.9').send({ pin: PIN });
    expect(spoofed.status).toBe(429);

    advance(60_000);
    expect((await call('post', '/api/admin/login', { body: { pin: PIN } })).status).toBe(200);
  });

  it('reports the day: bookings, tickets, revenue, occupancy, check-ins and live holds', async () => {
    const alice = await booked(ALICE, ['F12', 'F13', 'A1']);
    const bob = await booked(BOB, ['B1', 'B2'], { paymentMethod: 'online_demo' });
    await hold(CAROL, 'C1');
    await adminPost(`/api/admin/bookings/${bob.code}/check-in`);

    const res = await adminGet('/api/admin/overview');
    expect(res.status).toBe(200);
    const overview = res.body as AdminOverview;
    const daySeats = HALLS.reduce(
      (sum, hall) => sum + PROGRAMMES[hall.id].slots.length * buildHallGeometry(hall.layout).seatCount,
      0,
    );
    expect(overview).toMatchObject({ date: TODAY, currency: 'SYP', serverTime: iso(START) });
    expect(overview.totals).toEqual({
      bookings: 2,
      tickets: 5,
      revenue: alice.total + bob.total,
      occupancy: Math.round((5 / daySeats) * 10_000) / 10_000,
      checkedIn: 1,
      seatsHeldNow: 1,
    });
    expect(overview.showtimes).toHaveLength(HALLS.reduce((sum, hall) => sum + PROGRAMMES[hall.id].slots.length, 0));
    const starts = overview.showtimes.map((show) => show.startsAt);
    expect(starts).toEqual([...starts].sort());
    const row = overview.showtimes.find((show) => show.id === SHOW);
    expect(row).toMatchObject({
      seatsBooked: 5,
      seatsHeld: 1,
      revenue: alice.total + bob.total,
      occupancy: Math.round((5 / GEOMETRY.seatCount) * 10_000) / 10_000,
      seatsAvailable: GEOMETRY.seatCount - 6,
      movieTitle: MOVIES.get(alice.showtime.movieId)?.title,
    });

    // Cancelled bookings drop out of the figures.
    await adminPost(`/api/admin/bookings/${alice.code}/cancel`);
    const after = (await adminGet('/api/admin/overview')).body as AdminOverview;
    expect(after.totals).toMatchObject({ bookings: 1, tickets: 2, revenue: bob.total, checkedIn: 1 });

    const tomorrow = (await adminGet(`/api/admin/overview?date=${addDays(TODAY, 1)}`)).body as AdminOverview;
    expect(tomorrow.date).toBe(addDays(TODAY, 1));
    expect(tomorrow.totals).toMatchObject({ bookings: 0, tickets: 0, revenue: 0, seatsHeldNow: 0 });
    for (const bad of ['2026-02-30', '15-11-2026', 'today']) {
      const res400 = await adminGet(`/api/admin/overview?date=${bad}`);
      expect(res400.status, bad).toBe(400);
      expect(res400.body.error.code).toBe('VALIDATION');
    }
  });

  it('checks a booking in once, collecting a box-office payment', async () => {
    const booking = await booked(ALICE, ['A1']);
    expect(booking.payment.status).toBe('due');
    advance(60_000);

    const res = await adminPost(`/api/admin/bookings/${booking.code.slice(3).toLowerCase()}/check-in`);
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({
      code: booking.code,
      status: 'checked_in',
      checkedInAt: iso(clock),
      payment: { method: 'box_office', status: 'paid' },
    });

    const twice = await adminPost(`/api/admin/bookings/${booking.code}/check-in`);
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('BOOKING_NOT_CHECKINABLE');
    expect(twice.body.error.details).toEqual({ status: 'checked_in' });
    expect((await adminPost(`/api/admin/bookings/${booking.code}/cancel`)).body.error.code).toBe('BOOKING_NOT_CANCELLABLE');

    const cancelled = await booked(BOB, ['A2']);
    await adminPost(`/api/admin/bookings/${cancelled.code}/cancel`);
    const refused = await adminPost(`/api/admin/bookings/${cancelled.code}/check-in`);
    expect(refused.body.error.code).toBe('BOOKING_NOT_CHECKINABLE');
    expect(refused.body.error.details).toEqual({ status: 'cancelled' });
    expect((await adminPost('/api/admin/bookings/CC-222222/check-in')).status).toBe(404);
  });

  it('cancels any confirmed booking, even after the show has started', async () => {
    const booking = await booked(ALICE, ['A1', 'A2'], { showtimeId: EARLY_SHOW });
    clock = EARLY_START + 20 * 60_000;
    const res = await adminPost(`/api/admin/bookings/${booking.code}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ status: 'cancelled', cancelledAt: iso(clock) });
    expect(((await detail(BOB, EARLY_SHOW)).body as ShowtimeDetail).seats).toEqual({});

    const twice = await adminPost(`/api/admin/bookings/${booking.code}/cancel`);
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('BOOKING_NOT_CANCELLABLE');
    expect((await adminPost('/api/admin/bookings/CC-222222/cancel')).status).toBe(404);
  });

  it('searches bookings by reference, name or phone, newest first', async () => {
    const rami = await booked(ALICE, ['A1'], { customer: { name: 'Rami Haddad', phone: '0944 123 456' } });
    advance(60_000);
    const lama = await booked(BOB, ['A2'], {
      customer: { name: 'لمى خوري', phone: '+963 955 000 111' },
      paymentMethod: 'online_demo',
    });

    const all = await adminGet('/api/admin/bookings');
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
    const rows = all.body.bookings as AdminBookingRow[];
    expect(rows.map((row) => row.code)).toEqual([lama.code, rami.code]);
    expect(rows[0]).toEqual({ ...lama, seeded: false });

    const codes = async (query: Record<string, string>): Promise<string[]> =>
      ((await request(ctx.app).get('/api/admin/bookings').set(ADMIN_PIN_HEADER, PIN).query(query)).body.bookings as AdminBookingRow[]).map(
        (row) => row.code,
      );
    expect(await codes({ q: rami.code.toLowerCase() })).toEqual([rami.code]);
    expect(await codes({ q: 'rami' })).toEqual([rami.code]);
    expect(await codes({ q: 'لمى' })).toEqual([lama.code]);
    expect(await codes({ q: '0955 000' })).toEqual([lama.code]);
    expect(await codes({ q: '944123' })).toEqual([rami.code]);
    expect(await codes({ date: addDays(TODAY, 1) })).toEqual([]);
    expect(await codes({ date: TODAY })).toEqual([lama.code, rami.code]);

    const page = await adminGet('/api/admin/bookings?limit=1');
    expect(page.body.total).toBe(2);
    expect(page.body.bookings).toHaveLength(1);
    expect((await adminGet('/api/admin/bookings?limit=abc')).status).toBe(400);
  });

  it('resets the demo: bookings and holds gone, schedule regenerated, streams told', async () => {
    const booking = await booked(ALICE, ['A1']);
    await hold(BOB, 'A2');
    const server = await listen();
    try {
      const stream = await openStream(server.port, SHOW, CAROL);
      expect((await stream.next()).type).toBe('snapshot');

      const res = await adminPost('/api/admin/reset');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(await stream.next()).toEqual({ type: 'reset', serverTime: iso(START) });

      expect((await call('get', `/api/bookings/${booking.code}`)).status).toBe(404);
      expect(((await detail(BOB)).body as ShowtimeDetail).seats).toEqual({});
      const perDay = HALLS.reduce((sum, hall) => sum + PROGRAMMES[hall.id].slots.length, 0);
      expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM showtimes').get() as { n: number }).n).toBe(SCHEDULE_DAYS * perDay);
      stream.close();
    } finally {
      await server.close();
    }
  });
});

// ───────────────────────────── Live seat stream ─────────────────────────────

describe('live seat stream', () => {
  it('sends a snapshot, then personalised seat changes', async () => {
    await hold(ALICE, 'A1');
    await booked(CAROL, ['A5']);
    const server = await listen();
    try {
      const alice = await openStream(server.port, SHOW, ALICE);
      const bob = await openStream(server.port, SHOW, BOB);
      expect(alice.status).toBe(200);
      expect(alice.headers['content-type']).toBe('text/event-stream; charset=utf-8');
      expect(alice.headers['cache-control']).toBe('no-cache, no-transform');
      expect(alice.headers['x-accel-buffering']).toBe('no');

      expect(await alice.next()).toEqual({
        type: 'snapshot',
        seats: { A1: 'mine', A5: 'booked' },
        holdExpiresAt: iso(START + HOLD_MS),
        serverTime: iso(START),
      });
      expect(await bob.next()).toEqual({
        type: 'snapshot',
        seats: { A1: 'held', A5: 'booked' },
        holdExpiresAt: null,
        serverTime: iso(START),
      });
      expect(alice.raw().startsWith('retry: 3000\n\n')).toBe(true);

      await hold(ALICE, 'F12');
      expect(await alice.next()).toEqual({ type: 'seats', changes: [{ seatId: 'F12', state: 'mine' }], serverTime: iso(START) });
      expect(await bob.next()).toEqual({ type: 'seats', changes: [{ seatId: 'F12', state: 'held' }], serverTime: iso(START) });

      await release(ALICE, 'A1');
      for (const stream of [alice, bob]) {
        expect(await stream.next()).toMatchObject({ type: 'seats', changes: [{ seatId: 'A1', state: 'available' }] });
      }

      await booked(ALICE, ['F12', 'F13']);
      const expected = { type: 'seats', changes: [{ seatId: 'F12', state: 'booked' }, { seatId: 'F13', state: 'booked' }] };
      expect(await alice.next()).toMatchObject(expected);
      expect(await bob.next()).toMatchObject(expected);
      expect(alice.raw()).not.toMatch(/^event:/m);

      alice.close();
      bob.close();
    } finally {
      await server.close();
    }
  });

  it('announces expired holds when the sweeper removes them', async () => {
    const server = await listen();
    try {
      const bob = await openStream(server.port, SHOW, BOB);
      await bob.next('snapshot');
      await hold(ALICE, 'B7');
      expect(await bob.next()).toMatchObject({ changes: [{ seatId: 'B7', state: 'held' }] });

      advance(HOLD_MS);
      expect(ctx.service.sweepExpiredHolds()).toBe(1);
      expect(await bob.next()).toEqual({ type: 'seats', changes: [{ seatId: 'B7', state: 'available' }], serverTime: iso(clock) });
      bob.close();
    } finally {
      await server.close();
    }
  });

  it('answers 404 JSON for an unknown showtime and forgets closed streams', async () => {
    const res = await request(ctx.app).get('/api/showtimes/st-19990101-hall-1-1200/events');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    const server = await listen();
    try {
      const stream = await openStream(server.port, SHOW);
      expect(await stream.next()).toMatchObject({ type: 'snapshot', seats: {}, holdExpiresAt: null });
      expect(ctx.hub.count(SHOW)).toBe(1);
      stream.close();
      for (let i = 0; i < 50 && ctx.hub.count(SHOW) > 0; i++) await new Promise((r) => setTimeout(r, 20));
      expect(ctx.hub.count(SHOW)).toBe(0);
    } finally {
      await server.close();
    }
  });
});

// ───────────────────────────── Generators ─────────────────────────────

describe('schedule and pricing', () => {
  it('plans each hall-day deterministically within the rating rules', () => {
    for (let offset = 0; offset < 60; offset++) {
      const date = addDays(TODAY, offset);
      const day = planDay(date, MOVIES, SCHEDULE_HALLS);
      expect(planDay(date, MOVIES, SCHEDULE_HALLS)).toEqual(day);
      for (const hall of HALLS) {
        expect(day.filter((show) => show.hallId === hall.id).map((show) => show.time)).toEqual(PROGRAMMES[hall.id].slots);
      }
      for (const show of day) {
        const movie = MOVIES.get(show.movieId);
        if (!movie) throw new Error(`unknown film ${show.movieId}`);
        expect(movie.status).toBe('now_showing');
        expect(PROGRAMMES[show.hallId].films).toContain(movie.id);
        expect(canStartAt(movie, show.startMinutes)).toBe(true);
        if (movie.rating === 'G' || movie.rating === 'PG') expect(show.startMinutes).toBeLessThan(21 * 60);
        if (movie.rating === '18+') expect(show.startMinutes).toBeGreaterThanOrEqual(18 * 60);
        if (show.format === '3D') expect(movie.formats).toContain('3D');
        expect(show.id).toBe(`st-${date.replaceAll('-', '')}-${show.hallId}-${show.time.replace(':', '')}`);
        expect(cinemaDate(show.startsAt)).toBe(date);
        expect(cinemaMinutesOfDay(show.startsAt)).toBe(show.startMinutes);
        expect(show.endsAt - show.startsAt).toBe((movie.durationMin + 15) * 60_000);
      }
    }
  });

  it('moves films around the day and alternates 3D, skipping unreleased films', () => {
    const week = Array.from({ length: 7 }, (_, i) => planDay(addDays(TODAY, i), MOVIES, SCHEDULE_HALLS)).flat();
    const caravanTimes = new Set(week.filter((show) => show.movieId === 'the-last-caravan').map((show) => show.time));
    expect(caravanTimes.size).toBeGreaterThan(1);
    const orbit = week.filter((show) => show.movieId === 'the-silent-orbit');
    expect(new Set(orbit.map((show) => show.format))).toEqual(new Set(['2D', '3D']));

    const release = MOVIES.get('rooftop-kings')?.releaseDate ?? '';
    expect(planDay(addDays(release, -1), MOVIES, SCHEDULE_HALLS).some((s) => s.movieId === 'rooftop-kings')).toBe(false);
    expect(planDay(release, MOVIES, SCHEDULE_HALLS).some((s) => s.movieId === 'rooftop-kings')).toBe(true);
  });

  it('prices every seat from the one pricing table', () => {
    for (const type of SEAT_TYPES) {
      expect(seatPrice(type, { format: '2D' })).toBe(PRICING.base[type]);
      const surcharge = PRICING.threeD.seatTypes.includes(type) ? PRICING.threeD.surcharge : 0;
      expect(seatPrice(type, { format: '3D' })).toBe(PRICING.base[type] + surcharge);
      expect(Number.isInteger(seatPrice(type, { format: '3D' }))).toBe(true);
    }
    expect(showtimePrices(['premium', 'standard'], { format: '2D' })).toEqual({
      standard: PRICING.base.standard,
      premium: PRICING.base.premium,
    });
    expect(PRICING.currency).toBe('SYP');
  });
});

describe('demo data', () => {
  type Row = Record<string, unknown>;
  const dump = (app: AppContext): { bookings: Row[]; seats: Row[] } => ({
    bookings: app.db.prepare('SELECT * FROM bookings ORDER BY code').all() as Row[],
    seats: app.db.prepare('SELECT * FROM booking_seats ORDER BY booking_code, seat_id').all() as Row[],
  });
  const seededApp = (now: number): AppContext =>
    createApp({ db: ':memory:', now: () => now, seedBookings: true, log: false, sweepIntervalMs: 0, adminPin: PIN });

  it('seeds every showtime of the window quickly, partially booked, deterministically', () => {
    const t0 = performance.now();
    const a = seededApp(START);
    const elapsed = performance.now() - t0;
    const b = seededApp(START);
    try {
      expect(elapsed).toBeLessThan(2000);

      const window = Array.from({ length: SCHEDULE_DAYS }, (_, i) => addDays(TODAY, i));
      const expectedIds = window.flatMap((date) => planDay(date, MOVIES, SCHEDULE_HALLS).map((show) => show.id)).sort();
      const stats = a.db
        .prepare(
          `SELECT s.id, s.hall_id, (SELECT COUNT(*) FROM booking_seats b WHERE b.showtime_id = s.id AND b.active = 1) AS booked
           FROM showtimes s ORDER BY s.id`,
        )
        .all() as unknown as Array<{ id: string; hall_id: string; booked: number }>;
      expect(stats.map((row) => row.id)).toEqual(expectedIds);
      const capacity = new Map(HALLS.map((hall) => [hall.id, buildHallGeometry(hall.layout).seatCount]));
      for (const row of stats) {
        expect(row.booked, row.id).toBeGreaterThan(0);
        expect(row.booked, row.id).toBeLessThan(capacity.get(row.hall_id) ?? 0);
      }
      // Nearer and later shows are fuller than far-off matinees.
      expect(new Set(stats.map((row) => row.booked)).size).toBeGreaterThan(10);

      // Today's 20:15 in Hall 1 is the showcase "filling fast" show.
      const showcase = a.service.getShowtimeDetail(showtimeIdFor(TODAY, 'hall-1', '20:15'), null).showtime;
      const taken = (showcase.seatsTotal - showcase.seatsAvailable) / showcase.seatsTotal;
      expect(showcase.status).toBe('filling_fast');
      expect(taken).toBeGreaterThanOrEqual(FILLING_FAST_THRESHOLD);
      expect(Math.abs(taken - 0.88)).toBeLessThan(0.01);

      expect(dump(b)).toEqual(dump(a));
    } finally {
      a.close();
      b.close();
    }
  });

  it('seeds plausible customers in contiguous seats, checked in for shows that have started', async () => {
    const now = cinemaDateTimeToUtc(TODAY, '21:00').getTime();
    const app = seededApp(now);
    try {
      const bookings = app.db
        .prepare('SELECT b.*, s.starts_at FROM bookings b JOIN showtimes s ON s.id = b.showtime_id')
        .all() as unknown as Array<{
        code: string;
        status: string;
        session_id: string | null;
        customer_name: string;
        customer_phone: string;
        payment_method: string;
        payment_status: string;
        seeded: number;
        total: number;
        created_at: number;
        checked_in_at: number | null;
        starts_at: number;
      }>;
      const seats = app.db.prepare('SELECT * FROM booking_seats ORDER BY booking_code, seat_number').all() as unknown as Array<{
        booking_code: string;
        row_label: string;
        seat_number: number;
        price: number;
      }>;
      const seatsByCode = new Map<string, typeof seats>();
      for (const seat of seats) seatsByCode.set(seat.booking_code, [...(seatsByCode.get(seat.booking_code) ?? []), seat]);

      let arabic = 0;
      let boxOffice = 0;
      let startedTotal = 0;
      let startedCheckedIn = 0;
      for (const b of bookings) {
        expect(b.code).toMatch(CODE_PATTERN);
        expect(b.seeded).toBe(1);
        expect(b.session_id).toBeNull();
        expect(b.customer_phone).toMatch(/^\+9639[345689]\d{7}$/);
        expect(b.customer_name.split(' ')).toHaveLength(2);
        if (/[؀-ۿ]/.test(b.customer_name)) arabic++;
        if (b.payment_method === 'box_office') boxOffice++;
        const reference = Math.min(b.starts_at, now);
        expect(b.created_at).toBeLessThanOrEqual(reference - 10 * 60_000);
        expect(b.created_at).toBeGreaterThanOrEqual(reference - 6 * 24 * 60 * 60_000 - 1000);

        const party = seatsByCode.get(b.code) ?? [];
        expect(party.length).toBeGreaterThanOrEqual(1);
        expect(party.length).toBeLessThanOrEqual(6);
        expect(new Set(party.map((seat) => seat.row_label)).size).toBe(1);
        party.forEach((seat, i) => expect(seat.seat_number).toBe(party[0].seat_number + i));
        expect(b.total).toBe(party.reduce((sum, seat) => sum + seat.price, 0));

        if (b.starts_at <= now) {
          startedTotal++;
          if (b.status === 'checked_in') {
            startedCheckedIn++;
            expect(b.payment_status).toBe('paid');
            expect(b.checked_in_at).not.toBeNull();
            expect(b.checked_in_at ?? 0).toBeLessThanOrEqual(now);
            expect(b.checked_in_at ?? 0).toBeGreaterThan(b.created_at);
          }
        } else {
          expect(b.status).toBe('confirmed');
          expect(b.payment_status).toBe(b.payment_method === 'online_demo' ? 'paid' : 'due');
        }
      }
      expect(arabic / bookings.length).toBeGreaterThan(0.6);
      expect(arabic / bookings.length).toBeLessThan(0.9);
      expect(boxOffice / bookings.length).toBeGreaterThan(0.6);
      expect(boxOffice / bookings.length).toBeLessThan(0.8);
      expect(startedTotal).toBeGreaterThan(50);
      expect(startedCheckedIn / startedTotal).toBeGreaterThan(0.75);
      expect(startedCheckedIn / startedTotal).toBeLessThan(0.95);

      // Seeded bookings are flagged for the staff screen.
      ctx.close();
      ctx = app;
      const listed = await adminGet('/api/admin/bookings?limit=3');
      expect((listed.body.bookings as AdminBookingRow[]).every((row) => row.seeded)).toBe(true);
      expect(listed.body.total).toBe(bookings.length);
    } finally {
      app.close();
    }
  });
});

// ───────────────────────────── HTTP plumbing ─────────────────────────────

// ───────────────────────────── Trailers ─────────────────────────────

/** The first bytes of real MP4 and WebM files, padded: enough for the server to recognise them. */
const MP4_BYTES = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(2048, 7)]);
const WEBM_BYTES = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(1024, 3)]);
const FILM = 'the-last-caravan';

function uploadTrailer(movieId: string, bytes: Buffer, { pin = PIN, type = 'video/mp4' }: { pin?: string | null; type?: string } = {}) {
  let req = request(ctx.app).post(`/api/admin/movies/${movieId}/trailer`).set('Content-Type', type);
  if (pin) req = req.set(ADMIN_PIN_HEADER, pin);
  return req.send(bytes);
}

const trailersFolder = () => ctx.trailersDir;
const filmTrailer = async (movieId = FILM) => (await call('get', `/api/movies/${movieId}`)).body.movie.trailer as Trailer | null;

describe('trailers', () => {
  it('lets staff upload a film trailer, which every film payload then carries and the hall can stream', async () => {
    expect(await filmTrailer()).toBeNull();
    expect((await uploadTrailer(FILM, MP4_BYTES, { pin: null })).status).toBe(401);
    expect((await uploadTrailer(FILM, MP4_BYTES, { pin: '0000' })).status).toBe(401);

    const res = await uploadTrailer(FILM, MP4_BYTES);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const trailer = res.body.trailer as Trailer;
    expect(trailer).toEqual({
      url: expect.stringMatching(new RegExp(`^/api/trailers/${FILM}\\.mp4\\?v=\\d+$`)),
      type: 'video/mp4',
      size: MP4_BYTES.length,
      updatedAt: expect.any(String),
    });

    // The film, its catalogue entry and the hall page all carry it.
    expect(await filmTrailer()).toEqual(trailer);
    const listed = ((await call('get', '/api/movies')).body.movies as MovieWithShowtimes[]).find((m) => m.id === FILM);
    expect(listed?.trailer).toEqual(trailer);
    const show = showtimesOf(HALL.id).find((row) => row.movie_id === FILM)!;
    expect((await detail(ALICE, show.id)).body.movie.trailer).toEqual(trailer);

    // Streamed whole, or in ranges so the player can start early and seek.
    const whole = await request(ctx.app).get(trailer.url).buffer(true).parse((r, done) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => done(null, Buffer.concat(chunks)));
    });
    expect(whole.status).toBe(200);
    expect(whole.headers['content-type']).toMatch(/^video\/mp4/);
    expect(whole.headers['cache-control']).toContain('immutable');
    expect(Buffer.compare(whole.body as Buffer, MP4_BYTES)).toBe(0);
    const part = await request(ctx.app).get(trailer.url).set('Range', 'bytes=4-11');
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 4-11/${MP4_BYTES.length}`);
  });

  it('replaces a trailer with one of another format, and removes it', async () => {
    const first = (await uploadTrailer(FILM, MP4_BYTES)).body.trailer as Trailer;
    const second = await uploadTrailer(FILM, WEBM_BYTES, { type: 'video/webm' });
    expect(second.status).toBe(201);
    expect(second.body.trailer).toMatchObject({ type: 'video/webm', size: WEBM_BYTES.length, url: expect.stringContaining(`${FILM}.webm?v=`) });
    expect((await request(ctx.app).get(first.url)).status).toBe(404);
    expect(readdirSync(trailersFolder()).sort()).toEqual([`${FILM}.webm`]);

    expect((await call('delete', `/api/admin/movies/${FILM}/trailer`)).status).toBe(401);
    const removed = await call('delete', `/api/admin/movies/${FILM}/trailer`, { pin: PIN });
    expect(removed.status).toBe(200);
    expect(await filmTrailer()).toBeNull();
    expect((await request(ctx.app).get((second.body.trailer as Trailer).url)).status).toBe(404);
    expect(readdirSync(trailersFolder())).toEqual([]);
  });

  it('refuses files that are not MP4 or WebM video, oversized files and unknown films, leaving nothing behind', async () => {
    const text = await uploadTrailer(FILM, Buffer.from('this is not a video'), { type: 'video/mp4' });
    expect(text.status).toBe(415);
    expect(text.body.error.code).toBe('UNSUPPORTED_FILE');
    expect((await uploadTrailer(FILM, Buffer.alloc(0))).body.error.code).toBe('UNSUPPORTED_FILE');
    expect((await uploadTrailer('no-such-film', MP4_BYTES)).status).toBe(404);
    expect(readdirSync(trailersFolder())).toEqual([]);

    ctx.close();
    setup({ trailerMaxBytes: 1024 });
    const big = await uploadTrailer(FILM, MP4_BYTES);
    expect(big.status).toBe(413);
    expect(big.body.error).toMatchObject({ code: 'FILE_TOO_LARGE', details: { maxBytes: 1024 } });
    expect(readdirSync(trailersFolder())).toEqual([]);
    expect(await filmTrailer()).toBeNull();
  });

  it('picks up trailer files already in the folder and keeps them through a demo reset', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccs-trailers-test-'));
    try {
      writeFileSync(path.join(dir, `${FILM}.webm`), WEBM_BYTES);
      writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
      writeFileSync(path.join(dir, '.upload-0000'), 'an interrupted upload');
      ctx.close();
      setup({ trailersDir: dir });
      expect(await filmTrailer()).toMatchObject({ type: 'video/webm', size: WEBM_BYTES.length });
      expect(readdirSync(dir).sort()).toEqual(['notes.txt', `${FILM}.webm`]);
      expect((await adminPost('/api/admin/reset')).status).toBe(200);
      expect(await filmTrailer()).toMatchObject({ type: 'video/webm' });
      // A folder the app was given is the caller's: close() leaves it alone.
      ctx.close();
      expect(readdirSync(dir)).toContain(`${FILM}.webm`);
      setup();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('http plumbing', () => {
  it('answers unknown API routes with NOT_FOUND JSON', async () => {
    const res = await call('get', '/api/no/such/route');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect((await call('post', '/api/movies')).status).toBe(404);
  });

  it('rate-limits mutating requests per session', async () => {
    ctx.close();
    setup({ rateLimit: { limit: 3, windowMs: 10_000 } });
    for (const seat of ['A1', 'A2', 'A3']) expect((await hold(ALICE, seat)).status).toBe(200);
    const limited = await hold(ALICE, 'A4');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBe('10');
    expect((await hold(BOB, 'A4')).status).toBe(200); // other sessions are unaffected
    advance(10_000);
    expect((await hold(ALICE, 'A5')).status).toBe(200);
  });

  it('serves the built client with an SPA fallback', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccs-dist-'));
    try {
      writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>CCS</title>');
      mkdirSync(path.join(dir, 'assets'));
      writeFileSync(path.join(dir, 'assets', 'app-1234.js'), 'console.log(1)');
      ctx.close();
      setup({ staticDir: dir });

      const home = await request(ctx.app).get('/').set('Accept', 'text/html');
      expect(home.status).toBe(200);
      expect(home.text).toContain('<title>CCS</title>');
      const deep = await request(ctx.app).get('/movies/the-last-caravan').set('Accept', 'text/html');
      expect(deep.status).toBe(200);
      expect(deep.headers['content-type']).toMatch(/text\/html/);
      const asset = await request(ctx.app).get('/assets/app-1234.js');
      expect(asset.status).toBe(200);
      expect(asset.headers['cache-control']).toContain('immutable');
      expect((await request(ctx.app).get('/posters/missing.svg').set('Accept', 'text/html,*/*')).status).toBe(404);
      const api = await request(ctx.app).get('/api/nope').set('Accept', 'text/html');
      expect(api.status).toBe(404);
      expect(api.body.error.code).toBe('NOT_FOUND');
    } finally {
      ctx.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sends no stack traces for unexpected errors', async () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      ctx.db.exec('DROP TABLE holds');
      const res = await detail(ALICE);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Internal server error' } });
      expect(errors).toHaveLength(1);
    } finally {
      console.error = original;
    }
  });

  it('includes no ShowtimeSummary fields in a booking showtime', async () => {
    const booking = await booked(ALICE, ['A1']);
    const extra = Object.keys(booking.showtime).filter((key) => !SHOWTIME_KEYS.includes(key));
    expect(extra).toEqual([]);
    const summary: Partial<ShowtimeSummary> = booking.showtime;
    expect(summary.seatsTotal).toBeUndefined();
  });
});
