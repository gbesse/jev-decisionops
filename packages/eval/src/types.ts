export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface NoulQuestion { type: "noul"; instructions: JsonValue; criteria?: { true?: JsonValue; false?: JsonValue } }
export interface ChoiceQuestion { type: "choice"; instructions: JsonValue; criteria: Record<string, JsonValue> }
export interface ScoreQuestion { type: "score"; instructions: JsonValue; criteria: JsonValue[] }
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer { type: "noul"; noul: number }
export interface ChoiceAnswer { type: "choice"; choice: string; probabilities: Record<string, number>; confidence?: number }
export interface ScoreAnswer { type: "score"; score: number; probabilities: Record<string, number>; legend?: Record<string, string>; confidence?: number }
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface DecisionRequest { state: JsonValue; model: string; questions: Record<string, Question> }
export interface DecisionResponse {
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export type ExpectedAnswer =
  | { type: "noul"; value: boolean }
  | { type: "choice"; value: string }
  | { type: "score"; value: number; tolerance?: number };

export interface EvalCase {
  id: string;
  state: JsonValue;
  questions: Record<string, Question>;
  expected: Record<string, ExpectedAnswer>;
  tags?: string[];
  group?: string;
  recordedResponse?: DecisionResponse;
}

export interface EvalConfig {
  version: 1;
  dataset: string;
  outputDir?: string;
  model: string;
  provider: {
    type: "typesafe" | "http" | "recorded";
    endpoint?: string;
    apiKeyEnv?: string;
    headers?: Record<string, string>;
  };
  run?: { concurrency?: number; timeoutMs?: number; maxRetries?: number; resume?: boolean };
  policy?: {
    confidenceThreshold?: number;
    calibrationBins?: number;
    costs?: { falseDecision?: number; review?: number };
  };
  gates?: { minAccuracy?: number; minCoverage?: number; minAcceptedAccuracy?: number; maxBrier?: number; maxEce?: number };
}

export interface DecisionObservation {
  caseId: string;
  questionId: string;
  type: Answer["type"];
  expected: boolean | string | number;
  predicted: boolean | string | number;
  correct: boolean;
  confidence: number;
  accepted: boolean;
  brier: number;
  tags: string[];
  group?: string;
}

export interface CaseResult {
  schemaVersion: 1;
  caseId: string;
  caseHash: string;
  requestHash: string;
  model: string;
  questionCount: number;
  latencyMs: number;
  observations: DecisionObservation[];
  usage?: DecisionResponse["usage"];
  error?: string;
}

export interface Metrics {
  total: number;
  successful: number;
  errors: number;
  accuracy: number;
  coverage: number;
  acceptedAccuracy: number;
  brier: number;
  ece: number;
  meanLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

export interface EvalReport {
  schemaVersion: 1;
  createdAt: string;
  model: string;
  dataset: string;
  configHash: string;
  threshold: number;
  optimizedThreshold: { threshold: number; cost: number; coverage: number; acceptedAccuracy: number };
  metrics: Metrics;
  byType: Record<string, Metrics>;
  byTag: Record<string, Metrics>;
  gates: { passed: boolean; failures: string[] };
  resultsFile: string;
}

export interface DecisionProvider {
  evaluate(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResponse>;
}
