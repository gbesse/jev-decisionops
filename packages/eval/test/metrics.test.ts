import assert from "node:assert/strict";
import test from "node:test";
import { computeMetrics, expectedCalibrationError, observe, optimizeThreshold } from "../src/index.js";
import type { EvalCase } from "../src/types.js";

const evalCase: EvalCase = {
  id: "one", state: "urgent billing issue",
  questions: {
    urgent: { type: "noul", instructions: "urgent?" },
    route: { type: "choice", instructions: "route?", criteria: { billing: null, technical: null } },
  },
  expected: { urgent: { type: "noul", value: true }, route: { type: "choice", value: "billing" } },
  tags: ["support"],
};

test("observes correctness, confidence, and multiclass Brier", () => {
  const values = observe(evalCase, {
    urgent: { type: "noul", noul: 0.9 },
    route: { type: "choice", choice: "technical", probabilities: { billing: 0.4, technical: 0.6 } },
  }, 0.75);
  assert.equal(values[0]?.correct, true);
  assert.equal(values[0]?.accepted, true);
  assert.ok(Math.abs((values[0]?.brier ?? 0) - 0.01) < 1e-9);
  assert.equal(values[1]?.correct, false);
  assert.equal(values[1]?.accepted, false);
  assert.ok(Math.abs((values[1]?.brier ?? 0) - 0.72) < 1e-9);
});

test("computes coverage and accepted accuracy", () => {
  const values = observe(evalCase, {
    urgent: { type: "noul", noul: 0.9 },
    route: { type: "choice", choice: "technical", probabilities: { billing: 0.4, technical: 0.6 } },
  }, 0.75);
  const metrics = computeMetrics(values, [10, 20], 0, 5);
  assert.equal(metrics.accuracy, 0.5);
  assert.equal(metrics.coverage, 0.5);
  assert.equal(metrics.acceptedAccuracy, 1);
  assert.equal(metrics.p95LatencyMs, 20);
  assert.ok(expectedCalibrationError(values, 5) >= 0);
});

test("optimizes the review threshold against declared costs", () => {
  const values = observe(evalCase, {
    urgent: { type: "noul", noul: 0.9 },
    route: { type: "choice", choice: "technical", probabilities: { billing: 0.4, technical: 0.6 } },
  }, 0);
  const optimum = optimizeThreshold(values, 1, 0.1);
  assert.equal(optimum.threshold, 0.9);
  assert.equal(optimum.acceptedAccuracy, 1);
});
