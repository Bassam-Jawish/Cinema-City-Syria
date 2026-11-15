/**
 * The seat-selection state machine, with the HTTP API mocked and a fake EventSource standing in
 * for the live seat stream.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HALLS } from '@shared/halls';
import type { HoldResult, SeatStreamEvent, ShowtimeDetail } from '@shared/types';

// ── fake live stream ──
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(event: SeatStreamEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  static latest() {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }
}
vi.stubGlobal('EventSource', FakeEventSource);

// ── mocked API ──
const api = vi.hoisted(() => ({
  getShowtime: vi.fn(),
  holdSeat: vi.fn(),
  releaseSeat: vi.fn(),
  releaseAllSeats: vi.fn(),
  createBooking: vi.fn(),
  seatEventsUrl: vi.fn((id: string) => `/api/showtimes/${id}/events`),
}));
vi.mock('@/lib/api', async () => {
  class ApiError extends Error {
    constructor(
      readonly code: string,
      readonly status: number,
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  }
  return {
    api,
    ApiError,
    errorCodeOf: (error: unknown) => (error instanceof ApiError ? error.code : 'INTERNAL'),
  };
});

const { useBooking } = await import('./booking');
const { useNotices } = await import('./notices');
const { ApiError } = await import('@/lib/api');

const NOW = Date.parse('2026-11-15T12:00:00Z');
const hall = HALLS[1];

function detail(seats: ShowtimeDetail['seats'] = {}, holdExpiresAt: string | null = null): ShowtimeDetail {
  return {
    showtime: {
      id: 'st-1',
      movieId: 'm',
      hallId: hall.id,
      startsAt: '2026-11-15T16:30:00Z',
      endsAt: '2026-11-15T18:30:00Z',
      format: '2D',
      prices: { standard: 750, premium: 1000 },
      currency: 'SYP',
      hall: { id: hall.id, name: hall.name, kind: hall.kind, seatCount: 180, features: [] },
      seatsTotal: 180,
      seatsAvailable: 180,
      status: 'open',
    },
    movie: { id: 'm' } as ShowtimeDetail['movie'],
    hall: { id: hall.id, name: hall.name, kind: hall.kind, seatCount: 180, features: [], layout: hall.layout },
    seats,
    holdExpiresAt,
    serverTime: new Date(NOW).toISOString(),
  };
}

const holdResult = (seatIds: string[]): HoldResult => ({
  seatId: seatIds[seatIds.length - 1],
  seatIds,
  holdExpiresAt: new Date(NOW + 600_000).toISOString(),
  serverTime: new Date(NOW).toISOString(),
});

/** A promise we resolve or reject by hand, to control the order of async events. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let showtimeCounter = 0;

async function openShowtime(seats: ShowtimeDetail['seats'] = {}) {
  api.getShowtime.mockResolvedValueOnce(detail(seats));
  await useBooking.getState().open(`st-${++showtimeCounter}`);
  const stream = FakeEventSource.latest();
  stream.readyState = FakeEventSource.OPEN;
  stream.onopen?.();
  return stream;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  api.releaseSeat.mockResolvedValue({ seatIds: [], holdExpiresAt: null });
  api.releaseAllSeats.mockResolvedValue({ seatIds: [], holdExpiresAt: null });
  useNotices.setState({ notices: [] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('booking store', () => {
  it('loads a showtime, builds the hall and goes live', async () => {
    const stream = await openShowtime({ A1: 'booked', A2: 'held' });
    const s = useBooking.getState();
    expect(s.load).toBe('ready');
    expect(s.geometry?.seatCount).toBe(180);
    expect(s.taken).toEqual({ A1: 'booked', A2: 'held' });
    expect(s.live).toBe('live');
    expect(stream.url).toContain('/events');
  });

  it('selects optimistically, flies into the seat, then confirms the hold', async () => {
    await openShowtime();
    const hold = deferred<HoldResult>();
    api.holdSeat.mockReturnValueOnce(hold.promise);

    useBooking.getState().pickSeat('F8');
    let s = useBooking.getState();
    expect(s.selected).toEqual(['F8']);
    expect(s.pending).toEqual({ F8: true });
    expect(s.view).toBe('pov');
    expect(s.povSeatId).toBe('F8');

    hold.resolve(holdResult(['F8']));
    await flush();
    s = useBooking.getState();
    expect(s.pending).toEqual({});
    expect(s.holdExpiresAt).toBe(NOW + 600_000);
  });

  it('rolls back and explains when someone else was faster', async () => {
    await openShowtime();
    api.holdSeat.mockRejectedValueOnce(new ApiError('SEAT_UNAVAILABLE', 409, 'taken', { seatIds: ['F8'] }));
    api.getShowtime.mockResolvedValueOnce(detail({ F8: 'held' }));

    useBooking.getState().pickSeat('F8');
    await flush();
    await flush();
    const s = useBooking.getState();
    expect(s.selected).toEqual([]);
    expect(s.view).toBe('overview');
    expect(s.povSeatId).toBeNull();
    expect(s.taken.F8).toBe('held');
    expect(useNotices.getState().notices.map((n) => n.key)).toContain('seatJustTaken');
  });

  it('refuses taken seats and the ninth seat without calling the server', async () => {
    await openShowtime({ A1: 'booked' });
    useBooking.getState().pickSeat('A1');
    expect(api.holdSeat).not.toHaveBeenCalled();
    expect(useNotices.getState().notices.map((n) => n.key)).toContain('seatTaken');

    api.holdSeat.mockImplementation((_id: string, seatId: string) => Promise.resolve(holdResult([seatId])));
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) useBooking.getState().pickSeat(`L${n}`);
    useBooking.getState().pickSeat('L9');
    expect(useBooking.getState().selected).toHaveLength(8);
    expect(api.holdSeat).toHaveBeenCalledTimes(8);
    expect(useNotices.getState().notices.map((n) => n.key)).toContain('seatLimit');
  });

  it('releases a seat removed while its hold was still in flight — again if the requests crossed', async () => {
    await openShowtime();
    const hold = deferred<HoldResult>();
    api.holdSeat.mockReturnValueOnce(hold.promise);
    useBooking.getState().pickSeat('G5');
    useBooking.getState().removeSeat('G5');
    expect(useBooking.getState().selected).toEqual([]);
    expect(useBooking.getState().pending).toEqual({});
    expect(api.releaseSeat).toHaveBeenCalledTimes(1);

    // The hold landed after the release: it must be released once more.
    hold.resolve(holdResult(['G5']));
    await flush();
    expect(api.releaseSeat).toHaveBeenCalledTimes(2);
    expect(useBooking.getState().selected).toEqual([]);
  });

  it('keeps a seat that was removed and picked again while requests were in flight', async () => {
    const stream = await openShowtime();
    const firstHold = deferred<HoldResult>();
    const release = deferred<{ seatIds: string[]; holdExpiresAt: null }>();
    const secondHold = deferred<HoldResult>();
    api.holdSeat.mockReturnValueOnce(firstHold.promise).mockReturnValueOnce(secondHold.promise);
    api.releaseSeat.mockReturnValueOnce(release.promise);

    useBooking.getState().pickSeat('A5');
    useBooking.getState().removeSeat('A5');
    useBooking.getState().pickSeat('A5');

    firstHold.resolve(holdResult(['A5'])); // superseded, and the seat is wanted again: no release
    release.resolve({ seatIds: [], holdExpiresAt: null }); // superseded too
    stream.emit({ type: 'seats', changes: [{ seatId: 'A5', state: 'mine' }], serverTime: '' });
    secondHold.resolve(holdResult(['A5']));
    await flush();

    const s = useBooking.getState();
    expect(s.selected).toEqual(['A5']);
    expect(s.pending).toEqual({});
    expect(api.releaseSeat).toHaveBeenCalledTimes(1);
  });

  it('resyncs and says so when a release cannot be confirmed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    await openShowtime();
    api.holdSeat.mockResolvedValueOnce(holdResult(['B4']));
    useBooking.getState().pickSeat('B4');
    await vi.advanceTimersByTimeAsync(0);

    api.releaseSeat.mockRejectedValue(new ApiError('RATE_LIMITED', 429, 'slow down', { retryAfterSeconds: 1 }));
    api.getShowtime.mockResolvedValueOnce(detail({ B4: 'mine' }));
    useBooking.getState().removeSeat('B4');
    expect(useBooking.getState().selected).toEqual([]);

    await vi.advanceTimersByTimeAsync(5_000); // all retries spent (notices fade after ~5 s)
    expect(api.releaseSeat).toHaveBeenCalledTimes(4);
    expect(useNotices.getState().notices.map((n) => n.key)).toContain('network');
    // The server still holds it for us, so it is shown again rather than silently kept.
    expect(useBooking.getState().selected).toEqual(['B4']);
  });

  it('does not explain a failed hold for a seat the customer already removed', async () => {
    await openShowtime();
    const hold = deferred<HoldResult>();
    api.holdSeat.mockReturnValueOnce(hold.promise);
    useBooking.getState().pickSeat('C9');
    useBooking.getState().removeSeat('C9');
    hold.reject(new ApiError('SEAT_UNAVAILABLE', 409, 'taken'));
    await flush();
    expect(useNotices.getState().notices.map((n) => n.key)).not.toContain('seatJustTaken');
  });

  it('does not open a live stream for a page that was left while loading', async () => {
    const load = deferred<ShowtimeDetail>();
    api.getShowtime.mockReturnValueOnce(load.promise);
    const before = FakeEventSource.instances.length;
    const opening = useBooking.getState().open(`st-${++showtimeCounter}`);
    useBooking.getState().disconnect();
    load.resolve(detail());
    await opening;
    expect(useBooking.getState().load).toBe('ready');
    expect(FakeEventSource.instances.length).toBe(before);
  });

  it('discards a refresh that newer live news overtook', async () => {
    const stream = await openShowtime();
    const stale = deferred<ShowtimeDetail>();
    api.getShowtime.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(detail({ D1: 'booked', D2: 'held' }));
    const refreshing = useBooking.getState().refresh();
    stream.emit({ type: 'seats', changes: [{ seatId: 'D2', state: 'held' }], serverTime: '' });
    stale.resolve(detail({ D1: 'booked' })); // taken before D2 was held
    await refreshing;
    expect(useBooking.getState().taken).toEqual({ D1: 'booked', D2: 'held' });
    expect(api.getShowtime).toHaveBeenCalledTimes(3); // open + stale refresh + retry
  });

  it('applies live changes and stands you up if your seat is lost', async () => {
    const stream = await openShowtime();
    api.holdSeat.mockResolvedValueOnce(holdResult(['E7']));
    useBooking.getState().pickSeat('E7');
    await flush();

    stream.emit({ type: 'seats', changes: [{ seatId: 'B2', state: 'held' }, { seatId: 'B3', state: 'booked' }], serverTime: '' });
    expect(useBooking.getState().taken).toMatchObject({ B2: 'held', B3: 'booked' });

    // The hold on E7 lapsed on the server.
    stream.emit({ type: 'seats', changes: [{ seatId: 'E7', state: 'available' }], serverTime: '' });
    const s = useBooking.getState();
    expect(s.selected).toEqual([]);
    expect(s.view).toBe('overview');
    expect(useNotices.getState().notices.map((n) => n.key)).toContain('seatLost');
  });

  it('restores your holds from a snapshot (e.g. after a reload or reconnect)', async () => {
    const stream = await openShowtime();
    stream.emit({
      type: 'snapshot',
      seats: { C1: 'mine', C2: 'mine', D4: 'booked' },
      holdExpiresAt: new Date(NOW + 300_000).toISOString(),
      serverTime: new Date(NOW).toISOString(),
    });
    const s = useBooking.getState();
    expect(s.selected).toEqual(['C1', 'C2']);
    expect(s.taken).toEqual({ D4: 'booked' });
    expect(s.holdExpiresAt).toBe(NOW + 300_000);
  });

  it('keeps a view-only preview seated through live updates', async () => {
    const stream = await openShowtime({ K1: 'booked' });
    useBooking.getState().previewSeat('K1');
    stream.emit({ type: 'seats', changes: [{ seatId: 'A1', state: 'held' }], serverTime: '' });
    const s = useBooking.getState();
    expect(s.view).toBe('pov');
    expect(s.povSeatId).toBe('K1');
    expect(s.selected).toEqual([]);
  });

  it('reconnects with backoff after the stream is closed by an error', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const stream = await openShowtime();
    const before = FakeEventSource.instances.length;
    stream.readyState = FakeEventSource.CLOSED;
    stream.onerror?.();
    expect(useBooking.getState().live).toBe('offline');
    await vi.advanceTimersByTimeAsync(1600);
    expect(FakeEventSource.instances.length).toBe(before + 1);
    expect(useBooking.getState().live).toBe('connecting');
  });

  it('books the selected seats and clears the selection', async () => {
    await openShowtime();
    api.holdSeat.mockResolvedValue(holdResult(['H1']));
    useBooking.getState().pickSeat('H1');
    await flush();
    api.createBooking.mockResolvedValueOnce({ code: 'CC-TEST01' });
    api.getShowtime.mockResolvedValueOnce(detail({ H1: 'booked' }));
    const booking = await useBooking.getState().submitBooking({
      customer: { name: 'Lina', phone: '0944123456' },
      paymentMethod: 'box_office',
    });
    expect(booking.code).toBe('CC-TEST01');
    expect(api.createBooking).toHaveBeenCalledWith(expect.objectContaining({ seatIds: ['H1'], paymentMethod: 'box_office' }));
    expect(useBooking.getState().selected).toEqual([]);
    expect(useBooking.getState().submitting).toBe(false);
  });
});
