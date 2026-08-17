/**
 * Plain assertion suite for the pure logic. Run with `npm test`.
 * No framework: dependency-free so it runs anywhere, matching the sibling
 * app's approach.
 */
import assert from "node:assert/strict";

import {
  generateResetToken,
  hashResetToken,
  resetTokensMatch,
  resetTokenExpiry,
  isResetTokenLive,
  RESET_TOKEN_TTL_MS,
} from "../password-reset";

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${(err as Error).message.split("\n")[0]}`);
  }
}

// ------------------------------------------------------------- reset tokens
test("a generated token's raw form hashes to its own hash", () => {
  const { raw, hash } = generateResetToken();
  assert.equal(hashResetToken(raw), hash);
});

test("two generated tokens are never equal", () => {
  const a = generateResetToken();
  const b = generateResetToken();
  assert.notEqual(a.raw, b.raw);
  assert.notEqual(a.hash, b.hash);
});

test("the raw token is 64 hex characters (32 bytes)", () => {
  const { raw } = generateResetToken();
  assert.match(raw, /^[0-9a-f]{64}$/);
});

test("resetTokensMatch is true only for identical hex strings", () => {
  const { hash } = generateResetToken();
  assert.equal(resetTokensMatch(hash, hash), true);
  assert.equal(resetTokensMatch(hash, hashResetToken("something-else")), false);
});

test("resetTokensMatch does not throw on mismatched lengths", () => {
  assert.equal(resetTokensMatch("ab", "abcd"), false);
  assert.equal(resetTokensMatch("", ""), true);
});

test("resetTokenExpiry lands exactly one TTL after the reference point", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const expiry = resetTokenExpiry(now);
  assert.equal(expiry.getTime(), now + RESET_TOKEN_TTL_MS);
});

test("a fresh, unused token is live", () => {
  const now = Date.now();
  assert.equal(
    isResetTokenLive({ expiresAt: new Date(now + 60_000), usedAt: null }, now),
    true,
  );
});

test("an expired token is not live even if never used", () => {
  const now = Date.now();
  assert.equal(
    isResetTokenLive({ expiresAt: new Date(now - 1), usedAt: null }, now),
    false,
  );
});

test("a used token is not live even if not yet expired", () => {
  const now = Date.now();
  assert.equal(
    isResetTokenLive({ expiresAt: new Date(now + 60_000), usedAt: new Date(now - 1000) }, now),
    false,
  );
});

test("a token expiring at exactly `now` is not live (boundary is exclusive)", () => {
  const now = Date.now();
  assert.equal(isResetTokenLive({ expiresAt: new Date(now), usedAt: null }, now), false);
});

// --------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log("  ✗ " + f));
  process.exit(1);
}
