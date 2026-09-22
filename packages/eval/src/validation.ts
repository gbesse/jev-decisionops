import type { Answer, DecisionResponse, EvalCase, EvalConfig, JsonValue, Question } from "./types.js";

export function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
}

function assertProbability(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${path} must be between 0 and 1`);
}

function assertJsonValue(value: unknown, path: string): asserts value is JsonValue {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (Array.isArray(value)) return value.forEach((child, index) => assertJsonValue(child, `${path}[${index}]`));
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).forEach(([key, child]) => assertJsonValue(child, `${path}.${key}`));
  throw new Error(`${path} must be JSON-serializable`);
}

function assertNoUnknown(value: Record<string, unknown>, allowed: string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${path} contains unknown fields: ${unknown.join(", ")}`);
}

export function validateQuestion(value: unknown, path: string): asserts value is Question {
  assertObject(value, path);
  if (!["noul", "choice", "score"].includes(String(value.type))) throw new Error(`${path}.type is invalid`);
  assertJsonValue(value.instructions, `${path}.instructions`);
  if (value.type === "choice") {
    assertObject(value.criteria, `${path}.criteria`);
    const keys = Object.keys(value.criteria);
    if (keys.length < 2 || keys.length > 255) throw new Error(`${path}.criteria must contain 2..255 options`);
    for (const [key, child] of Object.entries(value.criteria)) assertJsonValue(child, `${path}.criteria.${key}`);
  }
  if (value.type === "score") {
    if (!Array.isArray(value.criteria) || value.criteria.length < 2) throw new Error(`${path}.criteria must contain at least two levels`);
    value.criteria.forEach((child, index) => assertJsonValue(child, `${path}.criteria[${index}]`));
  }
}

export function validateConfig(value: unknown): asserts value is EvalConfig {
  assertObject(value, "config");
  assertNoUnknown(value, ["version", "dataset", "outputDir", "model", "provider", "run", "policy", "gates"], "config");
  if (value.version !== 1) throw new Error("config.version must be 1");
  if (typeof value.dataset !== "string" || !value.dataset) throw new Error("config.dataset is required");
  if (typeof value.model !== "string" || !value.model) throw new Error("config.model is required");
  assertObject(value.provider, "config.provider");
  assertNoUnknown(value.provider, ["type", "endpoint", "apiKeyEnv", "headers"], "config.provider");
  if (!["typesafe", "http", "recorded"].includes(String(value.provider.type))) throw new Error("config.provider.type is invalid");
  if (value.provider.type === "http" && typeof value.provider.endpoint !== "string") throw new Error("http provider requires endpoint");
  if (value.provider.headers !== undefined) { assertObject(value.provider.headers, "config.provider.headers"); if (Object.values(value.provider.headers).some((item) => typeof item !== "string")) throw new Error("config.provider.headers values must be strings"); }
  for (const [name, section, fields] of [
    ["run", value.run, ["concurrency", "timeoutMs", "maxRetries", "resume"]],
    ["policy", value.policy, ["confidenceThreshold", "calibrationBins", "costs"]],
    ["gates", value.gates, ["minAccuracy", "minCoverage", "minAcceptedAccuracy", "maxBrier", "maxEce"]],
  ] as Array<[string, unknown, string[]]>) if (section !== undefined) { assertObject(section, `config.${name}`); assertNoUnknown(section, fields, `config.${name}`); }
  const policySection = value.policy as Record<string, unknown> | undefined;
  if (policySection?.costs !== undefined) { assertObject(policySection.costs, "config.policy.costs"); assertNoUnknown(policySection.costs, ["falseDecision", "review"], "config.policy.costs"); }
  const threshold = (value.policy as Record<string, unknown> | undefined)?.confidenceThreshold;
  if (threshold !== undefined) assertProbability(threshold, "config.policy.confidenceThreshold");
  for (const [path, raw] of [
    ["run.concurrency", (value.run as Record<string, unknown> | undefined)?.concurrency],
    ["run.timeoutMs", (value.run as Record<string, unknown> | undefined)?.timeoutMs],
    ["policy.calibrationBins", (value.policy as Record<string, unknown> | undefined)?.calibrationBins],
  ] as const) if (raw !== undefined && (!Number.isInteger(raw) || (raw as number) <= 0)) throw new Error(`${path} must be a positive integer`);
  const retries = (value.run as Record<string, unknown> | undefined)?.maxRetries;
  if (retries !== undefined && (!Number.isInteger(retries) || (retries as number) < 0)) throw new Error("run.maxRetries must be a non-negative integer");
  const resume = (value.run as Record<string, unknown> | undefined)?.resume;
  if (resume !== undefined && typeof resume !== "boolean") throw new Error("run.resume must be boolean");
  const gates = value.gates as Record<string, unknown> | undefined;
  for (const name of ["minAccuracy", "minCoverage", "minAcceptedAccuracy", "maxEce"]) if (gates?.[name] !== undefined) assertProbability(gates[name], `config.gates.${name}`);
  if (gates?.maxBrier !== undefined && (typeof gates.maxBrier !== "number" || gates.maxBrier < 0)) throw new Error("config.gates.maxBrier must be non-negative");
  const costs = (value.policy as Record<string, unknown> | undefined)?.costs as Record<string, unknown> | undefined;
  for (const name of ["falseDecision", "review"]) if (costs?.[name] !== undefined && (typeof costs[name] !== "number" || (costs[name] as number) < 0)) throw new Error(`config.policy.costs.${name} must be non-negative`);
}

