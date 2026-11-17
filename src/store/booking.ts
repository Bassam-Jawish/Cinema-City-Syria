/**
 * Booking store — the hub of the seat-selection experience.
 *
 * The 3D hall, the camera rig, the 2D seat map, the HUD and the checkout page all read
 * this one store and call its actions; none of them talk to the API or to each other directly.
 *
 *   open(showtimeId)  → loads the showtime, builds the hall geometry, starts the live seat stream
 *   pickSeat(seatId)  → the one entry point for "the customer clicked a seat" (3D or 2D)
 *   removeSeat(seatId), clearSelection()
 *   enterPov(seatId) / exitPov()  → switch between the hall overview and the view from a seat
 *   submitBooking(...)  → turns the held seats into a confirmed booking
 *
 * Seat selection is optimistic: the seat turns "selected" and the camera starts flying the
 * moment it is clicked, while the server is asked to hold it. If the hold is refused
 * (someone else was faster) the selection is rolled back and a notice is shown.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import { MAX_SEATS_PER_BOOKING } from '@shared/constants';
import { buildHallGeometry, type HallGeometry, type SeatInfo } from '@shared/hall';
import type {
  Booking,
  PaymentMethod,
  SeatChange,
  SeatMap,
  SeatStreamEvent,
  ShowtimeDetail,
} from '@shared/types';
import { api, ApiError, errorCodeOf, type ClientErrorCode } from '@/lib/api';
import { resetRuntime } from '@/three/runtime';
import { notify } from './notices';

export type ViewMode = 'overview' | 'pov';
export type LoadState = 'idle' | 'loading' | 'ready' | 'error';
export type LiveState = 'connecting' | 'live' | 'offline';
/** auto = house lights up in the overview, down when seated. */
export type LightsMode = 'auto' | 'on' | 'off';
/** How one seat looks to this customer right now. */
export type SeatUiState = 'available' | 'selected' | 'booked' | 'held';

export interface BookingState {
  // ── showtime data ──
  load: LoadState;
  loadError: ClientErrorCode | null;
  showtimeId: string | null;
  detail: ShowtimeDetail | null;
  geometry: HallGeometry | null;

  // ── live seat state ──
  /** Seats this customer cannot take: booked, or held by someone else. */
  taken: Record<string, 'booked' | 'held'>;
  /** Seats this customer holds, in the order they were picked. */
  selected: string[];
  /** Selected seats whose hold request has not been answered yet. */
  pending: Record<string, true>;
  /** When the holds lapse, in THIS device's clock (epoch ms). null when nothing is held. */
  holdExpiresAt: number | null;
  live: LiveState;
  submitting: boolean;

  // ── view state ──
  view: ViewMode;
  /** The seat the camera is sitting in (view === 'pov'). */
  povSeatId: string | null;
  /** True while sitting in a seat view-only (previewSeat), not one of the customer's selected seats. */
  previewing: boolean;
  hoveredSeatId: string | null;
  lights: LightsMode;
  /** Show silhouettes of the audience in seats that are already booked. */
  showAudience: boolean;
  /** Whether the 2D seat map panel is open. */
  mapOpen: boolean;
  /** Bumped to ask the camera rig to face the screen again. */
  lookResetNonce: number;

  // ── actions ──
  open: (showtimeId: string) => Promise<void>;
  refresh: () => Promise<void>;
  disconnect: () => void;
  pickSeat: (seatId: string) => void;
  removeSeat: (seatId: string) => void;
  clearSelection: () => void;
  enterPov: (seatId: string) => void;
  /** View-only: sit in any seat (e.g. one you have already booked) without selecting or holding it. */
  previewSeat: (seatId: string) => void;
  exitPov: () => void;
  hover: (seatId: string | null) => void;
  setLights: (mode: LightsMode) => void;
  setShowAudience: (show: boolean) => void;
  setMapOpen: (open: boolean) => void;
  recenterLook: () => void;
  /** Call when the hold countdown reaches zero. */
  handleHoldExpired: () => void;
  submitBooking: (input: {
    customer: { name: string; phone: string };
    paymentMethod: PaymentMethod;
  }) => Promise<Booking>;
}

const initialData = {
  load: 'idle' as LoadState,
  loadError: null,
  showtimeId: null,
  detail: null,
  geometry: null,
  taken: {},
  selected: [] as string[],
  pending: {},
  holdExpiresAt: null,
  live: 'connecting' as LiveState,
  submitting: false,
  view: 'overview' as ViewMode,
  povSeatId: null,
  previewing: false,
  hoveredSeatId: null,
  lookResetNonce: 0,
};

