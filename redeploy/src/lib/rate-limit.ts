import "server-only";

/**
 * Small in-process rate limiter for authentication attempts.
 *
 * This lives in memory, so it resets on deploy and is per-instance rather
 * than global. That is enough to blunt online password guessing against a
 * single-instance deployment; if you scale to several instances or want
 * limits that survive restarts, move the counter into Postgres or Redis and
 * keep this interface.
 */

type Bucket = { count: number; firstAt: number; blockedUntil?: number };

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const BLOCK_MS = 15 * 60 * 1000;

/** Drops buckets that have aged out, so the map can't grow without bound. */
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [key, b] of buckets) {
    const expired = now - b.firstAt > WINDOW_MS && (b.blockedUntil ?? 0) < now;
    if (expired) buckets.delete(key);
  }
}

export type RateVerdict = { allowed: true } | { allowed: false; retryAfterSec: number };

export function checkRateLimit(key: string): RateVerdict {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);

  if (bucket?.blockedUntil && bucket.blockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.blockedUntil - now) / 1000) };
  }

  if (!bucket || now - bucket.firstAt > WINDOW_MS) {
    buckets.set(key, { count: 0, firstAt: now });
  }
  return { allowed: true };
}

/** Call after a failed attempt. Returns true once the caller is locked out. */
export function recordFailure(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { count: 0, firstAt: now };

  bucket.count += 1;
  if (bucket.count >= MAX_ATTEMPTS) {
    bucket.blockedUntil = now + BLOCK_MS;
    bucket.count = 0;
    bucket.firstAt = now;
    buckets.set(key, bucket);
    return true;
  }

  buckets.set(key, bucket);
  return false;
}

/** Call after a successful attempt so a good login clears the counter. */
export function clearRateLimit(key: string) {
  buckets.delete(key);
}
