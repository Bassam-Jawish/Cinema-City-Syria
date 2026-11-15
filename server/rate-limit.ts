/**
 * A simple in-memory fixed-window rate limiter. Good enough for a single-process demo server;
 * a deployment with several processes would need a shared store instead.
 */
export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
}

interface Window {
  start: number;
  count: number;
}

export class FixedWindowLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly rule: RateLimitRule;
  private readonly now: () => number;
  private lastPrune: number;

  constructor(rule: RateLimitRule, now: () => number = Date.now) {
    this.rule = rule;
    this.now = now;
    this.lastPrune = now();
  }

  /** Counts one request for `key`. Returns 0 if it is allowed, otherwise the ms until the window resets. */
  hit(key: string): number {
    const now = this.now();
    this.prune(now);
    const window = this.current(key, now) ?? { start: now, count: 0 };
    window.count++;
    this.windows.set(key, window);
    return window.count > this.rule.limit ? this.remaining(window, now) : 0;
  }

  /** Without counting anything: 0 if `key` may proceed, otherwise the ms until it may. */
  retryAfter(key: string): number {
    const now = this.now();
    const window = this.current(key, now);
    return window && window.count >= this.rule.limit ? this.remaining(window, now) : 0;
  }

  reset(key?: string): void {
    if (key === undefined) this.windows.clear();
    else this.windows.delete(key);
  }

  private current(key: string, now: number): Window | undefined {
    const window = this.windows.get(key);
    // A clock that jumped backwards (tests, NTP) also starts a fresh window.
    return window && now >= window.start && now - window.start < this.rule.windowMs ? window : undefined;
  }

  private remaining(window: Window, now: number): number {
    return Math.max(1, window.start + this.rule.windowMs - now);
  }

  private prune(now: number): void {
    if (Math.abs(now - this.lastPrune) < this.rule.windowMs) return;
    this.lastPrune = now;
    for (const [key, window] of this.windows) {
      if (!(now >= window.start && now - window.start < this.rule.windowMs)) this.windows.delete(key);
    }
  }
}
