/**
 * Showtime generation. Deterministic per (date, hall): the same day always gets the same programme,
 * so the window can be extended day by day, or rebuilt by `npm run db:reset`, without surprises.
 *
 * The schedule is a list of periods, each from a date on: the programme the cinema has published
 * for this week, then what is planned after it (the December openings). In a period each hall has
 * either
 *   - a timetable — the cinema's own week, "this film at this time", every day, taken as published; or
 *   - a rotation — fixed start times and a list of films, rotated by date, so a film plays at a
 *     different time on different days. Two house rules are then enforced by swapping slots within
 *     the hall-day: family films (G, PG) start before 21:00 and 18+ films no earlier than 18:00. And
 *     a hall shows one film at a time: a slot that starts before the previous show is over stays
 *     dark (a 2 h 45 film needs more than one 2 h 15 slot).
 * Either way a film is only scheduled from its release date on.
 */
import type { SeatType } from '../../shared/hall';
import { cinemaDateTimeToUtc, daysBetween } from '../../shared/time';
import type { Format, Movie, Prices, Rating } from '../../shared/types';
import { showtimePrices } from './pricing';

/** A hall that rotates through films at fixed start times (a week planned before it is published). */
export interface HallRotation {
  /** Start times, cinema local time, "HH:mm" (24 h), in order. */
  slots: string[];
  /** Films the hall rotates through (ids from server/data/catalog.ts). */
  films: string[];
  /** The hall can project 3D. */
  threeD: boolean;
}

/** A hall's week exactly as the cinema publishes it: this film at this time, every day. */
export interface HallTimetable {
  /** [start time "HH:mm", film id], in start order. */
  shows: ReadonlyArray<readonly [time: string, filmId: string]>;
  /** The hall can project 3D. */
  threeD: boolean;
}

export type HallProgramme = HallRotation | HallTimetable;

/** What each hall plays (keys are hall ids from shared/halls.ts; a hall without an entry is dark). */
export type Programmes = Readonly<Record<string, HallProgramme>>;

/** The programme from a date on, until the next period begins. */
export interface ProgrammePeriod {
  /** First day, YYYY-MM-DD (cinema time). */
  from: string;
  halls: Programmes;
}

/** Periods in date order. Before the first one nothing is scheduled. */
export type Schedule = readonly ProgrammePeriod[];

/** The cinema's start times: Hall 1 and Hall 2. */
const HALL_1_TIMES = ['13:30', '15:45', '18:00', '20:15', '22:30'];
const HALL_2_TIMES = ['13:45', '15:30', '17:15', '19:30', '21:45'];

export const SCHEDULE: Schedule = [
  {
    // Cinema City's published week, "Now showing from November 12 till November 16" (2026), kept
    // until a new week is published: Hadota all day in Hall 1, four films in Hall 2.
    from: '2026-11-12',
    halls: {
      'hall-1': { shows: HALL_1_TIMES.map((time) => [time, 'hadota'] as const), threeD: true },
      'hall-2': {
        shows: [
          ['13:45', 'matloub-3a2leyan'],
          ['15:30', 'wala-kan-al-bal'],
          ['17:15', 'how-to-rob-a-bank'],
          ['19:30', 'how-to-rob-a-bank'],
          ['21:45', 'ramayana'],
        ],
        threeD: true,
      },
    },
  },
  {
    // Avengers: Doomsday and Dune: Part Three open on 18 December. The cinema has not published
    // that week yet: both halls alternate the two, which keeps their opening week on advance sale.
    from: '2026-12-18',
    halls: {
      'hall-1': { slots: HALL_1_TIMES, films: ['avengers-doomsday', 'dune-part-three'], threeD: true },
      'hall-2': { slots: HALL_2_TIMES, films: ['dune-part-three', 'avengers-doomsday'], threeD: true },
    },
  },
];

/** The period that applies on `date`, or null before the first one. */
export function periodOn(schedule: Schedule, date: string): ProgrammePeriod | null {
  let found: ProgrammePeriod | null = null;
  for (const period of schedule) if (period.from <= date && (!found || period.from >= found.from)) found = period;
  return found;
}

/** Every film the schedule names, in any period. */
export function scheduledFilms(schedule: Schedule): Set<string> {
  const ids = new Set<string>();
  for (const period of schedule) {
    for (const programme of Object.values(period.halls)) {
      if ('shows' in programme) for (const [, id] of programme.shows) ids.add(id);
      else for (const id of programme.films) ids.add(id);
    }
  }
  return ids;
}

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
 * `movies` is the current catalogue; films not in it, or not yet released on `date`, are skipped.
 */
export function planDay(
  date: string,
  movies: ReadonlyMap<string, Movie>,
  halls: readonly ScheduleHall[],
  schedule: Schedule = SCHEDULE,
): PlannedShowtime[] {
  const period = periodOn(schedule, date);
  if (!period) return [];
  const dayIndex = dayIndexOf(date);
  const planned: PlannedShowtime[] = [];
  for (const hall of halls) {
    const programme = period.halls[hall.id];
    if (!programme) continue;
    const showing = (id: string): Movie | undefined => {
      const movie = movies.get(id);
      return movie && movie.releaseDate <= date ? movie : undefined;
    };
    const shows = 'shows' in programme ? timetableDay(programme, showing) : rotationDay(programme, showing, dayIndex);
    // Every other show of a 3D film is in 3D (alternating by day, so each time of day gets both).
    shows.forEach(({ time, movie }, index) => {
      const format: Format = movie.formats.includes('3D') && programme.threeD && mod(index + dayIndex, 2) === 0 ? '3D' : '2D';
      const startsAt = cinemaDateTimeToUtc(date, time).getTime();
      planned.push({
        id: showtimeIdFor(date, hall.id, time),
        movieId: movie.id,
        hallId: hall.id,
        date,
        time,
        startMinutes: minutesOf(time),
        startsAt,
        endsAt: startsAt + (movie.durationMin + PRE_SHOW_MINUTES) * 60_000,
        format,
        prices: showtimePrices(hall.seatTypes, { format }),
      });
    });
  }
  return planned;
}

interface DayShow {
  time: string;
  movie: Movie;
}

/** The cinema's published timetable, as it stands (films not showing yet are left out). */
function timetableDay(programme: HallTimetable, showing: (id: string) => Movie | undefined): DayShow[] {
  const day: DayShow[] = [];
  for (const [time, id] of programme.shows) {
    const movie = showing(id);
    if (movie) day.push({ time, movie });
  }
  return day;
}

/** A rotation through the hall's films, within the house rules, one film at a time. */
function rotationDay(programme: HallRotation, showing: (id: string) => Movie | undefined, dayIndex: number): DayShow[] {
  const films = programme.films.map(showing).filter((movie): movie is Movie => !!movie);
  if (films.length === 0) return [];
  const minutes = programme.slots.map(minutesOf);
  const lineup = programme.slots.map((_, slot) => films[mod(slot + dayIndex, films.length)]);
  applyRatingRules(lineup, minutes);

  const day: DayShow[] = [];
  /** When the hall is free again, in minutes after midnight. */
  let freeFrom = Number.NEGATIVE_INFINITY;
  lineup.forEach((movie, slot) => {
    // A rule no swap could satisfy (e.g. a programme of only family films): leave the slot dark.
    if (!canStartAt(movie, minutes[slot])) return;
    // One film at a time: the previous show is still on.
    if (minutes[slot] < freeFrom) return;
    freeFrom = minutes[slot] + movie.durationMin + PRE_SHOW_MINUTES;
    day.push({ time: programme.slots[slot], movie });
  });
  return day;
}
