import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { DecisionRequest, GatewayConfig } from "./types.js";
import { DecisionGateway, GatewayPolicyError } from "./gateway.js";
import { RateLimiter } from "./limits.js";
import { UpstreamError } from "./upstream.js";
import { validateRequest } from "./validation.js";

function send(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "x-content-type-options": "nosniff", "cache-control": "no-store", ...headers });
  response.end(body);
}

async function readBody(request: IncomingMessage, maximum: number): Promise<string> {
  const length = Number(request.headers["content-length"]);
  if (Number.isFinite(length) && length > maximum) throw new GatewayPolicyError(`request body exceeds ${maximum} bytes`, 413);
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > maximum) throw new GatewayPolicyError(`request body exceeds ${maximum} bytes`, 413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function requestId(request: IncomingMessage): string {
  const value = request.headers["x-request-id"];
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : randomUUID();
}

function clientAddress(request: IncomingMessage, config: GatewayConfig): string {
  if (config.access?.trustedProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string") return forwarded.split(",")[0]!.trim();
  }
  return request.socket.remoteAddress ?? "unknown";
}

export interface RunningGateway { server: Server; gateway: DecisionGateway; close(): Promise<void> }

export function createGatewayServer(config: GatewayConfig): RunningGateway {
  const gateway = new DecisionGateway(config);
  const rateLimiter = new RateLimiter(config.rateLimit?.requestsPerMinute ?? 1200);
  const sockets = new Set<Socket>();
  const server = createServer(async (request, response) => {
    const id = requestId(request);
    response.setHeader("x-request-id", id);
    try {
      if (request.method === "GET" && request.url === "/healthz") return send(response, 200, { status: "ok" });
      if (!gateway.authenticate(request.headers.authorization)) return send(response, 401, { error: { message: "unauthorized", requestId: id } }, { "www-authenticate": "Bearer" });
      if (request.method === "GET" && request.url === "/readyz") {
        const available = gateway.upstreams.some((item) => item.circuit.canAttempt());
        return send(response, available ? 200 : 503, { status: available ? "ready" : "unavailable", circuits: Object.fromEntries(gateway.upstreams.map((item) => [item.config.id, item.circuit.state])) });
      }
      if (request.method === "GET" && request.url === "/metrics") {
        const body = gateway.metrics.render(); response.writeHead(200, { "content-type": "text/plain; version=0.0.4", "content-length": Buffer.byteLength(body), "cache-control": "no-store" }); response.end(body); return;
      }
      if (request.method !== "POST" || request.url !== "/v1/systemone") return send(response, 404, { error: { message: "not found", requestId: id } });
      if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return send(response, 415, { error: { message: "content-type must be application/json", requestId: id } });
      const client = clientAddress(request, config);
      const limit = rateLimiter.consume(client);
      response.setHeader("x-ratelimit-remaining", String(limit.remaining));
      response.setHeader("x-ratelimit-reset", String(Math.ceil(limit.resetAt / 1000)));
      if (!limit.allowed) return send(response, 429, { error: { message: "rate limit exceeded", requestId: id } }, { "retry-after": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))) });
      const text = await readBody(request, config.request?.maxBodyBytes ?? 1_048_576);
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new GatewayPolicyError("invalid JSON body", 400); }
      validateRequest(parsed, config.request?.maxQuestions ?? 256);
      const result = await gateway.evaluate(parsed as DecisionRequest, client, id);
      send(response, 200, result.response, { "x-jev-gateway-upstream": result.upstream, "x-jev-gateway-cache": result.cache, "x-jev-gateway-fallbacks": String(result.fallbackCount), "x-jev-gateway-redactions": String(result.redactionCount), "x-jev-gateway-min-confidence": result.minConfidence.toFixed(6) });
    } catch (error) {
      const status = error instanceof GatewayPolicyError ? error.statusCode : error instanceof UpstreamError ? error.statusCode : error instanceof Error && /request\.|must |invalid|unknown fields|JSON-serializable/.test(error.message) ? 422 : 500;
      const message = status >= 500 ? "upstream unavailable" : error instanceof Error ? error.message : String(error);
      send(response, status, { error: { message, requestId: id } });
    }
  });
  server.requestTimeout = (config.request?.timeoutMs ?? 15_000) + 5_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  return { server, gateway, close: async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); for (const socket of sockets) socket.destroy(); await gateway.audit.flush(); } };
}

export async function listen(config: GatewayConfig): Promise<RunningGateway> {
  const running = createGatewayServer(config);
  await new Promise<void>((resolve, reject) => { running.server.once("error", reject); running.server.listen(config.listen?.port ?? 4318, config.listen?.host ?? "127.0.0.1", resolve); });
  return running;
}
