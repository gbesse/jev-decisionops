import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createGatewayServer } from "../src/index.js";
import type { GatewayConfig } from "../src/types.js";

async function fakeUpstream(handler: (body: unknown, count: number) => { status?: number; body: unknown }) {
  let count = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const result = handler(JSON.parse(Buffer.concat(chunks).toString("utf8")), ++count);
    response.writeHead(result.status ?? 200, { "content-type": "application/json" }); response.end(JSON.stringify(result.body));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("no address");
  return { endpoint: `http://127.0.0.1:${address.port}`, count: () => count, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const request = { state: "hello", model: "jev-1.13.0", questions: { friendly: { type: "noul", instructions: "friendly?" } } };

test("serves compatible responses, caches, authenticates, and exposes metrics", async () => {
  const upstream = await fakeUpstream(() => ({ body: { model: "jev-1.13.0", answers: { friendly: { type: "noul", noul: 0.95 } } } }));
  process.env.TEST_GATEWAY_TOKEN = "secret-token";
  const config: GatewayConfig = { version: 1, listen: { host: "127.0.0.1", port: 0 }, upstreams: [{ id: "fake", endpoint: upstream.endpoint }], request: { maxRetries: 0 }, cache: { enabled: true }, access: { bearerTokenEnv: "TEST_GATEWAY_TOKEN" } };
  const running = createGatewayServer(config); running.server.listen(0, "127.0.0.1"); await once(running.server, "listening");
  const address = running.server.address(); if (!address || typeof address === "string") throw new Error("no address");
  const url = `http://127.0.0.1:${address.port}`;
  const denied = await fetch(`${url}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
  assert.equal(denied.status, 401);
  const call = () => fetch(`${url}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer secret-token" }, body: JSON.stringify(request) });
  const first = await call(); assert.equal(first.status, 200); assert.equal(first.headers.get("x-jev-gateway-cache"), "miss");
  const second = await call(); assert.equal(second.status, 200); assert.equal(second.headers.get("x-jev-gateway-cache"), "hit");
  assert.equal(upstream.count(), 1);
  const metrics = await fetch(`${url}/metrics`, { headers: { authorization: "Bearer secret-token" } });
  assert.match(await metrics.text(), /jev_gateway_cache_hits_total 1/);
  await running.close(); await upstream.close(); delete process.env.TEST_GATEWAY_TOKEN;
});

test("falls back to the next upstream on low confidence", async () => {
  const low = await fakeUpstream(() => ({ body: { model: "low", answers: { friendly: { type: "noul", noul: 0.55 } } } }));
  const high = await fakeUpstream(() => ({ body: { model: "high", answers: { friendly: { type: "noul", noul: 0.95 } } } }));
  const config: GatewayConfig = { version: 1, listen: { host: "127.0.0.1", port: 0 }, upstreams: [{ id: "low", endpoint: low.endpoint }, { id: "high", endpoint: high.endpoint }], request: { maxRetries: 0 }, cache: { enabled: false }, policy: { minConfidence: 0.8, onLowConfidence: "fallback" } };
  const running = createGatewayServer(config); running.server.listen(0, "127.0.0.1"); await once(running.server, "listening");
  const address = running.server.address(); if (!address || typeof address === "string") throw new Error("no address");
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
  assert.equal(response.status, 200); assert.equal(response.headers.get("x-jev-gateway-upstream"), "high"); assert.equal(response.headers.get("x-jev-gateway-fallbacks"), "1");
  assert.equal((await response.json() as { model: string }).model, "high");
  await running.close(); await Promise.all([low.close(), high.close()]);
});

test("redacts sensitive state before forwarding it upstream", async () => {
  let seen: unknown;
  const upstream = await fakeUpstream((body) => { seen = body; return { body: { model: "m", answers: { friendly: { type: "noul", noul: 0.9 } } } }; });
  const config: GatewayConfig = { version: 1, listen: { host: "127.0.0.1", port: 0 }, upstreams: [{ id: "fake", endpoint: upstream.endpoint }], request: { maxRetries: 0 }, cache: { enabled: false }, redaction: { enabled: true, paths: ["state.email"] } };
  const running = createGatewayServer(config); running.server.listen(0, "127.0.0.1"); await once(running.server, "listening");
  const address = running.server.address(); if (!address || typeof address === "string") throw new Error("no address");
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/systemone`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...request, state: { email: "person@example.com", password: "secret", note: "keep" } }) });
  assert.equal(response.status, 200); assert.equal(response.headers.get("x-jev-gateway-redactions"), "2");
  assert.deepEqual((seen as { state: unknown }).state, { email: "[REDACTED]", password: "[REDACTED]", note: "keep" });
  await running.close(); await upstream.close();
});
