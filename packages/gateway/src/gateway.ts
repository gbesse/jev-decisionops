import { randomUUID, timingSafeEqual } from "node:crypto";
import type { AuditRecord, DecisionRequest, DecisionResponse, GatewayConfig } from "./types.js";
import { AuditLogger } from "./audit.js";
import { TtlLruCache } from "./cache.js";
import { sha256 } from "./hash.js";
import { Semaphore } from "./limits.js";
import { GatewayMetrics } from "./metrics.js";
import { UpstreamClient, UpstreamError } from "./upstream.js";
import { minimumConfidence } from "./validation.js";
import { redactRequest } from "./redaction.js";

export interface GatewayResult {
  response: DecisionResponse;
  requestId: string;
  upstream: string;
  cache: "hit" | "miss" | "bypass";
  fallbackCount: number;
  redactionCount: number;
  minConfidence: number;
}

export class GatewayPolicyError extends Error {
  constructor(message: string, readonly statusCode: number) { super(message); }
}

function safeReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").replace(/[A-Za-z0-9_-]{32,}/g, "[REDACTED]").slice(0, 700);
}

export class DecisionGateway {
  readonly metrics = new GatewayMetrics();
  readonly audit: AuditLogger;
  readonly semaphore: Semaphore;
  readonly upstreams: UpstreamClient[];
  private readonly cache: TtlLruCache<DecisionResponse> | undefined;

  constructor(readonly config: GatewayConfig) {
    this.audit = new AuditLogger(config.audit?.path);
    this.semaphore = new Semaphore(config.request?.maxConcurrent ?? 64);
    this.upstreams = config.upstreams.map((item) => new UpstreamClient(item, config));
    if (config.cache?.enabled !== false) this.cache = new TtlLruCache(config.cache?.maxEntries ?? 1000, config.cache?.ttlMs ?? 60_000);
  }

  authenticate(header: string | undefined): boolean {
    const env = this.config.access?.bearerTokenEnv;
    if (!env) return true;
    const expected = process.env[env];
    const actual = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!expected || !actual) return false;
    const left = Buffer.from(expected); const right = Buffer.from(actual);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  async evaluate(request: DecisionRequest, client: string, requestId: string = randomUUID(), signal?: AbortSignal): Promise<GatewayResult> {
    const started = performance.now();
    const redacted = redactRequest(request, this.config.redaction);
    const forwardedRequest = redacted.request;
    const requestHash = sha256(forwardedRequest);
    const stateHash = this.config.audit?.hashState === false ? undefined : sha256(request.state);
    const questionIds = Object.keys(request.questions).sort();
    const cacheState: AuditRecord["cache"] = this.cache ? "miss" : "bypass";
    this.metrics.requests++;
    const cached = this.cache?.get(requestHash);
    if (cached) {
      const confidence = minimumConfidence(cached);
      this.metrics.cacheHits++; this.metrics.successes++;
      const latency = performance.now() - started; this.metrics.latencyMsTotal += latency;
      await this.audit.write({ schemaVersion: 1, timestamp: new Date().toISOString(), requestId, client, requestHash, ...(stateHash ? { stateHash } : {}), model: request.model, resolvedModel: cached.model, questionCount: questionIds.length, ...(this.config.audit?.includeQuestionIds ? { questionIds } : {}), status: "success", statusCode: 200, latencyMs: latency, cache: "hit", fallbackCount: 0, redactionCount: redacted.count, minConfidence: confidence });
      return { response: cached, requestId, upstream: "cache", cache: "hit", fallbackCount: 0, redactionCount: redacted.count, minConfidence: confidence };
    }

    const release = await this.semaphore.acquire();
    let lastError: unknown;
    let lastResponse: { response: DecisionResponse; upstream: string; confidence: number } | undefined;
    let fallbackCount = 0;
    try {
      for (let index = 0; index < this.upstreams.length; index++) {
        const upstream = this.upstreams[index]!;
        if (index > 0) { fallbackCount++; this.metrics.fallbackCalls++; }
        try {
          this.metrics.upstreamCalls++;
          const response = await upstream.call(forwardedRequest, signal);
          const confidence = minimumConfidence(response);
          lastResponse = { response, upstream: upstream.config.id, confidence };
          const threshold = this.config.policy?.minConfidence;
          if (threshold === undefined || confidence >= threshold || this.config.policy?.onLowConfidence === "return") break;
          if (this.config.policy?.onLowConfidence === "error") throw new GatewayPolicyError(`minimum confidence ${confidence.toFixed(4)} is below ${threshold}`, 422);
          if (index === this.upstreams.length - 1) throw new GatewayPolicyError(`all upstreams were below confidence threshold ${threshold}`, 422);
        } catch (error) {
          if (error instanceof GatewayPolicyError) throw error;
          lastError = error;
          if (error instanceof UpstreamError && !error.retryable) throw error;
          if (index === this.upstreams.length - 1) throw error;
        }
      }
      if (!lastResponse) throw lastError ?? new Error("no upstream produced a response");
      this.cache?.set(requestHash, lastResponse.response);
      this.metrics.successes++;
      const latency = performance.now() - started; this.metrics.latencyMsTotal += latency;
      await this.audit.write({ schemaVersion: 1, timestamp: new Date().toISOString(), requestId, client, requestHash, ...(stateHash ? { stateHash } : {}), model: request.model, resolvedModel: lastResponse.response.model, upstream: lastResponse.upstream, questionCount: questionIds.length, ...(this.config.audit?.includeQuestionIds ? { questionIds } : {}), status: "success", statusCode: 200, latencyMs: latency, cache: cacheState, fallbackCount, redactionCount: redacted.count, minConfidence: lastResponse.confidence, ...(lastResponse.response.usage ? { usage: lastResponse.response.usage } : {}) });
      return { response: lastResponse.response, requestId, upstream: lastResponse.upstream, cache: cacheState, fallbackCount, redactionCount: redacted.count, minConfidence: lastResponse.confidence };
    } catch (error) {
      const statusCode = error instanceof GatewayPolicyError ? error.statusCode : error instanceof UpstreamError ? error.statusCode : 502;
      const rejected = statusCode >= 400 && statusCode < 500;
      if (rejected) this.metrics.rejected++; else this.metrics.errors++;
      const latency = performance.now() - started; this.metrics.latencyMsTotal += latency;
      await this.audit.write({ schemaVersion: 1, timestamp: new Date().toISOString(), requestId, client, requestHash, ...(stateHash ? { stateHash } : {}), model: request.model, questionCount: questionIds.length, ...(this.config.audit?.includeQuestionIds ? { questionIds } : {}), status: rejected ? "rejected" : "error", statusCode, latencyMs: latency, cache: cacheState, fallbackCount, redactionCount: redacted.count, reason: safeReason(error) });
      throw error;
    } finally { release(); }
  }
}
