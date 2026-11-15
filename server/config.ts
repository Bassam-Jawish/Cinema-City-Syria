/**
 * Server settings, read once from environment variables. Every variable is optional.
 *
 *   API_PORT       HTTP port (default 4000). Takes precedence over PORT.
 *   PORT           HTTP port when API_PORT is not set — ignored in development (`--dev`), where PORT
 *                  belongs to the Vite dev server (preview tools set it for the web app).
 *   HOST           Interface to bind (default: all interfaces, so a phone on the same Wi-Fi can open the demo).
 *   DB_FILE        SQLite database file (default data/cinema.db in the project; relative paths resolve
 *                  from the working directory). ':memory:' gives a throw-away database.
 *   HOLD_MINUTES   How long selected seats stay reserved for a customer (default DEFAULT_HOLD_MINUTES).
 *   ADMIN_PIN      Staff PIN for /api/admin (default 1234 — fine for a demo, nothing more).
 *   SEED_BOOKINGS  Generate demo bookings so the halls look lived-in (default on; 0/false/off/no disables).
 *   SERVE_STATIC   Serve the built client from dist/ (default: on when dist/index.html exists, except in
 *                  development, where Vite serves the client).
 *   TRUST_PROXY    Express "trust proxy" setting, only for a deployment behind a reverse proxy that sets
 *                  X-Forwarded-For (e.g. `loopback`, `1`, `true`). Default off: the rate limits then key
 *                  on the socket address, which a client cannot spoof.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOLD_MINUTES } from '../shared/constants';

/** The project root: the folder that holds package.json. */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DB_FILE = path.join(PROJECT_ROOT, 'data', 'cinema.db');
export const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
export const DEFAULT_PORT = 4000;
export const DEFAULT_ADMIN_PIN = '1234';

export interface ServerConfig {
  port: number;
  /** undefined = every interface. */
  host: string | undefined;
  /** Absolute path of the SQLite file, or ':memory:'. */
  dbFile: string;
  holdMinutes: number;
  adminPin: string;
  seedBookings: boolean;
  /** Folder of the built client to serve, or null to serve the API only. */
  staticDir: string | null;
  /** Express "trust proxy" value (false = ignore X-Forwarded-For). */
  trustProxy: boolean | number | string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

function raw(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function flag(env: Env, name: string, fallback: boolean): boolean {
  const value = raw(env, name)?.toLowerCase();
  if (value === undefined) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new ConfigError(`${name} must be on/off (1/0, true/false), got "${env[name]}"`);
}

function numberIn(env: Env, name: string, fallback: number, min: number, max: number, integer: boolean): number {
  const value = raw(env, name);
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new ConfigError(`${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}, got "${value}"`);
  }
  return n;
}

function trustProxyFrom(env: Env): boolean | number | string {
  const value = raw(env, 'TRUST_PROXY');
  if (value === undefined) return false;
  const lower = value.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(lower)) return lower === '1' ? 1 : true;
  if (['0', 'false', 'no', 'off'].includes(lower)) return false;
  return /^\d+$/.test(value) ? Number(value) : value; // hop count, or addresses/subnets such as "loopback"
}

function dbFileFrom(env: Env): string {
  const value = raw(env, 'DB_FILE');
  if (value === undefined) return DEFAULT_DB_FILE;
  return value === ':memory:' ? value : path.resolve(value);
}

/**
 * @param dev development mode (`server/index.ts --dev`, used by `npm run dev`): the API runs next
 *            to the Vite dev server, so it ignores PORT and does not serve dist/.
 */
export function loadConfig(env: Env = process.env, dev = process.argv.includes('--dev')): ServerConfig {
  const serveStatic = flag(env, 'SERVE_STATIC', !dev && existsSync(path.join(DIST_DIR, 'index.html')));
  const port = raw(env, 'API_PORT')
    ? numberIn(env, 'API_PORT', DEFAULT_PORT, 0, 65535, true)
    : dev
      ? DEFAULT_PORT
      : numberIn(env, 'PORT', DEFAULT_PORT, 0, 65535, true);
  return {
    port,
    host: raw(env, 'HOST'),
    dbFile: dbFileFrom(env),
    holdMinutes: numberIn(env, 'HOLD_MINUTES', DEFAULT_HOLD_MINUTES, 0.1, 24 * 60, false),
    adminPin: raw(env, 'ADMIN_PIN') ?? DEFAULT_ADMIN_PIN,
    seedBookings: flag(env, 'SEED_BOOKINGS', true),
    staticDir: serveStatic ? DIST_DIR : null,
    trustProxy: trustProxyFrom(env),
  };
}
