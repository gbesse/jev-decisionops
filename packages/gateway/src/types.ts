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
export interface DecisionResponse { model: string; answers: Record<string, Answer>; usage?: { input_tokens?: number; output_tokens?: number } }

export interface UpstreamConfig {
  id: string;
  endpoint: string;
  apiKeyEnv?: string;
  headers?: Record<string, string>;
  model?: string;
  allowedModels?: string[];
}

export interface GatewayConfig {
  version: 1;
  listen?: { host?: string; port?: number };
  upstreams: UpstreamConfig[];
  request?: { maxBodyBytes?: number; maxQuestions?: number; timeoutMs?: number; maxRetries?: number; maxConcurrent?: number };
  rateLimit?: { requestsPerMinute?: number };
  redaction?: { enabled?: boolean; paths?: string[]; redactCommonSecretKeys?: boolean; replacement?: string };
  cache?: { enabled?: boolean; ttlMs?: number; maxEntries?: number };
  circuitBreaker?: { failureThreshold?: number; cooldownMs?: number };
  policy?: { minConfidence?: number; onLowConfidence?: "return" | "error" | "fallback" };
  audit?: { path?: string; hashState?: boolean; includeQuestionIds?: boolean };
  access?: { bearerTokenEnv?: string; trustedProxy?: boolean };
}

export interface AuditRecord {
  schemaVersion: 1;
  timestamp: string;
  requestId: string;
  client: string;
  requestHash: string;
  stateHash?: string;
  model: string;
  resolvedModel?: string;
  upstream?: string;
  questionCount: number;
  questionIds?: string[];
  status: "success" | "rejected" | "error";
  statusCode: number;
  latencyMs: number;
  cache: "hit" | "miss" | "bypass";
  fallbackCount: number;
  redactionCount: number;
  minConfidence?: number;
  reason?: string;
  usage?: DecisionResponse["usage"];
}
