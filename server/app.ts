/**
 * The HTTP layer: an Express 5 app serving the booking API (docs/openapi.yaml), the live seat
 * stream (Server-Sent Events) and, in production, the built client with an SPA fallback.
 *
 * createApp() is used by server/index.ts and by the integration tests, which pass an in-memory
 * database and a fake clock.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { clearInterval, setInterval } from 'node:timers';
import express, { type Express, type Request, type RequestHandler } from 'express';
import { ADMIN_PIN_HEADER, DEFAULT_HOLD_MINUTES, DEFAULT_TRAILER_MAX_MB, SESSION_HEADER } from '../shared/constants';
import type { Movie } from '../shared/types';
import { DEFAULT_ADMIN_PIN } from './config';
import type { Schedule } from './data/schedule';
import { openDatabase, prepareDatabase } from './db';
import { HttpError, apiNotFound, errorBody, errorHandler, notFound, tooManyRequests } from './errors';
import { LiveHub } from './live';
import { FixedWindowLimiter, type RateLimitRule } from './rate-limit';
import { BookingService } from './service';
import { TrailerStore } from './trailers';
import {
  adminBookingsQuerySchema,
  bookingRequestSchema,
  holdRequestSchema,
  loginRequestSchema,
  overviewQuerySchema,
  parse,
  parseSessionId,
} from './validation';

export interface AppOptions {
  /** An open connection (e.g. `new DatabaseSync(':memory:')`) or a file path / ':memory:'. close() closes it. */
  db: DatabaseSync | string;
  /** Clock in epoch ms (default Date.now). */
  now?: () => number;
  holdMinutes?: number;
  adminPin?: string;
  /** Generate demo bookings (default true). Tests pass false so every seat starts free. */
  seedBookings?: boolean;
  /** Serve the built client from this folder, with an SPA fallback to its index.html. */
  staticDir?: string | null;
  /** One line per API request and per stream connect/disconnect: true (console), false, or a custom sink. */
  log?: boolean | ((line: string) => void);
  /** Limit for mutating routes, per session (or IP without one). false disables it. */
  rateLimit?: RateLimitRule | false;
  /** Failed staff PIN attempts allowed per IP. */
  adminFailureLimit?: RateLimitRule;
  /** How often expired holds are swept and announced (ms; 0 = never). */
  sweepIntervalMs?: number;
  /**
   * Express "trust proxy" (default false). Only enable it behind a reverse proxy that sets
   * X-Forwarded-For itself — otherwise clients could pick their own address and dodge the limits.
   */
  trustProxy?: boolean | number | string;
  /** Keep-alive comment interval on seat streams (ms; 0 = never). */
  pingIntervalMs?: number;
  /**
   * Folder for uploaded trailer videos. Default: a fresh temporary folder that close() deletes
   * (what tests want); the server passes data/trailers.
   */
  trailersDir?: string;
  /** Largest trailer upload accepted, in bytes. */
  trailerMaxBytes?: number;
  /** The film catalogue (default: server/data/catalog.ts). Tests pass a fixed one. */
  movies?: readonly Movie[];
  /** What each hall plays, period by period (default: server/data/schedule.ts). */
  schedule?: Schedule;
}

export interface AppContext {
  app: Express;
  service: BookingService;
  hub: LiveHub;
  db: DatabaseSync;
  /** Folder holding the uploaded trailer videos. */
  trailersDir: string;
  /** Stops the sweeper, ends every seat stream, closes the database (and deletes a temporary trailer folder). */
  close(): void;
}

export const DEFAULT_RATE_LIMIT: RateLimitRule = { limit: 40, windowMs: 10_000 };
export const DEFAULT_ADMIN_FAILURE_LIMIT: RateLimitRule = { limit: 10, windowMs: 60_000 };

const SSE_PATH = /^\/showtimes\/[^/]+\/events\/?$/;

function requireSession(req: Request): string {
  const sessionId = parseSessionId(req.get(SESSION_HEADER));
  if (!sessionId) {
    throw new HttpError(
      400,
      'SESSION_REQUIRED',
      `Send the browser session id (16–64 characters of A-Z a-z 0-9 _ -) in the ${SESSION_HEADER} header`,
    );
  }
  return sessionId;
}

const clientIp = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? 'unknown';

/** A route parameter as a string (Express 5 types allow string[] for wildcard parameters). */
function param(req: Request, name: string): string {
  const value: unknown = req.params[name];
  return typeof value === 'string' ? value : Array.isArray(value) ? value.join('/') : '';
}

