/**
 * Deterministic pseudo-random helpers for the demo data: the same key always yields the same
 * sequence, so seeding is reproducible. Not for anything security-related (booking codes for real
 * customers come from node:crypto, see codes.ts).
 */
export type Random = () => number;

/** FNV-1a 32-bit hash of a string. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a tiny, fast 32-bit PRNG with good enough statistics for demo data. Returns [0, 1). */
export function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededRandom(key: string): Random {
  return mulberry32(hashString(key));
}

/** Integer in [0, maxExclusive). */
export function randomIndex(rand: Random, maxExclusive: number): number {
  return Math.min(maxExclusive - 1, Math.floor(rand() * maxExclusive));
}

export function pick<T>(rand: Random, items: readonly T[]): T {
  return items[randomIndex(rand, items.length)];
}

/** Picks a value with probability proportional to its weight. */
export function pickWeighted<T>(rand: Random, entries: ReadonlyArray<readonly [value: T, weight: number]>): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rand() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return entries[entries.length - 1][0];
}
