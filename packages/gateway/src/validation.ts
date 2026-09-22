import type { Answer, DecisionRequest, DecisionResponse, GatewayConfig, JsonValue, Question } from "./types.js";

function object(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
}
function json(value: unknown, path: string): asserts value is JsonValue {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (Array.isArray(value)) return value.forEach((child, index) => json(child, `${path}[${index}]`));
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).forEach(([key, child]) => json(child, `${path}.${key}`));
  throw new Error(`${path} must be JSON-serializable`);
}
function probability(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${path} must be between 0 and 1`);
}
function noUnknown(value: Record<string, unknown>, allowed: string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${path} contains unknown fields: ${unknown.join(", ")}`);
}

export function validateConfig(value: unknown): asserts value is GatewayConfig {
  object(value, "config");
  noUnknown(value, ["version", "listen", "upstreams", "request", "rateLimit", "redaction", "cache", "circuitBreaker", "policy", "audit", "access"], "config");
  if (value.version !== 1) throw new Error("config.version must be 1");
  if (!Array.isArray(value.upstreams) || value.upstreams.length === 0) throw new Error("config.upstreams must not be empty");
  const ids = new Set<string>();
  value.upstreams.forEach((entry, index) => {
    object(entry, `config.upstreams[${index}]`);
    noUnknown(entry, ["id", "endpoint", "apiKeyEnv", "headers", "model", "allowedModels"], `config.upstreams[${index}]`);
    if (typeof entry.id !== "string" || !entry.id || ids.has(entry.id)) throw new Error(`config.upstreams[${index}].id must be unique`);
    ids.add(entry.id);
    if (typeof entry.endpoint !== "string" || !/^https?:\/\//.test(entry.endpoint)) throw new Error(`config.upstreams[${index}].endpoint must be HTTP(S)`);
    if (entry.headers !== undefined) { object(entry.headers, `config.upstreams[${index}].headers`); if (Object.values(entry.headers).some((item) => typeof item !== "string")) throw new Error(`config.upstreams[${index}].headers values must be strings`); }
    if (entry.allowedModels !== undefined && (!Array.isArray(entry.allowedModels) || entry.allowedModels.some((item) => typeof item !== "string"))) throw new Error(`config.upstreams[${index}].allowedModels must be strings`);
  });
  const sections: Array<[string, unknown, string[]]> = [
    ["listen", value.listen, ["host", "port"]],
    ["request", value.request, ["maxBodyBytes", "maxQuestions", "timeoutMs", "maxRetries", "maxConcurrent"]],
    ["rateLimit", value.rateLimit, ["requestsPerMinute"]],
    ["redaction", value.redaction, ["enabled", "paths", "redactCommonSecretKeys", "replacement"]],
    ["cache", value.cache, ["enabled", "ttlMs", "maxEntries"]],
    ["circuitBreaker", value.circuitBreaker, ["failureThreshold", "cooldownMs"]],
    ["policy", value.policy, ["minConfidence", "onLowConfidence"]],
    ["audit", value.audit, ["path", "hashState", "includeQuestionIds"]],
    ["access", value.access, ["bearerTokenEnv", "trustedProxy"]],
  ];
  for (const [name, section, fields] of sections) if (section !== undefined) { object(section, `config.${name}`); noUnknown(section, fields, `config.${name}`); }
  if (value.listen !== undefined) {
    const listen = value.listen as Record<string, unknown>;
    if (listen.host !== undefined && typeof listen.host !== "string") throw new Error("config.listen.host must be a string");
    if (listen.port !== undefined && (!Number.isInteger(listen.port) || (listen.port as number) < 0 || (listen.port as number) > 65535)) throw new Error("config.listen.port must be an integer from 0 to 65535");
  }
  const threshold = (value.policy as Record<string, unknown> | undefined)?.minConfidence;
  if (threshold !== undefined) probability(threshold, "config.policy.minConfidence");
  const lowConfidence = (value.policy as Record<string, unknown> | undefined)?.onLowConfidence;
  if (lowConfidence !== undefined && !["return", "error", "fallback"].includes(String(lowConfidence))) throw new Error("config.policy.onLowConfidence is invalid");
  const redaction = value.redaction as Record<string, unknown> | undefined;
  if (redaction?.paths !== undefined && (!Array.isArray(redaction.paths) || redaction.paths.some((item) => typeof item !== "string"))) throw new Error("config.redaction.paths must be strings");
  if (redaction?.replacement !== undefined && typeof redaction.replacement !== "string") throw new Error("config.redaction.replacement must be a string");
  for (const [path, raw] of [
    ["cache.enabled", (value.cache as Record<string, unknown> | undefined)?.enabled],
    ["redaction.enabled", redaction?.enabled],
    ["redaction.redactCommonSecretKeys", redaction?.redactCommonSecretKeys],
    ["audit.hashState", (value.audit as Record<string, unknown> | undefined)?.hashState],
    ["audit.includeQuestionIds", (value.audit as Record<string, unknown> | undefined)?.includeQuestionIds],
    ["access.trustedProxy", (value.access as Record<string, unknown> | undefined)?.trustedProxy],
  ] as const) if (raw !== undefined && typeof raw !== "boolean") throw new Error(`${path} must be boolean`);
  for (const [path, raw] of [
    ["request.maxBodyBytes", (value.request as Record<string, unknown> | undefined)?.maxBodyBytes],
    ["request.maxQuestions", (value.request as Record<string, unknown> | undefined)?.maxQuestions],
    ["request.timeoutMs", (value.request as Record<string, unknown> | undefined)?.timeoutMs],
    ["request.maxConcurrent", (value.request as Record<string, unknown> | undefined)?.maxConcurrent],
    ["rateLimit.requestsPerMinute", (value.rateLimit as Record<string, unknown> | undefined)?.requestsPerMinute],
    ["cache.ttlMs", (value.cache as Record<string, unknown> | undefined)?.ttlMs],
    ["cache.maxEntries", (value.cache as Record<string, unknown> | undefined)?.maxEntries],
    ["circuitBreaker.failureThreshold", (value.circuitBreaker as Record<string, unknown> | undefined)?.failureThreshold],
    ["circuitBreaker.cooldownMs", (value.circuitBreaker as Record<string, unknown> | undefined)?.cooldownMs],
  ] as const) if (raw !== undefined && (!Number.isInteger(raw) || (raw as number) <= 0)) throw new Error(`${path} must be a positive integer`);
  const retries = (value.request as Record<string, unknown> | undefined)?.maxRetries;
  if (retries !== undefined && (!Number.isInteger(retries) || (retries as number) < 0)) throw new Error("request.maxRetries must be a non-negative integer");
}

export function validateRequest(value: unknown, maxQuestions = 256): asserts value is DecisionRequest {
  object(value, "request");
  noUnknown(value, ["state", "model", "questions"], "request");
  json(value.state, "request.state");
  if (typeof value.model !== "string" || !value.model) throw new Error("request.model is required");
  object(value.questions, "request.questions");
  const entries = Object.entries(value.questions);
  if (!entries.length || entries.length > maxQuestions) throw new Error(`request.questions must contain 1..${maxQuestions} entries`);
  for (const [id, raw] of entries) {
    object(raw, `request.questions.${id}`);
    noUnknown(raw, ["type", "instructions", "criteria"], `request.questions.${id}`);
    if (!["noul", "choice", "score"].includes(String(raw.type))) throw new Error(`request.questions.${id}.type is invalid`);
    json(raw.instructions, `request.questions.${id}.instructions`);
    if (raw.type === "choice") {
      object(raw.criteria, `request.questions.${id}.criteria`);
      const options = Object.keys(raw.criteria);
      if (options.length < 2 || options.length > 255) throw new Error(`request.questions.${id}.criteria must contain 2..255 options`);
      Object.entries(raw.criteria).forEach(([key, child]) => json(child, `request.questions.${id}.criteria.${key}`));
    }
    if (raw.type === "score") {
      if (!Array.isArray(raw.criteria) || raw.criteria.length < 2) throw new Error(`request.questions.${id}.criteria must have at least two levels`);
      raw.criteria.forEach((child, index) => json(child, `request.questions.${id}.criteria[${index}]`));
    }
  }
}

export function validateResponse(value: unknown, questions: Record<string, Question>): asserts value is DecisionResponse {
  object(value, "response");
  if (typeof value.model !== "string" || !value.model) throw new Error("response.model is required");
  object(value.answers, "response.answers");
  const wanted = Object.keys(questions).sort();
  const got = Object.keys(value.answers).sort();
  if (JSON.stringify(wanted) !== JSON.stringify(got)) throw new Error("response answer keys do not match request");
  for (const [id, question] of Object.entries(questions)) {
    const answer = value.answers[id];
    object(answer, `response.answers.${id}`);
    if (answer.type !== question.type) throw new Error(`response.answers.${id}.type mismatch`);
    if (answer.type === "noul") probability(answer.noul, `response.answers.${id}.noul`);
    else {
      if (answer.type === "choice" && (question.type !== "choice" || typeof answer.choice !== "string" || !(answer.choice in question.criteria))) throw new Error(`response.answers.${id}.choice is invalid`);
      if (answer.type === "score" && (typeof answer.score !== "number" || !Number.isFinite(answer.score))) throw new Error(`response.answers.${id}.score is invalid`);
      object(answer.probabilities, `response.answers.${id}.probabilities`);
      const keys = answer.type === "choice"
        ? Object.keys((question as import("./types.js").ChoiceQuestion).criteria)
        : (question as import("./types.js").ScoreQuestion).criteria.map((_, index) => String(index));
      const probs = answer.probabilities as Record<string, unknown>;
      if (keys.some((key) => !(key in probs)) || Object.keys(probs).some((key) => !keys.includes(key))) throw new Error(`response.answers.${id}.probability keys are invalid`);
      let sum = 0;
      for (const key of keys) { probability(probs[key], `response.answers.${id}.probabilities.${key}`); sum += probs[key] as number; }
      if (Math.abs(sum - 1) > 0.002) throw new Error(`response.answers.${id}.probabilities must sum to 1`);
    }
  }
}

export function confidence(answer: Answer): number {
  return answer.type === "noul" ? Math.max(answer.noul, 1 - answer.noul) : Math.max(...Object.values(answer.probabilities));
}

export function minimumConfidence(response: DecisionResponse): number {
  return Math.min(...Object.values(response.answers).map(confidence));
}
