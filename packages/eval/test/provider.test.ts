import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { HttpProvider } from "../src/index.js";

test("HTTP provider retries overloads and sends only state, model, and questions", async () => {
  let calls = 0;
  let seen: unknown;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    seen = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    calls++;
    if (calls === 1) { response.writeHead(429, { "retry-after": "0" }); response.end("busy"); return; }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ model: "jev-test", answers: { q: { type: "noul", noul: 0.9 } } }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("no address");
  const provider = new HttpProvider(`http://127.0.0.1:${address.port}`, "key", {}, 1000, 1);
  const result = await provider.evaluate({ state: "hello", model: "jev-test", questions: { q: { type: "noul", instructions: "friendly?" } } });
  assert.equal(calls, 2);
  assert.equal(result.answers.q?.type, "noul");
  assert.deepEqual(Object.keys(seen as object).sort(), ["model", "questions", "state"]);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("HTTP provider rejects malformed successful responses", async () => {
  const server = createServer((_request, response) => { response.writeHead(200, { "content-type": "application/json" }); response.end('{"model":"m","answers":{}}'); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("no address");
  const provider = new HttpProvider(`http://127.0.0.1:${address.port}`, undefined, {}, 1000, 0);
  await assert.rejects(provider.evaluate({ state: "x", model: "m", questions: { q: { type: "noul", instructions: "?" } } }), /answer keys/);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
