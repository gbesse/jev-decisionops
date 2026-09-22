import type { DecisionRequest, DecisionResponse, GatewayConfig, UpstreamConfig } from "./types.js";
import { CircuitBreaker } from "./circuit.js";
import { validateResponse } from "./validation.js";

export class UpstreamError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly statusCode = 502) { super(message); }
}

export class UpstreamClient {
  readonly circuit: CircuitBreaker;
  constructor(readonly config: UpstreamConfig, private readonly gateway: GatewayConfig) {
    this.circuit = new CircuitBreaker(gateway.circuitBreaker?.failureThreshold ?? 5, gateway.circuitBreaker?.cooldownMs ?? 30_000);
  }

  async call(original: DecisionRequest, outerSignal?: AbortSignal): Promise<DecisionResponse> {
    if (!this.circuit.canAttempt()) throw new UpstreamError(`upstream ${this.config.id} circuit is open`, true, 503);
    if (this.config.allowedModels && !this.config.allowedModels.includes(original.model)) throw new UpstreamError(`model ${original.model} is not allowed by upstream ${this.config.id}`, false, 422);
    const request = this.config.model ? { ...original, model: this.config.model } : original;
    const env = this.config.apiKeyEnv ?? "TYPESAFE_API_KEY";
    const apiKey = process.env[env];
    if (this.config.apiKeyEnv && !apiKey) throw new UpstreamError(`${env} is not configured`, false, 503);
    const retries = this.gateway.request?.maxRetries ?? 2;
    let last: Error | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeoutMs = this.gateway.request?.timeoutMs ?? 15_000;
      const timeout = setTimeout(() => controller.abort(new Error(`upstream timeout after ${timeoutMs}ms`)), timeoutMs);
      const abort = () => controller.abort(outerSignal?.reason);
      outerSignal?.addEventListener("abort", abort, { once: true });
      try {
        const response = await fetch(this.config.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...(this.config.headers ?? {}) },
          body: JSON.stringify(request), signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
          const retryable = [429, 502, 503, 504, 529].includes(response.status);
          const error = new UpstreamError(`upstream ${this.config.id} returned HTTP ${response.status}`, retryable, retryable ? 503 : 502);
          if (!retryable || attempt === retries) throw error;
          last = error;
          const retryAfter = Number(response.headers.get("retry-after"));
          await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(2000, 100 * 2 ** attempt)));
          continue;
        }
        const parsed = JSON.parse(text) as unknown;
        validateResponse(parsed, request.questions);
        this.circuit.success();
        return parsed;
      } catch (error) {
        last = error instanceof Error ? error : new Error(String(error));
        const retryable = !(error instanceof UpstreamError) || error.retryable;
        if (!retryable || attempt === retries || controller.signal.aborted) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 100 * 2 ** attempt)));
      } finally {
        clearTimeout(timeout);
        outerSignal?.removeEventListener("abort", abort);
      }
    }
    this.circuit.failure();
    if (last instanceof UpstreamError) throw last;
    throw new UpstreamError(`upstream ${this.config.id} failed: ${last?.message ?? "unknown error"}`, true, 503);
  }
}
