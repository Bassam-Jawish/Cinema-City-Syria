/**
 * Live seat stream hub (Server-Sent Events, GET /api/showtimes/:id/events).
 *
 * Each open EventSource is a client of one showtime. Seat changes are personalised at send time:
 * a seat held by the client's own session is sent as 'mine', to everyone else as 'held'.
 * Messages are plain `data: <json>` frames (no `event:` name) because the client uses onmessage.
 */
import { clearInterval, setInterval } from 'node:timers';
import type { SeatChange, SeatStreamEvent } from '../shared/types';

/** The part of an HTTP response the hub writes to. Express's Response satisfies it. */
export interface EventSink {
  write(chunk: string): boolean;
  end(): unknown;
  readonly writableEnded: boolean;
  readonly destroyed: boolean;
}

/** A seat state change as the server sees it; 'held' carries the holder so it can be shown as 'mine' to them. */
export type SeatUpdate = { seatId: string; state: 'available' | 'booked' } | { seatId: string; state: 'held'; holder: string };

export interface StreamClient {
  readonly id: number;
  readonly showtimeId: string;
  readonly sessionId: string | null;
  readonly sink: EventSink;
}

export interface LiveHubOptions {
  /** Interval of the `: ping` comment that keeps proxies from closing idle streams (0 = never). */
  pingIntervalMs?: number;
}

export class LiveHub {
  private readonly streams = new Map<string, Set<StreamClient>>();
  private readonly pingTimer: ReturnType<typeof setInterval> | null;
  private nextId = 1;

  constructor(options: LiveHubOptions = {}) {
    const every = options.pingIntervalMs ?? 15_000;
    this.pingTimer = every > 0 ? setInterval(() => this.ping(), every) : null;
    this.pingTimer?.unref();
  }

  /** Number of open streams, optionally for one showtime. */
  count(showtimeId?: string): number {
    if (showtimeId !== undefined) return this.streams.get(showtimeId)?.size ?? 0;
    let total = 0;
    for (const clients of this.streams.values()) total += clients.size;
    return total;
  }

  connect(showtimeId: string, sessionId: string | null, sink: EventSink): StreamClient {
    const client: StreamClient = { id: this.nextId++, showtimeId, sessionId, sink };
    let clients = this.streams.get(showtimeId);
    if (!clients) {
      clients = new Set();
      this.streams.set(showtimeId, clients);
    }
    clients.add(client);
    return client;
  }

  disconnect(client: StreamClient): boolean {
    const clients = this.streams.get(client.showtimeId);
    if (!clients?.delete(client)) return false;
    if (clients.size === 0) this.streams.delete(client.showtimeId);
    return true;
  }

  send(client: StreamClient, event: SeatStreamEvent): void {
    this.write(client, `data: ${JSON.stringify(event)}\n\n`);
  }

  /** Sends seat changes to every stream of the showtime, personalised per session. */
  publishSeats(showtimeId: string, updates: readonly SeatUpdate[], serverTime: string): void {
    const clients = this.streams.get(showtimeId);
    if (!clients || updates.length === 0) return;
    for (const client of [...clients]) {
      const changes: SeatChange[] = updates.map((update) => ({
        seatId: update.seatId,
        state:
          update.state === 'held' && client.sessionId !== null && update.holder === client.sessionId ? 'mine' : update.state,
      }));
      this.send(client, { type: 'seats', changes, serverTime });
    }
  }

  /** Tells every open stream that the demo data was reset. */
  publishReset(serverTime: string): void {
    for (const clients of [...this.streams.values()]) {
      for (const client of [...clients]) this.send(client, { type: 'reset', serverTime });
    }
  }

  /** Ends every stream (shutdown). */
  closeAll(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const clients of [...this.streams.values()]) {
      for (const client of [...clients]) {
        this.disconnect(client);
        try {
          if (!client.sink.writableEnded) client.sink.end();
        } catch {
          // The socket is already gone.
        }
      }
    }
  }

  private ping(): void {
    for (const clients of [...this.streams.values()]) {
      for (const client of [...clients]) this.write(client, ': ping\n\n');
    }
  }

  private write(client: StreamClient, chunk: string): void {
    if (client.sink.writableEnded || client.sink.destroyed) {
      this.disconnect(client);
      return;
    }
    try {
      client.sink.write(chunk);
    } catch {
      this.disconnect(client);
    }
  }
}
