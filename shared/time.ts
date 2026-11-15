/**
 * Calendar arithmetic in the cinema's local time (Asia/Damascus, fixed UTC+3).
 * Instants travel through the API as UTC ISO strings; these helpers convert to and
 * from the cinema's wall clock without depending on the machine's own time zone.
 */
import { CINEMA_UTC_OFFSET_MINUTES } from './constants';

const OFFSET_MS = CINEMA_UTC_OFFSET_MINUTES * 60_000;
const DAY_MS = 86_400_000;

const pad = (n: number): string => String(n).padStart(2, '0');

function shifted(instant: Date | number | string): Date {
  const ms = instant instanceof Date ? instant.getTime() : typeof instant === 'number' ? instant : Date.parse(instant);
  return new Date(ms + OFFSET_MS);
}

/** The cinema's calendar day (YYYY-MM-DD) for an instant. */
export function cinemaDate(instant: Date | number | string): string {
  const d = shifted(instant);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Minutes after local midnight for an instant, 0–1439. */
export function cinemaMinutesOfDay(instant: Date | number | string): number {
  const d = shifted(instant);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** The UTC instant of a wall-clock time at the cinema. `time` is "HH:mm" (24h). */
export function cinemaDateTimeToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - OFFSET_MS);
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Day of week for a YYYY-MM-DD date: 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const parse = (s: string): number => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((parse(to) - parse(from)) / DAY_MS);
}

/** In Syria the weekend is Friday and Saturday. */
export function isWeekend(date: string): boolean {
  const day = weekdayOf(date);
  return day === 5 || day === 6;
}