// Connection plumbing lives outside the store: it is not render state.
let source: EventSource | null = null;
/** The showtime whose stream we want open (null after disconnect()). */
let wantedStream: string | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 1500;
let openToken = 0;

/*
 * Per-seat bookkeeping for requests in flight, keyed by `${showtimeId}:${seatId}` (seat ids repeat
 * across halls). Every hold or release bumps the seat's token, and a response only acts when no
 * newer action has started on that seat since — so pick → remove → pick in quick succession can
 * never let an old response undo a newer intention.
 */
const seatTokens = new Map<string, number>();
/** Seats the customer removed whose release the server has not confirmed yet. */
const dropping = new Set<string>();
/** Bumped whenever newer seat information arrives; lets refresh() discard a snapshot that is already stale. */
let epoch = 0;

const seatKey = (showtimeId: string, seatId: string) => `${showtimeId}:${seatId}`;
function bumpToken(key: string): number {
  const token = (seatTokens.get(key) ?? 0) + 1;
  seatTokens.set(key, token);
  return token;
}
const isLatest = (key: string, token: number) => seatTokens.get(key) === token;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Releases one seat (or all of the session's seats on the showtime), retrying through rate limits
 * and flaky connections. Resolves to whether the server confirmed.
 */
async function releaseWithRetry(showtimeId: string, seatId: string | null): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (seatId) await api.releaseSeat(showtimeId, seatId);
      else await api.releaseAllSeats(showtimeId);
      return true;
    } catch (error) {
      if (attempt === 3) break;
      const retryAfter =
        error instanceof ApiError && error.code === 'RATE_LIMITED'
          ? Number((error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 1) * 1000
          : 0;
      await wait(Math.max(retryAfter, 600 * 2 ** attempt));
    }
  }
  return false;
}

const without = <T extends Record<string, unknown>>(record: T, key: string): T => {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
};

/** Converts a server timestamp to this device's clock using the server's own "now". */
function toLocalClock(iso: string | null, serverTime: string): number | null {
  if (!iso) return null;
  const skew = Date.parse(serverTime) - Date.now();
  return Date.parse(iso) - skew;
}

