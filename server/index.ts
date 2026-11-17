/**
 * Starts the booking server — `npm run dev:api` (tsx watch) or `npm start`. Settings come from
 * environment variables, see server/config.ts.
 */
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers';
import { createApp } from './app';
import { ConfigError, DEFAULT_ADMIN_PIN, PROJECT_ROOT, loadConfig, type ServerConfig } from './config';
import { openDatabase } from './db';

/** IPv4 addresses other devices on the network (e.g. a phone on the same Wi-Fi) can reach this machine at. */
function lanAddresses(): Array<{ address: string; adapter: string }> {
  const found: Array<{ address: string; adapter: string }> = [];
  for (const [adapter, list] of Object.entries(networkInterfaces())) {
    for (const info of list ?? []) {
      // Link-local 169.254.x.x addresses are self-assigned and unreachable from other devices.
      if (info.family === 'IPv4' && !info.internal && !info.address.startsWith('169.254.')) found.push({ address: info.address, adapter });
    }
  }
  // Real Wi-Fi/Ethernet adapters first, virtual ones (Hyper-V, WSL, Docker, VMs) last.
  const virtual = (adapter: string): number => (/vethernet|wsl|docker|vmware|virtualbox|hyper-v|vbox/i.test(adapter) ? 1 : 0);
  return found.sort((a, b) => virtual(a.adapter) - virtual(b.adapter));
}

const shown = (file: string): string => {
  const relative = path.relative(PROJECT_ROOT, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file;
};

const trailerCount = (ctx: ReturnType<typeof createApp>): number =>
  ctx.service.catalog.activeMovies.filter((movie) => movie.trailer).length;

/** Longest a client may take to send one request (a trailer upload). */
const UPLOAD_TIMEOUT_MS = 60 * 60_000;

function readConfig(): ServerConfig {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Configuration error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

function main(): void {
  const config = readConfig();
  const started = performance.now();
  const db = openDatabase(config.dbFile);
  const ctx = createApp({
    db,
    holdMinutes: config.holdMinutes,
    adminPin: config.adminPin,
    seedBookings: config.seedBookings,
    staticDir: config.staticDir,
    trustProxy: config.trustProxy,
    trailersDir: config.trailersDir,
    trailerMaxBytes: config.trailerMaxBytes,
  });
  const server = createServer(ctx.app);
  // Node gives a client 5 minutes to send a whole request, and a trailer of a few hundred megabytes
  // over Wi-Fi can take longer: allow an hour. (Headers must still arrive within headersTimeout, 60 s.)
  server.requestTimeout = UPLOAD_TIMEOUT_MS;

  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(
      error.code === 'EADDRINUSE' ? `Port ${config.port} is already in use — set PORT to another port.` : 'Server error:',
      error.code === 'EADDRINUSE' ? '' : error,
    );
    ctx.close();
    process.exit(1);
  });

  const onListening = (): void => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : config.port;
    const everyInterface = !config.host || config.host === '0.0.0.0' || config.host === '::';
    const counts = ctx.service.counts();
    const lines = [
      '',
      '  Cinema City Syria — booking server',
      '',
      `  Local:      http://${everyInterface ? 'localhost' : config.host}:${port}/`,
      ...(everyInterface ? lanAddresses().map(({ address, adapter }) => `  Network:    http://${address}:${port}/  (${adapter})`) : []),
      '',
      `  Client:     ${config.staticDir ? `serving ${shown(config.staticDir)}/` : 'API only — during development open the Vite dev server instead'}`,
      `  Database:   ${config.dbFile === ':memory:' ? 'in memory' : shown(config.dbFile)} (${counts.showtimes} showtimes, ${counts.bookings} bookings)`,
      `  Seat holds: ${config.holdMinutes} min`,
      `  Trailers:   ${shown(config.trailersDir)}/ (${trailerCount(ctx)} uploaded, up to ${Math.floor(config.trailerMaxBytes / (1024 * 1024))} MB each — staff upload them at /staff)`,
      `  Admin PIN:  ${config.adminPin === DEFAULT_ADMIN_PIN ? `${DEFAULT_ADMIN_PIN} (the default — set ADMIN_PIN to change it)` : 'from ADMIN_PIN'}`,
      `  Ready in ${Math.round(performance.now() - started)} ms`,
      '',
    ];
    console.log(lines.join('\n'));
  };
  if (config.host) server.listen(config.port, config.host, onListening);
  else server.listen(config.port, onListening);

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${signal} received, shutting down…`);
    setTimeout(() => {
      console.error('Shutdown is taking too long, exiting.');
      process.exit(1);
    }, 5000).unref();
    // Open seat streams would keep server.close() waiting forever: end them first.
    ctx.hub.closeAll();
    server.close(() => {
      ctx.close();
      process.exit(0);
    });
    server.closeIdleConnections();
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) process.on(signal, () => shutdown(signal));
}

main();
