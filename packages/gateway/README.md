# `@gbesse/jev-gateway`

A production-oriented reverse proxy for System One-compatible decision APIs.

## Guarantees

- Strict validation of requests, answer keys, answer types, option names, numeric ranges, and probability mass.
- Bounded bodies, question counts, concurrency, cache size, timeouts, retries, and request rate.
- Optional path-based and common-secret-key redaction before data leaves the gateway.
- Retry only for overload and transient upstream failures.
- Per-upstream circuit breakers and ordered fallbacks.
- Optional minimum-confidence policy calculated from distributions rather than trusting a provider's convenience field.
- Bounded in-memory TTL/LRU cache keyed by the canonical request.
- Append-only audit without raw state; state is represented by SHA-256 by default.
- API keys are loaded from named environment variables and never included in logs or downstream errors.

## Run

```bash
npm install @gbesse/jev-gateway
export TYPESAFE_API_KEY=...
jev-gateway check --config gateway.yaml
jev-gateway serve --config gateway.yaml
```

Point an existing SDK at `http://127.0.0.1:4318/v1/systemone`. Responses retain the provider's wire shape. Gateway metadata is exposed in `x-jev-gateway-*` headers.

Redaction is explicit because it changes the state seen by the model. Enable `redactCommonSecretKeys` for fields such as `password`, `token`, `api_key`, cookies, and authorization, and use `paths` for business-specific fields such as `state.customer.email`. The response header reports how many values were replaced.

See [`examples/gateway.yaml`](../../examples/gateway.yaml) for all controls.

## Fallback behavior

Upstreams are ordered. Transient transport failures fall through to the next upstream. Permanent errors such as a forbidden model fail closed. `policy.onLowConfidence` supports:

- `return`: return the first valid response with its confidence header;
- `error`: reject responses below the threshold;
- `fallback`: try the next upstream, then reject if every response is below threshold.

For security-sensitive workflows, use deterministic authorization outside the model. Confidence fallback improves reliability; it does not turn a probabilistic judgment into a permission system.

## Endpoints

- `POST /v1/systemone` — compatible decision endpoint.
- `GET /healthz` — liveness, intentionally public.
- `GET /readyz` — readiness and circuit state.
- `GET /metrics` — Prometheus text metrics.

Set `access.bearerTokenEnv` whenever the gateway is reachable beyond localhost. The decision endpoint, readiness, and metrics then require that bearer token. TLS termination and identity-aware access belong in the ingress layer.

## Audit

Audit records include request id, canonical request hash, state hash, model, upstream, question count, latency, cache/fallback status, minimum confidence, and token usage. Raw state, question contents, authorization headers, and API keys are never written.