export const useBooking = create<BookingState>()((set, get) => {
  function closeSource(): void {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (source) {
      source.close();
      source = null;
    }
  }

  /**
   * EventSource retries by itself after a dropped connection, but gives up for good after a
   * non-200 answer — which is what a dev proxy sends while the API restarts. Retry with backoff.
   */
  function scheduleReconnect(showtimeId: string): void {
    if (retryTimer || wantedStream !== showtimeId) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (wantedStream === showtimeId && get().showtimeId === showtimeId) connect(showtimeId);
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15_000);
  }

  function connect(showtimeId: string): void {
    closeSource();
    wantedStream = showtimeId;
    if (typeof EventSource === 'undefined') {
      set({ live: 'offline' });
      return;
    }
    set({ live: 'connecting' });
    const es = new EventSource(api.seatEventsUrl(showtimeId));
    source = es;
    es.onopen = () => {
      if (source !== es) return;
      retryDelay = 1500;
      set({ live: 'live' });
    };
    es.onmessage = (message) => {
      if (source !== es || get().showtimeId !== showtimeId) return;
      try {
        applyEvent(showtimeId, JSON.parse(message.data) as SeatStreamEvent);
      } catch {
        // A malformed frame must never break the stream.
      }
    };
    es.onerror = () => {
      if (source !== es) return;
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        source = null;
        set({ live: 'offline' });
        scheduleReconnect(showtimeId);
      } else {
        // CONNECTING: the browser is retrying on its own; the next snapshot re-syncs everything.
        set({ live: 'connecting' });
      }
    };
  }

  // Coming back online or to the tab: reconnect straight away instead of waiting for the backoff.
  if (typeof window !== 'undefined') {
    const revive = () => {
      if (wantedStream && !source && get().showtimeId === wantedStream) {
        retryDelay = 1500;
        connect(wantedStream);
      }
    };
    window.addEventListener('online', revive);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') revive();
    });
  }

  function applySnapshot(showtimeId: string, seats: SeatMap, holdExpiresIso: string | null, serverTime: string): void {
    const prev = get();
    const taken: Record<string, 'booked' | 'held'> = {};
    const mine: string[] = [];
    for (const [seatId, state] of Object.entries(seats)) {
      if (state === 'mine') {
        if (!dropping.has(seatKey(showtimeId, seatId))) mine.push(seatId);
      } else {
        taken[seatId] = state;
      }
    }
    const kept = prev.selected.filter((id) => mine.includes(id) || prev.pending[id]);
    const selected = [...kept, ...mine.filter((id) => !kept.includes(id))];
    const stillSeated = prev.previewing || (prev.povSeatId !== null && selected.includes(prev.povSeatId));
    const hasPending = Object.keys(prev.pending).length > 0;
    set({
      taken,
      selected,
      holdExpiresAt: toLocalClock(holdExpiresIso, serverTime) ?? (hasPending ? prev.holdExpiresAt : null),
      ...(prev.view === 'pov' && !stillSeated ? { view: 'overview' as ViewMode, povSeatId: null } : {}),
    });
  }

  function applyChanges(showtimeId: string, changes: SeatChange[]): void {
    epoch++;
    const prev = get();
    const taken = { ...prev.taken };
    let selected = prev.selected;
    const lost: string[] = [];

    for (const { seatId, state } of changes) {
      if (state === 'mine') {
        delete taken[seatId];
        if (!dropping.has(seatKey(showtimeId, seatId)) && !selected.includes(seatId)) selected = [...selected, seatId];
        continue;
      }
      if (state === 'available') delete taken[seatId];
      else taken[seatId] = state;
      // A seat this customer held is no longer theirs (expired, released elsewhere, or just booked).
      if (selected.includes(seatId) && !prev.pending[seatId]) {
        selected = selected.filter((id) => id !== seatId);
        if (!prev.submitting && state !== 'booked') lost.push(seatId);
      }
    }

    const stillSeated = prev.previewing || (prev.povSeatId !== null && selected.includes(prev.povSeatId));
    set({
      taken,
      selected,
      ...(selected.length === 0 ? { holdExpiresAt: null } : {}),
      ...(prev.view === 'pov' && !stillSeated ? { view: 'overview' as ViewMode, povSeatId: null } : {}),
    });
    if (lost.length > 0) notify('warning', 'seatLost', { seats: lost.join(', ') });
  }

  function applyEvent(showtimeId: string, event: SeatStreamEvent): void {
    if (event.type === 'snapshot') {
      epoch++;
      applySnapshot(showtimeId, event.seats, event.holdExpiresAt, event.serverTime);
    } else if (event.type === 'seats') {
      applyChanges(showtimeId, event.changes);
    } else if (event.type === 'reset') {
      void get().refresh();
    } else if (event.type === 'trailer') {
      // Staff uploaded or removed this film's trailer: the screen switches to it straight away.
      const { detail } = get();
      if (detail && detail.showtime.id === showtimeId && detail.movie.id === event.movieId) {
        set({ detail: { ...detail, movie: { ...detail.movie, trailer: event.trailer } } });
      }
    }
  }

  /** Releases a seat the customer no longer wants, keeping it out of the selection until the server confirms. */
  function releaseTracked(showtimeId: string, seatId: string): void {
    const key = seatKey(showtimeId, seatId);
    const token = bumpToken(key);
    dropping.add(key);
    void releaseWithRetry(showtimeId, seatId).then((ok) => {
      epoch++;
      if (!isLatest(key, token)) return; // a newer pick or removal owns this seat now
      dropping.delete(key);
      if (!ok && get().showtimeId === showtimeId) {
        // Could not confirm the release: show the server's truth (the seat may still be ours) and say so.
        notify('error', 'network');
        void get().refresh();
      }
    });
  }

  return {
    ...initialData,
    lights: 'auto',
    showAudience: true,
    mapOpen: true,

    open: async (showtimeId) => {
      // Recorded first, so a page that leaves before loading finishes (disconnect) is respected.
      wantedStream = showtimeId;
      const current = get();
      if (current.showtimeId === showtimeId && (current.load === 'ready' || current.load === 'loading')) {
        if (current.load === 'ready' && !source) connect(showtimeId);
        return;
      }
      const token = ++openToken;
      // Seats held on a previous showtime are left alone: they may belong to another tab or to a
      // selection the customer comes back to. Unwanted holds simply expire.
      closeSource();
      resetRuntime();
      set({ ...initialData, showtimeId, load: 'loading' });
      try {
        const detail = await api.getShowtime(showtimeId);
        if (token !== openToken) return;
        const geometry = buildHallGeometry(detail.hall.layout);
        set({ detail, geometry, load: 'ready' });
        applySnapshot(showtimeId, detail.seats, detail.holdExpiresAt, detail.serverTime);
        if (wantedStream === showtimeId) connect(showtimeId);
      } catch (error) {
        if (token !== openToken) return;
        set({ load: 'error', loadError: errorCodeOf(error) });
      }
    },

    refresh: async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { showtimeId, load } = get();
        if (!showtimeId || load !== 'ready') return;
        const seen = epoch;
        try {
          const detail = await api.getShowtime(showtimeId);
          if (get().showtimeId !== showtimeId) return;
          // Newer seat news arrived while we were asking: this snapshot may already be stale.
          if (epoch !== seen) continue;
          set({ detail });
          applySnapshot(showtimeId, detail.seats, detail.holdExpiresAt, detail.serverTime);
          return;
        } catch {
          // Keep showing what we have; the live stream will catch up when it reconnects.
          return;
        }
      }
    },

    disconnect: () => {
      wantedStream = null;
      closeSource();
      set({ hoveredSeatId: null });
    },

    pickSeat: (seatId) => {
      const s = get();
      if (s.load !== 'ready' || !s.geometry || !s.detail || !s.showtimeId || s.submitting) return;
      if (!s.geometry.seatById[seatId]) return;
      if (s.selected.includes(seatId)) {
        get().enterPov(seatId);
        return;
      }
      if (s.detail.showtime.status === 'closed') {
        notify('warning', 'showtimeClosed');
        return;
      }
      if (s.taken[seatId]) {
        notify('info', 'seatTaken', { seat: seatId });
        return;
      }
      if (s.selected.length >= MAX_SEATS_PER_BOOKING) {
        notify('warning', 'seatLimit', { max: MAX_SEATS_PER_BOOKING });
        return;
      }

      const showtimeId = s.showtimeId;
      const key = seatKey(showtimeId, seatId);
      const token = bumpToken(key);
      dropping.delete(key);
      set({
        selected: [...s.selected, seatId],
        pending: { ...s.pending, [seatId]: true },
        view: 'pov',
        povSeatId: seatId,
        previewing: false,
        hoveredSeatId: null,
      });

      api
        .holdSeat(showtimeId, seatId)
        .then((result) => {
          epoch++;
          if (get().showtimeId !== showtimeId) return;
          if (!isLatest(key, token)) {
            // Superseded — typically removed while the request was in flight. The removal's own
            // release may have reached the server before this hold, so make sure it lets go.
            if (!get().selected.includes(seatId)) releaseTracked(showtimeId, seatId);
            return;
          }
          set((st) => ({
            pending: without(st.pending, seatId),
            holdExpiresAt: toLocalClock(result.holdExpiresAt, result.serverTime),
          }));
        })
        .catch((error: unknown) => {
          epoch++;
          if (get().showtimeId !== showtimeId || !isLatest(key, token)) return;
          const stillWanted = get().selected.includes(seatId);
          const code = errorCodeOf(error);
          set((st) => ({
            pending: without(st.pending, seatId),
            selected: st.selected.filter((id) => id !== seatId),
            ...(st.povSeatId === seatId ? { view: 'overview' as ViewMode, povSeatId: null, previewing: false } : {}),
          }));
          // The customer had already let go of this seat: nothing to explain.
          if (!stillWanted) return;
          if (code === 'SEAT_UNAVAILABLE') notify('warning', 'seatJustTaken', { seat: seatId });
          else if (code === 'SEAT_LIMIT') notify('warning', 'seatLimit', { max: MAX_SEATS_PER_BOOKING });
          else if (code === 'SHOWTIME_CLOSED') notify('warning', 'showtimeClosed');
          else if (code === 'NETWORK') notify('error', 'network');
          else notify('error', 'generic');
          void get().refresh();
        });
    },

    removeSeat: (seatId) => {
      const s = get();
      if (!s.showtimeId || !s.selected.includes(seatId) || s.submitting) return;
      const selected = s.selected.filter((id) => id !== seatId);
      set({
        selected,
        pending: without(s.pending, seatId),
        ...(selected.length === 0 ? { holdExpiresAt: null } : {}),
        ...(s.povSeatId === seatId ? { view: 'overview' as ViewMode, povSeatId: null, previewing: false } : {}),
      });
      // Released straight away, even if the hold is still in flight: the hold's own handler sees it
      // was superseded and releases again if the two requests crossed.
      releaseTracked(s.showtimeId, seatId);
    },

    clearSelection: () => {
      const s = get();
      if (!s.showtimeId || s.selected.length === 0 || s.submitting) return;
      const showtimeId = s.showtimeId;
      const tokens = s.selected.map((id) => {
        const key = seatKey(showtimeId, id);
        dropping.add(key);
        return [key, bumpToken(key)] as const;
      });
      set({ selected: [], pending: {}, holdExpiresAt: null, view: 'overview', povSeatId: null, previewing: false });
      void releaseWithRetry(showtimeId, null).then((ok) => {
        epoch++;
        for (const [key, token] of tokens) if (isLatest(key, token)) dropping.delete(key);
        if (!ok && get().showtimeId === showtimeId) {
          notify('error', 'network');
          void get().refresh();
        }
      });
    },

    enterPov: (seatId) => {
      const s = get();
      if (!s.geometry?.seatById[seatId] || !s.selected.includes(seatId)) return;
      set({ view: 'pov', povSeatId: seatId, previewing: false, hoveredSeatId: null });
    },

    previewSeat: (seatId) => {
      if (!get().geometry?.seatById[seatId]) return;
      set({ view: 'pov', povSeatId: seatId, previewing: true, hoveredSeatId: null });
    },

    exitPov: () => {
      if (get().view === 'pov') set({ view: 'overview', povSeatId: null, previewing: false });
    },

    hover: (seatId) => {
      if (get().hoveredSeatId !== seatId) set({ hoveredSeatId: seatId });
    },

    setLights: (lights) => set({ lights }),
    setShowAudience: (showAudience) => set({ showAudience }),
    setMapOpen: (mapOpen) => set({ mapOpen }),
    recenterLook: () => set((s) => ({ lookResetNonce: s.lookResetNonce + 1 })),

    handleHoldExpired: () => {
      const s = get();
      if (s.selected.length === 0 || s.submitting) return;
      set({ selected: [], pending: {}, holdExpiresAt: null, view: 'overview', povSeatId: null, previewing: false });
      notify('warning', 'holdExpired');
      void get().refresh();
    },

    submitBooking: async ({ customer, paymentMethod }) => {
      const s = get();
      if (!s.showtimeId || s.selected.length === 0) {
        throw new ApiError('VALIDATION', 0, 'No seats selected');
      }
      set({ submitting: true });
      try {
        const booking = await api.createBooking({
          showtimeId: s.showtimeId,
          seatIds: s.selected,
          customer,
          paymentMethod,
        });
        set({ selected: [], pending: {}, holdExpiresAt: null, view: 'overview', povSeatId: null, previewing: false });
        void get().refresh();
        return booking;
      } catch (error) {
        const code = errorCodeOf(error);
        if (code === 'SEAT_UNAVAILABLE' || code === 'SHOWTIME_CLOSED') void get().refresh();
        throw error;
      } finally {
        set({ submitting: false });
      }
    },
  };
});

