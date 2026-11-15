/**
 * Films and halls: synced from code into the database on start-up, then held in memory with
 * each hall's computed geometry (seat ids, types, view scores).
 */
import type { DatabaseSync } from 'node:sqlite';
import { SEAT_TYPES, buildHallGeometry, type HallGeometry, type SeatType } from '../shared/hall';
import { HALLS, type HallDefinition } from '../shared/halls';
import type { Hall, HallSummary, Movie } from '../shared/types';
import { CATALOG } from './data/catalog';
import { transaction } from './db';

export interface HallRuntime {
  definition: HallDefinition;
  geometry: HallGeometry;
  summary: HallSummary;
  /** The full Hall DTO (summary + layout). */
  hall: Hall;
  /** Seat types present in the hall. */
  seatTypes: SeatType[];
  /** Position in shared/halls.ts. */
  order: number;
}

export interface CatalogRuntime {
  /** Every film the database knows, including retired ones that old bookings still reference. */
  movies: Map<string, Movie>;
  /** The current catalogue, in the order of server/data/catalog.ts. */
  activeMovies: Movie[];
  /** Position of each active film in the catalogue (sort tie-breaker). */
  movieOrder: Map<string, number>;
  halls: Map<string, HallRuntime>;
  /** The current halls, in the order of shared/halls.ts. */
  activeHalls: HallRuntime[];
}

/** Upserts the catalogue and halls from code; entries no longer in code are kept but marked inactive. */
export function syncCatalog(
  db: DatabaseSync,
  movies: readonly Movie[] = CATALOG,
  halls: readonly HallDefinition[] = HALLS,
): void {
  // A broken layout should fail loudly at start-up, before anything is written.
  for (const hall of halls) buildHallGeometry(hall.layout);
  transaction(db, () => {
    db.exec('UPDATE movies SET active = 0; UPDATE halls SET active = 0;');
    const upsertMovie = db.prepare(
      `INSERT INTO movies (id, data, sort_order, active) VALUES (?, ?, ?, 1)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data, sort_order = excluded.sort_order, active = 1`,
    );
    movies.forEach((movie, index) => upsertMovie.run(movie.id, JSON.stringify(movie), index));
    const upsertHall = db.prepare(
      `INSERT INTO halls (id, data, sort_order, active) VALUES (?, ?, ?, 1)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data, sort_order = excluded.sort_order, active = 1`,
    );
    halls.forEach((hall, index) => upsertHall.run(hall.id, JSON.stringify(hall), index));
  });
}

function hallRuntime(definition: HallDefinition, order: number): HallRuntime {
  const geometry = buildHallGeometry(definition.layout);
  const summary: HallSummary = {
    id: definition.id,
    name: definition.name,
    kind: definition.kind,
    seatCount: geometry.seatCount,
    features: definition.features,
  };
  return {
    definition,
    geometry,
    summary,
    hall: { ...summary, layout: definition.layout },
    seatTypes: SEAT_TYPES.filter((type) => geometry.seatCountByType[type] > 0),
    order,
  };
}

/** Reads films and halls back from the database. */
export function loadCatalog(db: DatabaseSync): CatalogRuntime {
  const movieRows = db.prepare('SELECT data, active FROM movies ORDER BY active DESC, sort_order, id').all() as unknown as Array<{
    data: string;
    active: number;
  }>;
  const movies = new Map<string, Movie>();
  const activeMovies: Movie[] = [];
  for (const row of movieRows) {
    const movie = JSON.parse(row.data) as Movie;
    movies.set(movie.id, movie);
    if (row.active) activeMovies.push(movie);
  }

  const hallRows = db.prepare('SELECT data, active FROM halls ORDER BY active DESC, sort_order, id').all() as unknown as Array<{
    data: string;
    active: number;
  }>;
  const halls = new Map<string, HallRuntime>();
  const activeHalls: HallRuntime[] = [];
  hallRows.forEach((row, index) => {
    const runtime = hallRuntime(JSON.parse(row.data) as HallDefinition, index);
    halls.set(runtime.definition.id, runtime);
    if (row.active) activeHalls.push(runtime);
  });

  return {
    movies,
    activeMovies,
    movieOrder: new Map(activeMovies.map((movie, index) => [movie.id, index])),
    halls,
    activeHalls,
  };
}
