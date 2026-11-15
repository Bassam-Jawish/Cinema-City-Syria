/**
 * Booking references: "CC-" + 6 characters from an alphabet without look-alikes (no 0/O, 1/I/L),
 * so a code can be read out over the phone or typed from a screenshot.
 */
import { randomInt } from 'node:crypto';

export const BOOKING_CODE_PREFIX = 'CC-';
export const BOOKING_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const BOOKING_CODE_LENGTH = 6;

const CODE_BODY = new RegExp(`^[${BOOKING_CODE_ALPHABET}]{${BOOKING_CODE_LENGTH}}$`);

/** Builds a code from a source of indices in [0, n). */
export function makeBookingCode(nextIndex: (n: number) => number): string {
  let body = '';
  for (let i = 0; i < BOOKING_CODE_LENGTH; i++) body += BOOKING_CODE_ALPHABET[nextIndex(BOOKING_CODE_ALPHABET.length)];
  return BOOKING_CODE_PREFIX + body;
}

/** A code for a real customer booking (cryptographically random; uniqueness is checked by the caller). */
export function randomBookingCode(): string {
  return makeBookingCode((n) => randomInt(n));
}

/**
 * Canonical form ("CC-7K4M2Q") of user input such as "cc-7k4m2q", "7K4M2Q" or " CC 7K4M2Q ",
 * or null if it cannot be a booking reference.
 */
export function normalizeBookingCode(input: string): string | null {
  let body = input.trim().toUpperCase().replace(/\s+/g, '');
  if (body.startsWith(BOOKING_CODE_PREFIX)) body = body.slice(BOOKING_CODE_PREFIX.length);
  else if (body.length === BOOKING_CODE_LENGTH + 2 && body.startsWith('CC')) body = body.slice(2);
  return CODE_BODY.test(body) ? BOOKING_CODE_PREFIX + body : null;
}