// ───────────────────────────── Derived helpers ─────────────────────────────

/** How a seat should be drawn for this customer. */
export function seatUiState(state: Pick<BookingState, 'taken' | 'selected'>, seatId: string): SeatUiState {
  if (state.selected.includes(seatId)) return 'selected';
  return state.taken[seatId] ?? 'available';
}

/** Price of one seat for the loaded showtime (0 if unknown). */
export function seatPrice(detail: ShowtimeDetail | null, seat: Pick<SeatInfo, 'type'>): number {
  return detail?.showtime.prices[seat.type] ?? 0;
}

/** The customer's seats with their geometry, in pick order. */
export function useSelectedSeats(): SeatInfo[] {
  const selected = useBooking((s) => s.selected);
  const geometry = useBooking((s) => s.geometry);
  return useMemo(
    () => (geometry ? selected.map((id) => geometry.seatById[id]).filter((seat): seat is SeatInfo => Boolean(seat)) : []),
    [selected, geometry],
  );
}

/** Total price of the current selection. */
export function useSelectionTotal(): number {
  const seats = useSelectedSeats();
  const detail = useBooking((s) => s.detail);
  return useMemo(() => seats.reduce((sum, seat) => sum + seatPrice(detail, seat), 0), [seats, detail]);
}

/** The seat the camera is sitting in, if any. */
export function usePovSeat(): SeatInfo | null {
  const povSeatId = useBooking((s) => s.povSeatId);
  const geometry = useBooking((s) => s.geometry);
  return povSeatId && geometry ? (geometry.seatById[povSeatId] ?? null) : null;
}

/** Whether the house lights should currently be up. */
export function houseLightsOn(state: Pick<BookingState, 'lights' | 'view'>): boolean {
  if (state.lights === 'on') return true;
  if (state.lights === 'off') return false;
  return state.view === 'overview';
}