export function validateCase(value: unknown, index: number): asserts value is EvalCase {
  const path = `cases[${index}]`;
  assertObject(value, path);
  if (typeof value.id !== "string" || !value.id) throw new Error(`${path}.id is required`);
  assertJsonValue(value.state, `${path}.state`);
  assertObject(value.questions, `${path}.questions`);
  assertObject(value.expected, `${path}.expected`);
  const questions = value.questions as Record<string, unknown>;
  const expectedAnswers = value.expected as Record<string, unknown>;
  const questionEntries = Object.entries(questions);
  if (questionEntries.length === 0) throw new Error(`${path}.questions must not be empty`);
  for (const [id, question] of questionEntries) {
    validateQuestion(question, `${path}.questions.${id}`);
    const expected = expectedAnswers[id];
    assertObject(expected, `${path}.expected.${id}`);
    if (expected.type !== question.type) throw new Error(`${path}.expected.${id}.type must match question type`);
    if (question.type === "noul" && typeof expected.value !== "boolean") throw new Error(`${path}.expected.${id}.value must be boolean`);
    if (question.type === "choice" && (typeof expected.value !== "string" || !(expected.value in question.criteria))) throw new Error(`${path}.expected.${id}.value is not a choice option`);
    if (question.type === "score" && (typeof expected.value !== "number" || !Number.isFinite(expected.value))) throw new Error(`${path}.expected.${id}.value must be numeric`);
    if (question.type === "score" && typeof expected.value === "number" && (expected.value < 0 || expected.value > question.criteria.length - 1)) throw new Error(`${path}.expected.${id}.value must be within the score levels`);
  }
  const unexpected = Object.keys(expectedAnswers).filter((key) => !(key in questions));
  if (unexpected.length) throw new Error(`${path}.expected has unknown questions: ${unexpected.join(", ")}`);
}

export function validateResponse(value: unknown, questions: Record<string, Question>): asserts value is DecisionResponse {
  assertObject(value, "response");
  if (typeof value.model !== "string" || !value.model) throw new Error("response.model is required");
  assertObject(value.answers, "response.answers");
  const expectedKeys = Object.keys(questions).sort();
  const actualKeys = Object.keys(value.answers).sort();
  if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) throw new Error("response answer keys do not match request question keys");
  for (const [id, question] of Object.entries(questions)) {
    const answer = value.answers[id];
    assertObject(answer, `response.answers.${id}`);
    if (answer.type !== question.type) throw new Error(`response.answers.${id}.type does not match question`);
    if (answer.type === "noul") assertProbability(answer.noul, `response.answers.${id}.noul`);
    else {
      if (answer.type === "choice" && (question.type !== "choice" || typeof answer.choice !== "string" || !(answer.choice in question.criteria))) throw new Error(`response.answers.${id}.choice is invalid`);
      if (answer.type === "score" && (typeof answer.score !== "number" || !Number.isFinite(answer.score))) throw new Error(`response.answers.${id}.score is invalid`);
      assertObject(answer.probabilities, `response.answers.${id}.probabilities`);
      const keys = answer.type === "choice"
        ? Object.keys((question as import("./types.js").ChoiceQuestion).criteria)
        : (question as import("./types.js").ScoreQuestion).criteria.map((_, index) => String(index));
      const probabilities = answer.probabilities as Record<string, unknown>;
      if (keys.some((key) => !(key in probabilities)) || Object.keys(probabilities).some((key) => !keys.includes(key))) throw new Error(`response.answers.${id}.probability keys are invalid`);
      let sum = 0;
      for (const key of keys) { assertProbability(probabilities[key], `response.answers.${id}.probabilities.${key}`); sum += probabilities[key] as number; }
      if (Math.abs(sum - 1) > 0.002) throw new Error(`response.answers.${id}.probabilities must sum to 1 (got ${sum})`);
    }
  }
}

export function answerConfidence(answer: Answer): number {
  if (answer.type === "noul") return Math.max(answer.noul, 1 - answer.noul);
  return Math.max(...Object.values(answer.probabilities));
}
