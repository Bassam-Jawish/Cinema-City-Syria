/**
 * Typed client for the booking API (see docs/openapi.yaml).
 * Every call resolves with the response payload or rejects with an ApiError.
 */
import { ADMIN_PIN_HEADER, SESSION_HEADER } from '@shared/constants';
import type {
  AdminBookingRow,
  AdminOverview,
  ApiErrorBody,
  Booking,
  CreateBookingRequest,
  ErrorCode,
  HallSummary,
  HoldResult,
  Movie,
  MovieWithShowtimes,
  ReleaseResult,
  ScheduleDay,
  ShowtimeDetail,
  Trailer,
} from '@shared/types';
import { getSessionId } from './session';

/** NETWORK = the request never reached the server (offline, server down). */
export type ClientErrorCode = ErrorCode | 'NETWORK';

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ClientErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function errorCodeOf(error: unknown): ClientErrorCode {
  return error instanceof ApiError ? error.code : 'INTERNAL';
}

interface RequestOptions {
  body?: unknown;
  adminPin?: string;
  signal?: AbortSignal;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', [SESSION_HEADER]: getSessionId() };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.adminPin) headers[ADMIN_PIN_HEADER] = options.adminPin;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError('NETWORK', 0, 'The server could not be reached');
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON body (e.g. a proxy error page) — handled below.
  }

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    if (body?.error?.code) {
      throw new ApiError(body.error.code, response.status, body.error.message, body.error.details);
    }
    // A dev proxy answers 5xx with no JSON when the API process is not running.
    throw new ApiError(response.status >= 502 ? 'NETWORK' : 'INTERNAL', response.status, `HTTP ${response.status}`);
  }
  return payload as T;
}

const enc = encodeURIComponent;

export const api = {
  listMovies: (signal?: AbortSignal) =>
    request<{ movies: MovieWithShowtimes[]; serverTime: string }>('GET', '/movies', { signal }),

  getMovie: (id: string, signal?: AbortSignal) =>
    request<{ movie: Movie; days: ScheduleDay[]; serverTime: string }>('GET', `/movies/${enc(id)}`, { signal }),

  listHalls: (signal?: AbortSignal) => request<{ halls: HallSummary[] }>('GET', '/halls', { signal }),

  getShowtime: (id: string, signal?: AbortSignal) =>
    request<ShowtimeDetail>('GET', `/showtimes/${enc(id)}`, { signal }),

  holdSeat: (showtimeId: string, seatId: string) =>
    request<HoldResult>('POST', `/showtimes/${enc(showtimeId)}/holds`, { body: { seatId } }),

  releaseSeat: (showtimeId: string, seatId: string) =>
    request<ReleaseResult>('DELETE', `/showtimes/${enc(showtimeId)}/holds/${enc(seatId)}`),

  releaseAllSeats: (showtimeId: string) => request<ReleaseResult>('DELETE', `/showtimes/${enc(showtimeId)}/holds`),

  createBooking: (body: CreateBookingRequest) =>
    request<{ booking: Booking }>('POST', '/bookings', { body }).then((r) => r.booking),

  getBooking: (code: string, signal?: AbortSignal) =>
    request<{ booking: Booking }>('GET', `/bookings/${enc(code)}`, { signal }).then((r) => r.booking),

  /** Bookings made from this browser, newest first. */
  myBookings: (signal?: AbortSignal) =>
    request<{ bookings: Booking[] }>('GET', '/bookings', { signal }).then((r) => r.bookings),

  cancelBooking: (code: string) =>
    request<{ booking: Booking }>('POST', `/bookings/${enc(code)}/cancel`).then((r) => r.booking),

  /** URL of the live seat stream (Server-Sent Events) for a showtime. */
  seatEventsUrl: (showtimeId: string) => `/api/showtimes/${enc(showtimeId)}/events?session=${enc(getSessionId())}`,

  admin: {
    login: (pin: string) => request<{ ok: true }>('POST', '/admin/login', { body: { pin } }),

    overview: (pin: string, date?: string, signal?: AbortSignal) =>
      request<AdminOverview>('GET', `/admin/overview${date ? `?date=${enc(date)}` : ''}`, { adminPin: pin, signal }),

    bookings: (pin: string, params: { date?: string; q?: string; limit?: number } = {}, signal?: AbortSignal) => {
      const query = new URLSearchParams();
      if (params.date) query.set('date', params.date);
      if (params.q) query.set('q', params.q);
      if (params.limit) query.set('limit', String(params.limit));
      const qs = query.toString();
      return request<{ bookings: AdminBookingRow[]; total: number }>('GET', `/admin/bookings${qs ? `?${qs}` : ''}`, {
        adminPin: pin,
        signal,
      });
    },

    checkIn: (pin: string, code: string) =>
      request<{ booking: Booking }>('POST', `/admin/bookings/${enc(code)}/check-in`, { adminPin: pin }).then(
        (r) => r.booking,
      ),

    cancel: (pin: string, code: string) =>
      request<{ booking: Booking }>('POST', `/admin/bookings/${enc(code)}/cancel`, { adminPin: pin }).then(
        (r) => r.booking,
      ),

    /** Wipes customer bookings and holds and re-seeds the demo data. */
    resetDemo: (pin: string) => request<{ ok: true }>('POST', '/admin/reset', { adminPin: pin }),

    /**
     * Uploads a video file as the film's trailer, replacing any previous one. The file is sent as
     * the request body (no form encoding); `onProgress` receives 0–1 as it goes up.
     */
    uploadTrailer: (pin: string, movieId: string, file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal) =>
      new Promise<Trailer>((resolve, reject) => {
        // XMLHttpRequest rather than fetch: fetch cannot report upload progress.
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/admin/movies/${enc(movieId)}/trailer`);
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.setRequestHeader(ADMIN_PIN_HEADER, pin);
        xhr.setRequestHeader(SESSION_HEADER, getSessionId());
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) onProgress?.(event.loaded / event.total);
        };
        xhr.onload = () => {
          let payload: unknown = null;
          try {
            payload = JSON.parse(xhr.responseText);
          } catch {
            // Non-JSON body (e.g. a proxy error page) — handled below.
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve((payload as { trailer: Trailer }).trailer);
            return;
          }
          const body = payload as ApiErrorBody | null;
          reject(
            body?.error?.code
              ? new ApiError(body.error.code, xhr.status, body.error.message, body.error.details)
              : new ApiError(xhr.status >= 502 ? 'NETWORK' : 'INTERNAL', xhr.status, `HTTP ${xhr.status}`),
          );
        };
        xhr.onerror = () => reject(new ApiError('NETWORK', 0, 'The server could not be reached'));
        xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
        signal?.addEventListener('abort', () => xhr.abort(), { once: true });
        xhr.send(file);
      }),

    /** Deletes the film's trailer; the hall shows its still again. */
    removeTrailer: (pin: string, movieId: string) =>
      request<{ ok: true }>('DELETE', `/admin/movies/${enc(movieId)}/trailer`, { adminPin: pin }),
  },
};
