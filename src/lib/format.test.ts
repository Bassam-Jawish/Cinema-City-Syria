import { describe, expect, it } from 'vitest';
import { translate } from '@/i18n';
import { ar } from '@/i18n/locales/ar';
import { en } from '@/i18n/locales/en';
import {
  dayParts,
  formatCountdown,
  formatDuration,
  formatMegabytes,
  formatPhone,
  formatPrice,
  formatTime,
  seatLabel,
} from './format';

const strip = (s: string) => s.replace(/[⁦-⁩]/g, '');

describe('formatting', () => {
  it('formats file sizes in megabytes with Western digits in both languages', () => {
    expect(formatMegabytes(2432352, 'en')).toBe('2.3');
    expect(formatMegabytes(2432352, 'ar')).toBe('2.3');
    expect(formatMegabytes(512 * 1024 * 1024, 'en')).toBe('512');
  });

  it('formats prices with Western digits in both languages', () => {
    expect(strip(formatPrice(750, 'ar'))).toBe('750 ل.س');
    expect(strip(formatPrice(1250, 'ar'))).toBe('1,250 ل.س');
    expect(formatPrice(1250, 'en')).toBe('SYP 1,250');
  });

  it('formats times in the cinema time zone, 12-hour', () => {
    expect(formatTime('2026-11-15T15:30:00Z', 'ar')).toBe('6:30 م');
    expect(formatTime('2026-11-15T15:30:00Z', 'en')).toBe('6:30 PM');
    expect(formatTime('2026-11-15T10:30:00Z', 'en')).toBe('1:30 PM');
  });

  it('formats durations, countdowns and phone numbers', () => {
    expect(formatDuration(138, 'en')).toBe('2h 18m');
    expect(formatDuration(95, 'ar')).toBe('1 س 35 د');
    expect(formatCountdown(65_000)).toBe('01:05');
    expect(formatCountdown(-5)).toBe('00:00');
    expect(formatPhone('+963944123456')).toBe('+963 944 123 456');
  });

  it('labels days relative to today', () => {
    const now = '2026-11-15T12:00:00Z';
    expect(dayParts('2026-11-15', 'en', now).label).toBe('Today');
    expect(dayParts('2026-11-16', 'ar', now).label).toBe('غداً');
    expect(dayParts('2026-11-20', 'en', now).label).toBe('Fri');
    expect(dayParts('2026-11-20', 'en', now).day).toBe('20');
  });

  it('labels seats in both languages', () => {
    expect(seatLabel({ row: 'F', number: 12 }, 'en')).toBe('Row F · Seat 12');
    expect(seatLabel({ row: 'F', number: 12 }, 'ar')).toBe('الصف F · المقعد 12');
  });
});

describe('translations', () => {
  it('uses all six Arabic plural forms', () => {
    const seats = (count: number) => translate('ar', 'common.hall.seats', { count });
    expect(seats(0)).toBe('لا مقاعد');
    expect(seats(1)).toBe('مقعد واحد');
    expect(seats(2)).toBe('مقعدان');
    expect(seats(3)).toBe('3 مقاعد');
    expect(seats(11)).toBe('11 مقعداً');
    expect(seats(100)).toBe('100 مقعد');
    expect(translate('en', 'common.hall.seats', { count: 1 })).toBe('1 seat');
    expect(translate('en', 'common.hall.seats', { count: 3 })).toBe('3 seats');
  });

  it('interpolates parameters and leaves unknown placeholders visible', () => {
    expect(translate('en', 'common.notices.seatTaken', { seat: 'F12' })).toBe('Seat F12 is already taken.');
    expect(translate('en', 'common.notices.seatTaken')).toBe('Seat {seat} is already taken.');
  });

  it('has a non-empty Arabic string for every English one', () => {
    const walk = (a: unknown, b: unknown, path: string): string[] => {
      if (typeof a === 'string') return typeof b === 'string' && b.trim() ? [] : [path];
      if (a && typeof a === 'object') {
        return Object.keys(a).flatMap((key) =>
          walk((a as Record<string, unknown>)[key], (b as Record<string, unknown> | undefined)?.[key], `${path}.${key}`),
        );
      }
      return [];
    };
    expect(walk(en, ar, 'root')).toEqual([]);
  });
});
