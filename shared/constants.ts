/** Business rules shared by the server (which enforces them) and the client (which explains them). */

/** Most seats one customer may hold or book for a single showtime. */
export const MAX_SEATS_PER_BOOKING = 8;

/** How long selected seats stay reserved for a customer who has not checked out yet. */
export const DEFAULT_HOLD_MINUTES = 10;

/** Number of calendar days (starting today) for which showtimes are published. */
export const SCHEDULE_DAYS = 7;

/** A showtime is flagged "filling fast" once this share of its seats is gone. */
export const FILLING_FAST_THRESHOLD = 0.7;

/** The cinema's time zone. Syria has been on UTC+3 all year round since October 2022. */
export const CINEMA_TIME_ZONE = 'Asia/Damascus';
export const CINEMA_UTC_OFFSET_MINUTES = 180;

/** Request header carrying the anonymous browser session id that owns seat holds. */
export const SESSION_HEADER = 'x-session-id';
/** Request header carrying the staff PIN for /api/admin routes. */
export const ADMIN_PIN_HEADER = 'x-admin-pin';

/** Syrian mobile numbers: +963 9XX XXX XXX (also accepted as 09XX XXX XXX or 009639…). */
export const SYRIAN_MOBILE_REGEX = /^\+9639\d{8}$/;

/** Normalises user input to +9639XXXXXXXX, or returns null if it is not a Syrian mobile number. */
export function normalizeSyrianMobile(input: string): string | null {
  // Accept Arabic-Indic digits too, then strip spacing and punctuation.
  const latin = input.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  let digits = latin.replace(/[^\d+]/g, '');
  if (digits.startsWith('00963')) digits = `+963${digits.slice(5)}`;
  else if (digits.startsWith('963')) digits = `+${digits}`;
  else if (digits.startsWith('09')) digits = `+963${digits.slice(1)}`;
  else if (digits.startsWith('9') && digits.length === 9) digits = `+963${digits}`;
  return SYRIAN_MOBILE_REGEX.test(digits) ? digits : null;
}
