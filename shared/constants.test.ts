import { describe, expect, it } from 'vitest';
import { normalizeSyrianMobile } from './constants';
import { addDays, cinemaDate, cinemaDateTimeToUtc, cinemaMinutesOfDay, daysBetween, isWeekend, weekdayOf } from './time';

describe('normalizeSyrianMobile', () => {
  it.each([
    ['0944 123 456', '+963944123456'],
    ['0944-123-456', '+963944123456'],
    ['+963 944 123 456', '+963944123456'],
    ['00963944123456', '+963944123456'],
    ['963944123456', '+963944123456'],
    ['944123456', '+963944123456'],
    ['٠٩٤٤١٢٣٤٥٦', '+963944123456'],
    ['0992 009 424', '+963992009424'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeSyrianMobile(input)).toBe(expected);
  });

  it.each(['', '0114123456', '+961 3 123 456', '0944 123 45', '0944 123 4567', 'abc'])('rejects %s', (input) => {
    expect(normalizeSyrianMobile(input)).toBeNull();
  });
});

describe('cinema calendar (Asia/Damascus, UTC+3)', () => {
  it('maps instants to the local calendar day', () => {
    expect(cinemaDate('2026-11-15T20:59:00Z')).toBe('2026-11-15');
    expect(cinemaDate('2026-11-15T21:00:00Z')).toBe('2026-11-16');
    expect(cinemaMinutesOfDay('2026-11-15T15:30:00Z')).toBe(18 * 60 + 30);
  });

  it('converts a local wall-clock time to UTC', () => {
    expect(cinemaDateTimeToUtc('2026-11-15', '18:30').toISOString()).toBe('2026-11-15T15:30:00.000Z');
    expect(cinemaDateTimeToUtc('2026-11-15', '01:00').toISOString()).toBe('2026-11-14T22:00:00.000Z');
  });

  it('does date arithmetic across months and years', () => {
    expect(addDays('2026-11-29', 3)).toBe('2026-12-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-11-15', '2026-11-22')).toBe(7);
  });

  it('knows the Syrian weekend is Friday and Saturday', () => {
    expect(weekdayOf('2026-11-15')).toBe(0); // Sunday
    expect(isWeekend('2026-11-20')).toBe(true); // Friday
    expect(isWeekend('2026-11-21')).toBe(true); // Saturday
    expect(isWeekend('2026-11-22')).toBe(false);
  });
});
