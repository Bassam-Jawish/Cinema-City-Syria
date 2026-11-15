/**
 * Request validation (zod). A failure becomes 400 VALIDATION with `details` = the issues
 * (`path` + `message` each).
 */
import { z } from 'zod';
import { addDays } from '../shared/time';
import { HttpError } from './errors';

export interface ValidationIssue {
  path: Array<string | number>;
  message: string;
}

export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.map((key) => (typeof key === 'symbol' ? String(key) : key)),
      message: issue.message,
    }));
    throw new HttpError(400, 'VALIDATION', 'The request is invalid', issues);
  }
  return result.data;
}

const SESSION_ID = /^[A-Za-z0-9_-]{16,64}$/;

/** The session id if `value` is a well-formed one, else null. */
export function parseSessionId(value: unknown): string | null {
  return typeof value === 'string' && SESSION_ID.test(value) ? value : null;
}

/** Trims, turns control characters into spaces and collapses runs of whitespace. */
export function normalizeName(name: string): string {
  return name.replace(/\p{Cc}/gu, ' ').trim().replace(/\s+/g, ' ');
}

const seatId = z.string().min(1).max(16);

export const holdRequestSchema = z.object({ seatId });

export const bookingRequestSchema = z.object({
  showtimeId: z.string().min(1).max(100),
  seatIds: z
    .array(seatId)
    .min(1, 'Choose at least one seat')
    .superRefine((ids, ctx) => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) ctx.addIssue({ code: 'custom', message: `Seat ${id} is listed more than once` });
        seen.add(id);
      }
    }),
  customer: z.object({
    name: z
      .string()
      .max(500)
      .transform(normalizeName)
      .refine((name) => {
        const length = Array.from(name).length;
        return length >= 2 && length <= 60;
      }, 'The name must be 2–60 characters long'),
    // Checked against normalizeSyrianMobile by the service, which reports { field: 'customer.phone' }.
    phone: z.string().max(64),
  }),
  paymentMethod: z.enum(['box_office', 'online_demo']),
});

export type BookingRequest = z.output<typeof bookingRequestSchema>;

export const loginRequestSchema = z.object({ pin: z.string().max(128) });

/** YYYY-MM-DD that is a real calendar day. */
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD')
  .refine((date) => addDays(date, 0) === date, 'Not a calendar date');

export const overviewQuerySchema = z.object({ date: calendarDate.optional() });

export const adminBookingsQuerySchema = z.object({
  date: calendarDate.optional(),
  q: z.string().max(100).optional(),
  limit: z.string().regex(/^\d{1,9}$/, 'limit must be a positive integer').optional(),
});
