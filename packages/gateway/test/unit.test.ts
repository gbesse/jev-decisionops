import assert from "node:assert/strict";
import test from "node:test";
import { CircuitBreaker, RateLimiter, TtlLruCache, redactRequest, validateRequest, validateResponse } from "../src/index.js";

test("TTL/LRU cache evicts the least recently used entry", () => {
  const cache = new TtlLruCache<{ n: number }>(2, 1000);
  cache.set("a", { n: 1 }); cache.set("b", { n: 2 }); cache.get("a"); cache.set("c", { n: 3 });
  assert.equal(cache.get("b"), undefined);
  assert.deepEqual(cache.get("a"), { n: 1 });
});

test("rate limiter resets and circuit breaker cools down", () => {
  const limiter = new RateLimiter(2, 100);
  assert.equal(limiter.consume("x", 0).allowed, true);
  assert.equal(limiter.consume("x", 1).allowed, true);
  assert.equal(limiter.consume("x", 2).allowed, false);
  assert.equal(limiter.consume("x", 101).allowed, true);
  const circuit = new CircuitBreaker(2, 100);
  circuit.failure(0); circuit.failure(1); assert.equal(circuit.canAttempt(50), false); assert.equal(circuit.canAttempt(101), true);
});

test("strict request and response validation fails closed", () => {
  assert.throws(() => validateRequest({ state: "x", model: "m", questions: {}, extra: true }), /unknown fields/);
  const questions = { q: { type: "choice" as const, instructions: "?", criteria: { a: null, b: null } } };
  assert.throws(() => validateResponse({ model: "m", answers: { q: { type: "choice", choice: "a", probabilities: { a: 0.5, b: 0.4 } } } }, questions), /sum to 1/);
});

test("redacts explicit paths and common secret keys without mutating the input", () => {
  const input = { state: { customer: { email: "a@example.com" }, api_key: "live-secret", note: "keep" }, model: "m", questions: { q: { type: "noul" as const, instructions: "?" } } };
  const result = redactRequest(input, { enabled: true, paths: ["state.customer.email"] });
  assert.equal(result.count, 2);
  assert.deepEqual(result.request.state, { customer: { email: "[REDACTED]" }, api_key: "[REDACTED]", note: "keep" });
  assert.equal(input.state.customer.email, "a@example.com");
});
