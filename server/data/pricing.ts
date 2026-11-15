/**
 * Ticket pricing — every price rule the cinema applies lives in this one file.
 *
 * Amounts are whole NEW Syrian pounds. The cinema's published tariff is a flat price per seat
 * plus a charge for 3D glasses; premium (and, should a VIP hall ever open, vip) seats are priced
 * above it. Change the numbers in PRICING when the tariff changes, then run `npm run db:reset` —
 * each showtime keeps the prices it was published with, so existing showtimes never change
 * under a customer's feet.
 *
 * Only the server computes prices; the client shows the showtime's `prices` map, and totals sent
 * by a client are ignored.
 */
import { SEAT_TYPES, type SeatType } from '../../shared/hall';
import type { Currency, Format, Prices } from '../../shared/types';

export interface PricingConfig {
  currency: Currency;
  /** Price per seat, by seat type. */
  base: Record<SeatType, number>;
  /** Added per seat for a 3D screening (the glasses), for the seat types listed. */
  threeD: { surcharge: number; seatTypes: readonly SeatType[] };
}

export const PRICING: PricingConfig = {
  currency: 'SYP',
  base: { standard: 750, premium: 1_000, vip: 1_500 },
  threeD: { surcharge: 100, seatTypes: ['standard', 'premium', 'vip'] },
};

export interface PriceContext {
  format: Format;
}

/** Price of one seat of `type` at a show. */
export function seatPrice(type: SeatType, show: PriceContext, pricing: PricingConfig = PRICING): number {
  let price = pricing.base[type];
  if (show.format === '3D' && pricing.threeD.seatTypes.includes(type)) price += pricing.threeD.surcharge;
  return price;
}

/** A showtime's price map: one entry per seat type the hall actually has. */
export function showtimePrices(seatTypes: Iterable<SeatType>, show: PriceContext, pricing: PricingConfig = PRICING): Prices {
  const present = new Set(seatTypes);
  const prices: Prices = {};
  for (const type of SEAT_TYPES) {
    if (present.has(type)) prices[type] = seatPrice(type, show, pricing);
  }
  return prices;
}
