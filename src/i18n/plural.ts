import type { PluralForms } from './index';

/**
 * Marks a dictionary entry as plural-aware. Use it in BOTH languages so the entry has the
 * same type on each side:
 *
 *   en: seatCount: plural({ one: '{count} seat', other: '{count} seats' })
 *   ar: seatCount: plural({ zero: 'لا مقاعد', one: 'مقعد واحد', two: 'مقعدان',
 *                           few: '{count} مقاعد', many: '{count} مقعداً', other: '{count} مقعد' })
 *
 * Call it as t('…seatCount', { count }). Arabic categories: zero (0), one (1), two (2),
 * few (3–10), many (11–99), other (100+).
 */
export const plural = (forms: PluralForms): PluralForms => forms;
