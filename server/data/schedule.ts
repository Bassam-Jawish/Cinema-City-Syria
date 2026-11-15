/**
 * Showtime generation. Deterministic per (date, hall): the same day always gets the same programme,
 * so the window can be extended day by day, or rebuilt by `npm run db:reset`, without surprises.
 *
 * Each hall has fixed start times and rotates through its own list of films. The rotation is offset
 * by the date, so a film plays at a different time on different days. Two house rules are then
 * enforced by swapping slots within the hall-day: family films (G, PG) start before 21:00 and
 * 18+ films no earlier than 18:00.
 */
import type { SeatType } from '../../shared/hall';
import { cinemaDateTimeToUtc, daysBetween } from '../../shared/time';
import type { Format, Movie, Prices, Rating } from '../../shared/types';
import { showtimePrices } from './pricing';

export interface HallProgramme {
  /** Start times, cinema local time, "HH:mm" (24 h), in order. */
  slots: string[];
  /** Films the hall rotates through (ids from server/data/catalog.ts). */
  films: string[];
  /** The hall can project 3D. */
  threeD: boolean;
}

/**
 * The weekly programme per hall (ids from shared/halls.ts), based on the cinema's real show times.
 * A hall in HALLS without an entry here gets no showtimes.
 */
export const PROGRAMMES: Record<string, HallProgramme> = {
  'hall-1': {
    slots: ['13:30', '15:45', '18:00', '20:15', '22:30'],
    films: ['the-last-caravan', 'the-silent-orbit', 'iron-tide', 'jasmine-street', 'noor-and-the-paper-dragon'],
    threeD: true,
  },
  'hall-2': {
    slots: ['13:45', '15:30', '17:15', '19:30', '21:45'],
    films: ['rooftop-kings', 'midnight-in-aleppo', 'the-whisper-below', 'noor-and-the-paper-dragon', 'the-silent-orbit'],
    threeD: true,
  },
};

/** Ads and trailers before the feature; a showtime ends this long after the film's running time. */
export const PRE_SHOW_MINUTES = 15;

const FAMILY_RATINGS: ReadonlySet<Rating> = new Set(['G', 'PG']);
/** Family films must start before this time (minutes after midnight). */
const FAMILY_LATEST_START = 21 * 60;
const ADULT_RATINGS: ReadonlySet<Rating> = new Set(['18+']);
/** 18+ films must not start before this time. */
const ADULT_EARLIEST_START = 18 * 60;

/** Day numbers count from here; any fixed date works, it only has to never change. */
const ROTATION_EPOCH = '1970-01-01';

export interface ScheduleHall {
  id: string;
  /** Seat types present in the hall: a showtime only prices those. */
  seatTypes: readonly SeatType[];
}

export interface PlannedShowtime {
  id: string;
  movieId: string;
  hallId: string;
  /** Cinema calendar day, YYYY-MM-DD. */
  date: string;
  /** Start, cinema local time, "HH:mm". */
  time: string;
  startMinutes: number;
  startsAt: number;
  endsAt: number;
  format: Format;
  prices: Prices;
}

/** "st-20261115-hall-1-1830" */
export function showtimeIdFor(date: string, hallId: string, time: string): string {
  return `st-${date.replaceAll('-', '')}-${hallId}-${time.replace(':', '')}`;
}

export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Whether a film may start at this time of day under the house rules. */
export function canStartAt(movie: Pick<Movie, 'rating'>, startMinutes: number): boolean {
  if (FAMILY_RATINGS.has(movie.rating) && startMinutes >= FAMILY_LATEST_START) return false;
  if (ADULT_RATINGS.has(movie.rating) && startMinutes < ADULT_EARLIEST_START) return false;
  return true;
}

/** The day number used for the rotation and the 3D alternation. */
export function dayIndexOf(date: string): number {
  return daysBetween(ROTATION_EPOCH, date);
}

const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** The slot nearest to `i` whose film can trade places with the film in `i`, or -1. */
function nearestSwap(lineup: readonly Movie[], minutes: readonly number[], i: number): number {
  for (let distance = 1; distance < lineup.length; distance++) {
    for (const j of [i + distance, i - distance]) {
      if (j < 0 || j >= lineup.length) continue;
      if (canStartAt(lineup[i], minutes[j]) && canStartAt(lineup[j], minutes[i])) return j;
    }
  }
  return -1;
}

/**
 * Swaps films between slots until every film may start where it is. A swap always leaves both
 * slots valid, so slots already checked stay valid and one pass is enough.
 */
function applyRatingRules(lineup: Movie[], minutes: readonly number[]): void {
  for (let i = 0; i < lineup.length; i++) {
    if (canStartAt(lineup[i], minutes[i])) continue;
    const j = nearestSwap(lineup, minutes, i);
    if (j >= 0) [lineup[i], lineup[j]] = [lineup[j], lineup[i]];
  }
}

/**
 * The showtimes of one calendar day, hall by hall in the order given, each hall in start order.
 * `movies` is the current catalogue; coming-soon films and films not yet released on `date` are skipped.
 */
export function planDay(date: string, movies: ReadonlyMap<string, Movie>, halls: readonly ScheduleHall[]): PlannedShowtime[] {
  const dayIndex = dayIndexOf(date);
  const planned: PlannedShowtime[] = [];

  for (const hall of halls) {
    const programme = PROGRAMMES[hall.id];
    if (!programme) continue;
    const films = programme.films
      .map((id) => movies.get(id))
      .filter((movie): movie is Movie => !!movie && movie.status === 'now_showing' && movie.releaseDate <= date);
    if (films.length === 0) continue;

    const minutes = programme.slots.map(minutesOf);
    const lineup = programme.slots.map((_, slot) => films[mod(slot + dayIndex, films.length)]);
    applyRatingRules(lineup, minutes);

    lineup.forEach((movie, slotIndex) => {
      const startMinutes = minutes[slotIndex];
      // A rule no swap could satisfy (e.g. a programme of only family films): leave the slot dark.
      if (!canStartAt(movie, startMinutes)) return;
      const time = programme.slots[slotIndex];
      const format: Format = movie.formats.includes('3D') && programme.threeD && mod(slotIndex + dayIndex, 2) === 0 ? '3D' : '2D';
      const startsAt = cinemaDateTimeToUtc(date, time).getTime();
      planned.push({
        id: showtimeIdFor(date, hall.id, time),
        movieId: movie.id,
        hallId: hall.id,
        date,
        time,
        startMinutes,
        startsAt,
        endsAt: startsAt + (movie.durationMin + PRE_SHOW_MINUTES) * 60_000,
        format,
        prices: showtimePrices(hall.seatTypes, { format }),
      });
    });
  }
  return planned;
}
