import { randomBytes, createHash, timingSafeEqual } from "crypto";

/**
 * Reset-token generation and verification. Pure with respect to the database
 * — callers do the reading and writing — so the security-critical part
 * (never storing a usable token, comparing without a timing leak) is
 * testable on its own.
 *
 * Deliberately no "server-only" guard: it is pure logic over Node's `crypto`,
 * with nothing secret baked in, and the guard would block running this file
 * directly under a plain test runner instead of Next's bundler.
 */

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export function generateResetToken() {
  const raw = randomBytes(32).toString("hex");
  return { raw, hash: hashResetToken(raw) };
}

export function hashResetToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

/** Constant-time comparison so a mistimed response can't leak how much of a guess was right. */
export function resetTokensMatch(a: string, b: string) {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function resetTokenExpiry(now = Date.now()) {
  return new Date(now + RESET_TOKEN_TTL_MS);
}

export function isResetTokenLive(
  token: { expiresAt: Date; usedAt: Date | null },
  now = Date.now(),
) {
  return token.usedAt === null && token.expiresAt.getTime() > now;
}
