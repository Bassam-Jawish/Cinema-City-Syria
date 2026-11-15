/**
 * Locale-aware formatting for the two interface languages.
 *
 * Everything is displayed in the cinema's time zone (Asia/Damascus), whatever the device's
 * own zone is, and with Western digits (0–9) in both languages — the prevailing convention
 * for prices, times and seat numbers on Syrian websites and apps.
 */
import { useMemo } from 'react';
import { CINEMA_TIME_ZONE } from '@shared/constants';
import type { SeatInfo } from '@shared/hall';
import { addDays, cinemaDate } from '@shared/time';
import type { Lang } from '@shared/types';
import { translate, useI18n } from '@/i18n';

const LOCALE: Record<Lang, string> = { ar: 'ar-SY-u-nu-latn', en: 'en-GB' };

const cache = new Map<string, Intl.DateTimeFormat>();
function dateFormat(lang: Lang, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${lang}|${JSON.stringify(options)}`;
  let format = cache.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(LOCALE[lang], { timeZone: CINEMA_TIME_ZONE, ...options });
    cache.set(key, format);
  }
  return format;
}

const numberFormats: Partial<Record<Lang, Intl.NumberFormat>> = {};
export function formatNumber(value: number, lang: Lang): string {
  const format = (numberFormats[lang] ??= new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 0 }));
  return format.format(value);
}

/** "25,000 ل.س" / "SYP 25,000". The currency mark is isolated so it never jumps around in RTL text. */
export function formatPrice(amount: number, lang: Lang): string {
  const figure = formatNumber(amount, lang);
  return lang === 'ar' ? `⁦${figure}⁩ ل.س` : `SYP ${figure}`;
}

type Instant = string | number | Date;

/** en-GB writes "6:30 pm"; cinema listings read better with "6:30 PM". */
const upperMeridiem = (text: string): string => text.replace(/\b(am|pm)\b/g, (m) => m.toUpperCase());

/** "6:30 م" / "6:30 PM" */
export function formatTime(instant: Instant, lang: Lang): string {
  return upperMeridiem(dateFormat(lang, { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(instant)));
}

/** "السبت 15 تشرين الثاني" / "Sat 15 Nov" */
export function formatDayShort(instant: Instant, lang: Lang): string {
  return dateFormat(lang, { weekday: lang === 'ar' ? 'long' : 'short', day: 'numeric', month: lang === 'ar' ? 'long' : 'short' }).format(
    new Date(instant),
  );
}

/** "السبت، 15 تشرين الثاني 2026" / "Saturday, 15 November 2026" */
export function formatDateLong(instant: Instant, lang: Lang): string {
  return dateFormat(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(instant));
}

/** "15 تشرين الثاني 2026، 6:30 م" */
export function formatDateTime(instant: Instant, lang: Lang): string {
  return upperMeridiem(
    dateFormat(lang, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(instant)),
  );
}

/** Noon UTC of a cinema calendar day — a safe instant for formatting that day in any zone. */
function middayOf(date: string): Date {
  return new Date(`${date}T09:00:00Z`);
}

export interface DayParts {
  /** "Today" / "Tomorrow" / weekday name. */
  label: string;
  weekday: string;
  /** Day of the month, "15". */
  day: string;
  /** Short month name. */
  month: string;
  isToday: boolean;
}

/** Pieces for a date tab, from a cinema calendar day (YYYY-MM-DD). */
export function dayParts(date: string, lang: Lang, now: Instant = Date.now()): DayParts {
  const today = cinemaDate(now);
  const instant = middayOf(date);
  const weekday = dateFormat(lang, { weekday: lang === 'ar' ? 'long' : 'short' }).format(instant);
  const isToday = date === today;
  const label = isToday
    ? translate(lang, 'common.time.today')
    : date === addDays(today, 1)
      ? translate(lang, 'common.time.tomorrow')
      : weekday;
  return {
    label,
    weekday,
    day: dateFormat(lang, { day: 'numeric' }).format(instant),
    month: dateFormat(lang, { month: 'short' }).format(instant),
    isToday,
  };
}

/** "2h 18m" / "2 س 18 د" */
export function formatDuration(minutes: number, lang: Lang): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (lang === 'ar') return h > 0 ? `${h} س ${m} د` : `${m} د`;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** "05:42" countdown from milliseconds. Never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** "Row F · Seat 12" / "الصف F · المقعد 12" */
export function seatLabel(seat: Pick<SeatInfo, 'row' | 'number'>, lang: Lang): string {
  return translate(lang, 'common.seat.label', { row: seat.row, number: seat.number });
}

/** "+963 912 345 678" — always rendered left-to-right. */
export function formatPhone(phone: string): string {
  const m = /^\+963(9\d{2})(\d{3})(\d{3})$/.exec(phone);
  return m ? `+963 ${m[1]} ${m[2]} ${m[3]}` : phone;
}

export interface Formatters {
  price: (amount: number) => string;
  number: (value: number) => string;
  time: (instant: Instant) => string;
  dayShort: (instant: Instant) => string;
  dateLong: (instant: Instant) => string;
  dateTime: (instant: Instant) => string;
  day: (date: string, now?: Instant) => DayParts;
  duration: (minutes: number) => string;
  seat: (seat: Pick<SeatInfo, 'row' | 'number'>) => string;
}

/** Formatters bound to the current interface language. */
export function useFormat(): Formatters {
  const { lang } = useI18n();
  return useMemo<Formatters>(
    () => ({
      price: (amount) => formatPrice(amount, lang),
      number: (value) => formatNumber(value, lang),
      time: (instant) => formatTime(instant, lang),
      dayShort: (instant) => formatDayShort(instant, lang),
      dateLong: (instant) => formatDateLong(instant, lang),
      dateTime: (instant) => formatDateTime(instant, lang),
      day: (date, now) => dayParts(date, lang, now),
      duration: (minutes) => formatDuration(minutes, lang),
      seat: (seat) => seatLabel(seat, lang),
    }),
    [lang],
  );
}
