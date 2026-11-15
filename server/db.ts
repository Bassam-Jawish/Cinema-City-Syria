/**
 * SQLite persistence (Node's built-in node:sqlite, synchronous API).
 *
 * Films and halls are stored as JSON rows that are re-synced from code on every start, so
 * server/data/catalog.ts and shared/halls.ts stay the source of truth. Showtimes, holds and
 * bookings are ordinary tables. Every instant is an epoch-millisecond integer.
 *
 * Two rules are enforced by the schema itself rather than by application code:
 *   - No double booking: booking_seats has a partial UNIQUE index on (showtime_id, seat_id)
 *     covering only active rows (active = 0 once a booking is cancelled).
 *   - One hold per seat: holds is keyed by (showtime_id, seat_id). A hold whose expires_at is
 *     in the past is treated as absent by every query; the sweeper only tidies such rows up.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS movies (
  id          TEXT PRIMARY KEY,
  data        TEXT NOT NULL,                      -- Movie (shared/types.ts) as JSON
  sort_order  INTEGER NOT NULL,                   -- position in server/data/catalog.ts
  active      INTEGER NOT NULL DEFAULT 1          -- 0 = no longer in the catalogue (kept for old bookings)
);

CREATE TABLE IF NOT EXISTS halls (
  id          TEXT PRIMARY KEY,
  data        TEXT NOT NULL,                      -- HallDefinition (shared/halls.ts) as JSON
  sort_order  INTEGER NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1
);

-- Calendar days whose showtimes have been generated. A day is generated once and never regenerated.
CREATE TABLE IF NOT EXISTS schedule_days (
  date          TEXT PRIMARY KEY,                 -- cinema calendar day, YYYY-MM-DD
  generated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS showtimes (
  id         TEXT PRIMARY KEY,                    -- st-YYYYMMDD-<hall>-HHMM
  movie_id   TEXT NOT NULL REFERENCES movies (id),
  hall_id    TEXT NOT NULL REFERENCES halls (id),
  date       TEXT NOT NULL,                       -- cinema calendar day of the start
  starts_at  INTEGER NOT NULL,
  ends_at    INTEGER NOT NULL,
  format     TEXT NOT NULL CHECK (format IN ('2D', '3D')),
  prices     TEXT NOT NULL                        -- Prices as JSON, fixed when the showtime is published
);
CREATE INDEX IF NOT EXISTS showtimes_by_movie ON showtimes (movie_id, starts_at);
CREATE INDEX IF NOT EXISTS showtimes_by_date ON showtimes (date, starts_at);
CREATE INDEX IF NOT EXISTS showtimes_by_start ON showtimes (starts_at);

CREATE TABLE IF NOT EXISTS holds (
  showtime_id  TEXT NOT NULL REFERENCES showtimes (id) ON DELETE CASCADE,
  seat_id      TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  expires_at   INTEGER NOT NULL,                  -- expires_at <= now means the hold does not exist
  PRIMARY KEY (showtime_id, seat_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS holds_by_session ON holds (session_id, showtime_id);
CREATE INDEX IF NOT EXISTS holds_by_expiry ON holds (expires_at);

CREATE TABLE IF NOT EXISTS bookings (
  code            TEXT PRIMARY KEY,               -- CC-XXXXXX
  showtime_id     TEXT NOT NULL REFERENCES showtimes (id) ON DELETE CASCADE,
  session_id      TEXT,                           -- the browser session that booked; NULL for seeded bookings
  status          TEXT NOT NULL CHECK (status IN ('confirmed', 'checked_in', 'cancelled')),
  customer_name   TEXT NOT NULL,
  customer_phone  TEXT NOT NULL,                  -- +9639XXXXXXXX
  payment_method  TEXT NOT NULL CHECK (payment_method IN ('box_office', 'online_demo')),
  payment_status  TEXT NOT NULL CHECK (payment_status IN ('due', 'paid')),
  total           INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'SYP',
  seeded          INTEGER NOT NULL DEFAULT 0,     -- 1 = demo data
  created_at      INTEGER NOT NULL,
  cancelled_at    INTEGER,
  checked_in_at   INTEGER
);
CREATE INDEX IF NOT EXISTS bookings_by_showtime ON bookings (showtime_id, status);
CREATE INDEX IF NOT EXISTS bookings_by_session ON bookings (session_id, created_at);
CREATE INDEX IF NOT EXISTS bookings_by_created ON bookings (created_at);

CREATE TABLE IF NOT EXISTS booking_seats (
  booking_code  TEXT NOT NULL REFERENCES bookings (code) ON DELETE CASCADE,
  showtime_id   TEXT NOT NULL REFERENCES showtimes (id) ON DELETE CASCADE,
  seat_id       TEXT NOT NULL,
  row_label     TEXT NOT NULL,
  seat_number   INTEGER NOT NULL,
  seat_type     TEXT NOT NULL CHECK (seat_type IN ('standard', 'premium', 'vip')),
  price         INTEGER NOT NULL,                 -- what this seat cost when it was booked
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),  -- 0 once the booking is cancelled
  PRIMARY KEY (booking_code, seat_id)
) WITHOUT ROWID;
-- The no-double-booking guarantee: at most one live booking per seat and showtime.
CREATE UNIQUE INDEX IF NOT EXISTS booking_seats_one_active ON booking_seats (showtime_id, seat_id) WHERE active = 1;
`;

/** Opens (creating if needed) a database file, or ':memory:', and brings its schema up to date. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  return prepareDatabase(new DatabaseSync(file, { timeout: 5000 }));
}

/** Applies pragmas and the schema to an already open connection. Safe to call more than once. */
export function prepareDatabase(db: DatabaseSync): DatabaseSync {
  // location() is null for in-memory databases, where WAL does not apply.
  if (db.location() !== null) db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (version !== 0 && version !== SCHEMA_VERSION) {
    throw new Error(
      `The database uses schema version ${version}, this server expects ${SCHEMA_VERSION}. Run \`npm run db:reset\` to recreate it.`,
    );
  }
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}

let savepoints = 0;

/**
 * Runs `fn` atomically. The outermost call opens a write transaction straight away (BEGIN IMMEDIATE),
 * so two connections can never interleave a read-check-write sequence; nested calls use savepoints.
 * `fn` must be synchronous — node:sqlite is, and an await inside would break the atomicity.
 */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  const nested = db.isTransaction;
  const savepoint = `sp_${++savepoints}`;
  db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
  try {
    const result = fn();
    if (result instanceof Promise) throw new Error('transaction() callbacks must be synchronous');
    db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
    throw error;
  }
}

/** True for SQLite UNIQUE / PRIMARY KEY violations. */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { errcode?: unknown; message?: unknown } | null;
  return (
    !!e &&
    (e.errcode === 2067 /* SQLITE_CONSTRAINT_UNIQUE */ ||
      e.errcode === 1555 /* SQLITE_CONSTRAINT_PRIMARYKEY */ ||
      (typeof e.message === 'string' && e.message.includes('UNIQUE constraint failed')))
  );
}
