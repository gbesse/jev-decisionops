import type { Answer, DecisionObservation, EvalCase, Metrics } from "./types.js";
import { answerConfidence } from "./validation.js";

export function observe(evalCase: EvalCase, answers: Record<string, Answer>, threshold: number): DecisionObservation[] {
  return Object.entries(evalCase.expected).map(([questionId, expected]) => {
    const answer = answers[questionId];
    if (!answer || answer.type !== expected.type) throw new Error(`answer ${questionId} is missing or has the wrong type`);
    const confidence = answerConfidence(answer);
    let predicted: boolean | string | number;
    let correct: boolean;
    let brier: number;
    if (answer.type === "noul" && expected.type === "noul") {
      predicted = answer.noul >= 0.5;
      correct = predicted === expected.value;
      brier = (answer.noul - (expected.value ? 1 : 0)) ** 2;
    } else if (answer.type === "choice" && expected.type === "choice") {
      predicted = answer.choice;
      correct = predicted === expected.value;
      brier = Object.entries(answer.probabilities).reduce((sum, [option, probability]) => sum + (probability - (option === expected.value ? 1 : 0)) ** 2, 0);
    } else if (answer.type === "score" && expected.type === "score") {
      predicted = answer.score;
      correct = Math.abs(answer.score - expected.value) <= (expected.tolerance ?? 0.5);
      const target = String(Math.round(expected.value));
      brier = Object.entries(answer.probabilities).reduce((sum, [level, probability]) => sum + (probability - (level === target ? 1 : 0)) ** 2, 0);
    } else throw new Error(`answer ${questionId} type mismatch`);
    return {
      caseId: evalCase.id,
      questionId,
      type: answer.type,
      expected: expected.value,
      predicted,
      correct,
      confidence,
      accepted: confidence >= threshold,
      brier,
      tags: evalCase.tags ?? [],
      ...(evalCase.group ? { group: evalCase.group } : {}),
    };
  });
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

export function expectedCalibrationError(observations: DecisionObservation[], bins = 10): number {
  if (!observations.length) return 0;
  let error = 0;
  for (let index = 0; index < bins; index++) {
    const low = index / bins;
    const high = (index + 1) / bins;
    const bucket = observations.filter((item) => item.confidence >= low && (index === bins - 1 ? item.confidence <= high : item.confidence < high));
    if (!bucket.length) continue;
    const accuracy = bucket.filter((item) => item.correct).length / bucket.length;
    const confidence = bucket.reduce((sum, item) => sum + item.confidence, 0) / bucket.length;
    error += (bucket.length / observations.length) * Math.abs(accuracy - confidence);
  }
  return error;
}

export function computeMetrics(observations: DecisionObservation[], latencies: number[], errors = 0, bins = 10): Metrics {
  const accepted = observations.filter((item) => item.accepted);
  return {
    total: observations.length + errors,
    successful: observations.length,
    errors,
    accuracy: observations.length ? observations.filter((item) => item.correct).length / observations.length : 0,
    coverage: observations.length ? accepted.length / observations.length : 0,
    acceptedAccuracy: accepted.length ? accepted.filter((item) => item.correct).length / accepted.length : 0,
    brier: observations.length ? observations.reduce((sum, item) => sum + item.brier, 0) / observations.length : 0,
    ece: expectedCalibrationError(observations, bins),
    meanLatencyMs: latencies.length ? latencies.reduce((sum, item) => sum + item, 0) / latencies.length : 0,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
  };
}

export function optimizeThreshold(observations: DecisionObservation[], falseDecisionCost = 1, reviewCost = 0.1) {
  const candidates = [...new Set([0, 1, ...observations.map((item) => item.confidence)])].sort((a, b) => a - b);
  let best = { threshold: 0, cost: Number.POSITIVE_INFINITY, coverage: 0, acceptedAccuracy: 0 };
  for (const threshold of candidates) {
    const accepted = observations.filter((item) => item.confidence >= threshold);
    const rejected = observations.length - accepted.length;
    const wrong = accepted.filter((item) => !item.correct).length;
    const cost = wrong * falseDecisionCost + rejected * reviewCost;
    const candidate = {
      threshold,
      cost,
      coverage: observations.length ? accepted.length / observations.length : 0,
      acceptedAccuracy: accepted.length ? accepted.filter((item) => item.correct).length / accepted.length : 0,
    };
    if (cost < best.cost || (cost === best.cost && candidate.coverage > best.coverage)) best = candidate;
  }
  return best;
}
