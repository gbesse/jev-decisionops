import assert from "node:assert/strict";
import test from "node:test";
import { validateCase, validateResponse } from "../src/index.js";

test("rejects labels outside a Choice option set", () => {
  assert.throws(() => validateCase({ id: "x", state: "x", questions: { q: { type: "choice", instructions: "?", criteria: { a: null, b: null } } }, expected: { q: { type: "choice", value: "c" } } }, 0), /not a choice option/);
});

test("rejects malformed probability mass and extra answers", () => {
  const questions = { q: { type: "choice" as const, instructions: "?", criteria: { a: null, b: null } } };
  assert.throws(() => validateResponse({ model: "m", answers: { q: { type: "choice", choice: "a", probabilities: { a: 0.8, b: 0.3 } } } }, questions), /sum to 1/);
  assert.throws(() => validateResponse({ model: "m", answers: { q: { type: "choice", choice: "a", probabilities: { a: 0.8, b: 0.2 } }, extra: { type: "noul", noul: 1 } } }, questions), /keys do not match/);
});