export function createApp(options: AppOptions): AppContext {
  const now = options.now ?? Date.now;
  const ownsConnection = typeof options.db === 'string';
  const db = typeof options.db === 'string' ? openDatabase(options.db) : prepareDatabase(options.db);
  const log = typeof options.log === 'function' ? options.log : options.log === false ? null : (line: string) => console.log(line);
  const hub = new LiveHub({ pingIntervalMs: options.pingIntervalMs });
  const ownsTrailersDir = options.trailersDir === undefined;
  const trailersDir = options.trailersDir ?? mkdtempSync(path.join(tmpdir(), 'ccs-trailers-'));
  const dropTrailersDir = () => {
    if (ownsTrailersDir) rmSync(trailersDir, { recursive: true, force: true });
  };

  let service: BookingService;
  try {
    service = new BookingService({
      db,
      hub,
      now,
      holdMinutes: options.holdMinutes ?? DEFAULT_HOLD_MINUTES,
      adminPin: options.adminPin ?? DEFAULT_ADMIN_PIN,
      seedBookings: options.seedBookings ?? true,
      trailers: new TrailerStore(trailersDir, options.trailerMaxBytes ?? DEFAULT_TRAILER_MAX_MB * 1024 * 1024),
      movies: options.movies,
      schedule: options.schedule,
    });
  } catch (error) {
    hub.closeAll();
    if (ownsConnection && db.isOpen) db.close();
    dropTrailersDir();
    throw error;
  }

  const mutationLimiter = options.rateLimit === false ? null : new FixedWindowLimiter(options.rateLimit ?? DEFAULT_RATE_LIMIT, now);
  const adminFailures = new FixedWindowLimiter(options.adminFailureLimit ?? DEFAULT_ADMIN_FAILURE_LIMIT, now);

  /** Fixed-window limit keyed by session id, or by IP for requests without one. */
  const limited: RequestHandler = (req, _res, next) => {
    if (mutationLimiter) {
      const key = parseSessionId(req.get(SESSION_HEADER)) ?? `ip:${clientIp(req)}`;
      const retryAfter = mutationLimiter.hit(key);
      if (retryAfter > 0) throw tooManyRequests(retryAfter);
    }
    next();
  };

  /** Brute-force guard shared by the login route and the PIN header check. */
  const checkPin = (req: Request, pin: unknown): void => {
    const ip = clientIp(req);
    const retryAfter = adminFailures.retryAfter(ip);
    if (retryAfter > 0) throw tooManyRequests(retryAfter, 'Too many wrong PINs, try again in a minute');
    if (!service.isAdminPin(pin)) {
      adminFailures.hit(ip);
      throw new HttpError(401, 'UNAUTHORIZED', 'Wrong or missing staff PIN');
    }
  };

  const requireAdmin: RequestHandler = (req, _res, next) => {
    checkPin(req, req.get(ADMIN_PIN_HEADER));
    next();
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.set('trust proxy', options.trustProxy ?? false);

  const api = express.Router();

  if (log) {
    api.use((req, res, next) => {
      const isStream = SSE_PATH.test(req.path);
      const started = process.hrtime.bigint();
      res.on('finish', () => {
        // Streams log their own connect/disconnect; only a refused one (e.g. 404) gets a request line.
        if (isStream && res.statusCode === 200) return;
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        log(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(1)}ms`);
      });
      next();
    });
  }
  api.use(express.json({ limit: '16kb' }));
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // ── Catalogue ──
  api.get('/health', (_req, res) => {
    res.json(service.health());
  });
  api.get('/movies', (_req, res) => {
    res.json(service.listMovies());
  });
  api.get('/movies/:movieId', (req, res) => {
    res.json(service.getMovie(param(req, 'movieId')));
  });
  api.get('/halls', (_req, res) => {
    res.json(service.listHalls());
  });

  // ── Trailers ──
  // Range requests are answered (206), so the hall can start playing and seek before the whole file arrives.
  api.get('/trailers/:file', (req, res, next) => {
    const version = typeof req.query.v === 'string' ? req.query.v : undefined;
    const file = service.trailerFile(param(req, 'file'), version);
    if (!file) throw notFound('No such trailer');
    // Trailer URLs carry a version (?v=…) that changes with every upload, so they can be cached for good.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.type(file.type);
    res.sendFile(file.path, (error?: Error & { code?: string }) => {
      // A viewer who seeks or leaves aborts the transfer: that is not a server error.
      if (!error || res.headersSent || error.code === 'ECONNABORTED') return;
      // An answer that is not the file (e.g. 416 for a range past its end) must not be cached as one.
      res.setHeader('Cache-Control', 'no-store');
      next(error);
    });
  });

  // ── Seats ──
  api.get('/showtimes/:showtimeId', (req, res) => {
    res.json(service.getShowtimeDetail(param(req, 'showtimeId'), parseSessionId(req.get(SESSION_HEADER))));
  });

  api.get('/showtimes/:showtimeId/events', (req, res) => {
    const showtimeId = param(req, 'showtimeId');
    // EventSource cannot send headers, so the session comes in the query string.
    const sessionId = parseSessionId(req.query.session);
    // Throws 404 (plain JSON) before anything stream-like has been sent.
    const snapshot = service.seatSnapshot(showtimeId, sessionId);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.flushHeaders();
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true);
    res.write('retry: 3000\n\n');
    const client = hub.connect(showtimeId, sessionId, res);
    hub.send(client, snapshot);
    log?.(`SSE connect ${showtimeId} (${hub.count()} open)`);
    res.on('close', () => {
      if (hub.disconnect(client)) log?.(`SSE disconnect ${showtimeId} (${hub.count()} open)`);
    });
  });

  api.post('/showtimes/:showtimeId/holds', limited, (req, res) => {
    const sessionId = requireSession(req);
    const { seatId } = parse(holdRequestSchema, req.body);
    res.json(service.holdSeat(param(req, 'showtimeId'), seatId, sessionId));
  });
  api.delete('/showtimes/:showtimeId/holds', limited, (req, res) => {
    res.json(service.releaseAllSeats(param(req, 'showtimeId'), requireSession(req)));
  });
  api.delete('/showtimes/:showtimeId/holds/:seatId', limited, (req, res) => {
    res.json(service.releaseSeat(param(req, 'showtimeId'), param(req, 'seatId'), requireSession(req)));
  });

  // ── Bookings ──
  api.post('/bookings', limited, (req, res) => {
    const sessionId = requireSession(req);
    const body = parse(bookingRequestSchema, req.body);
    res.status(201).json({ booking: service.createBooking(sessionId, body) });
  });
  api.get('/bookings', (req, res) => {
    res.json({ bookings: service.myBookings(requireSession(req)) });
  });
  // Rate-limited too: it is the one public endpoint that reveals a customer's name and phone.
  api.get('/bookings/:code', limited, (req, res) => {
    res.json({ booking: service.findBooking(param(req, 'code')) });
  });
  api.post('/bookings/:code/cancel', limited, (req, res) => {
    res.json({ booking: service.cancelBooking(param(req, 'code'), requireSession(req)) });
  });

  // ── Admin ──
  api.post('/admin/login', limited, (req, res) => {
    const { pin } = parse(loginRequestSchema, req.body);
    checkPin(req, pin);
    res.json({ ok: true });
  });
  api.get('/admin/overview', requireAdmin, (req, res) => {
    const { date } = parse(overviewQuerySchema, req.query);
    res.json(service.adminOverview(date));
  });
  api.get('/admin/bookings', requireAdmin, (req, res) => {
    const { date, q, limit } = parse(adminBookingsQuerySchema, req.query);
    res.json(service.adminBookings({ date, q, limit: limit === undefined ? undefined : Number(limit) }));
  });
  api.post('/admin/bookings/:code/check-in', limited, requireAdmin, (req, res) => {
    res.json({ booking: service.checkIn(param(req, 'code')) });
  });
  api.post('/admin/bookings/:code/cancel', limited, requireAdmin, (req, res) => {
    res.json({ booking: service.adminCancel(param(req, 'code')) });
  });
  api.post('/admin/reset', limited, requireAdmin, (_req, res) => {
    service.resetDemo();
    res.json({ ok: true });
  });
  api.get('/admin/trailers/limits', requireAdmin, (_req, res) => {
    res.json(service.trailerLimits());
  });
  // The body is the raw video file (Content-Type video/mp4 or video/webm), streamed to disk.
  api.post('/admin/movies/:movieId/trailer', limited, requireAdmin, async (req, res) => {
    const declared = Number(req.get('content-length'));
    const trailer = await service.uploadTrailer(param(req, 'movieId'), req, Number.isFinite(declared) ? declared : undefined);
    res.status(201).json({ trailer });
  });
  api.delete('/admin/movies/:movieId/trailer', limited, requireAdmin, (req, res) => {
    service.removeTrailer(param(req, 'movieId'));
    res.json({ ok: true });
  });

  api.use(apiNotFound);
  app.use('/api', api);

  // ── The built client (production) ──
  if (options.staticDir) {
    const indexFile = path.join(options.staticDir, 'index.html');
    if (!existsSync(indexFile)) {
      console.warn(`Not serving the client: ${indexFile} does not exist (run \`npm run build\`).`);
    } else {
      app.use(
        express.static(options.staticDir, {
          index: false,
          setHeaders(res, filePath) {
            // Vite fingerprints everything under assets/, so those files never change.
            if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          },
        }),
      );
      app.get('/{*splat}', (req, res, next) => {
        const isApi = req.path === '/api' || req.path.startsWith('/api/');
        // Client-side routes only: not the API, not a missing file (it has an extension), only for HTML.
        if (isApi || path.extname(req.path) !== '' || !req.accepts('html')) {
          next();
          return;
        }
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(indexFile);
      });
    }
  }

  app.use((req, res) => {
    res.status(404).json(errorBody('NOT_FOUND', `Nothing at ${req.path}`));
  });
  app.use(errorHandler());

  const sweepMs = options.sweepIntervalMs ?? 1000;
  const sweeper =
    sweepMs > 0
      ? setInterval(() => {
          try {
            service.sweepExpiredHolds();
          } catch (error) {
            console.error('Hold sweeper failed:', error);
          }
        }, sweepMs)
      : null;
  sweeper?.unref();

  let closed = false;
  return {
    app,
    service,
    hub,
    db,
    trailersDir,
    close() {
      if (closed) return;
      closed = true;
      if (sweeper) clearInterval(sweeper);
      hub.closeAll();
      if (db.isOpen) db.close();
      dropTrailersDir();
    },
  };
}
