/**
 * `npm run db:reset` — deletes the database file (with its -wal/-shm companions) and builds a fresh
 * one: films and halls from code, the 7-day schedule window and the demo bookings.
 *
 * Stop the server first. If the file is in use, the data is reset in place instead (the running
 * server keeps working, but its open seat streams are not told until the pages reload).
 */
import { rmSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { ConfigError, loadConfig } from '../config';
import { openDatabase } from '../db';
import { resetDemoData } from '../seed';

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Configuration error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
  if (config.dbFile === ':memory:') {
    console.error('DB_FILE is :memory: — there is no database file to reset.');
    process.exit(1);
  }

  let inPlace = false;
  // The main file goes first: if it is locked, nothing else is touched.
  for (const file of [config.dbFile, `${config.dbFile}-wal`, `${config.dbFile}-shm`]) {
    try {
      rmSync(file, { force: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') throw error;
      inPlace = true;
      break;
    }
  }
  if (inPlace) {
    console.warn('The database is in use (is the server running?) — resetting its data in place instead.');
  }

  const started = performance.now();
  const db = openDatabase(config.dbFile);
  try {
    const { summary } = resetDemoData(db, Date.now(), { seedBookings: config.seedBookings });
    const first = summary.dates[0];
    const last = summary.dates[summary.dates.length - 1];
    console.log(`Database reset: ${config.dbFile}`);
    console.log(`  ${summary.showtimes} showtimes over ${summary.dates.length} days (${first} to ${last})`);
    console.log(
      config.seedBookings
        ? `  ${summary.bookings} demo bookings for ${summary.seats} seats`
        : '  no demo bookings (SEED_BOOKINGS is off)',
    );
    console.log(`  done in ${Math.round(performance.now() - started)} ms`);
  } finally {
    db.close();
  }
}

main();
