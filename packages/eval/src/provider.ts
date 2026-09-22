import type { DecisionProvider, DecisionRequest, DecisionResponse, EvalCase, EvalConfig } from "./types.js";
import { validateResponse } from "./validation.js";

export class HttpProvider implements DecisionProvider {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string | undefined,
    private readonly headers: Record<string, string>,
    private readonly timeoutMs: number,
    private readonly maxRetries: number,
  ) {}

  async evaluate(request: DecisionRequest, outerSignal?: AbortSignal): Promise<DecisionResponse> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error(`request timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
      const abort = () => controller.abort(outerSignal?.reason);
      outerSignal?.addEventListener("abort", abort, { once: true });
      try {
        const response = await fetch(this.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
            ...this.headers,
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
          const safe = text.slice(0, 500).replace(/[A-Za-z0-9_-]{24,}/g, "[REDACTED]");
          const error = new Error(`provider returned ${response.status}: ${safe}`);
          if (![429, 529, 502, 503, 504].includes(response.status) || attempt === this.maxRetries) throw error;
          lastError = error;
          const retryAfter = Number(response.headers.get("retry-after"));
          await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(2000, 100 * 2 ** attempt)));
          continue;
        }
        const parsed = JSON.parse(text) as unknown;
        validateResponse(parsed, request.questions);
        return parsed;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === this.maxRetries || controller.signal.aborted) throw lastError;
        await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 100 * 2 ** attempt)));
      } finally {
        clearTimeout(timeout);
        outerSignal?.removeEventListener("abort", abort);
      }
    }
    throw lastError ?? new Error("provider failed");
  }
}

export class RecordedProvider implements DecisionProvider {
  async evaluate(): Promise<DecisionResponse> {
    throw new Error("RecordedProvider requires evaluateCase");
  }
  async evaluateCase(evalCase: EvalCase, request: DecisionRequest): Promise<DecisionResponse> {
    const response = evalCase.recordedResponse;
    if (!response) throw new Error(`case ${evalCase.id} has no recordedResponse`);
    validateResponse(response, request.questions);
    return structuredClone(response);
  }
}

export function createProvider(config: EvalConfig): DecisionProvider {
  if (config.provider.type === "recorded") return new RecordedProvider();
  const endpoint = config.provider.endpoint ?? "https://api.typesafe.ai/v1/systemone";
  const keyEnv = config.provider.apiKeyEnv ?? "TYPESAFE_API_KEY";
  const apiKey = process.env[keyEnv];
  if (config.provider.type === "typesafe" && !apiKey) throw new Error(`${keyEnv} is not set`);
  return new HttpProvider(endpoint, apiKey, config.provider.headers ?? {}, config.run?.timeoutMs ?? 15_000, config.run?.maxRetries ?? 2);
}
