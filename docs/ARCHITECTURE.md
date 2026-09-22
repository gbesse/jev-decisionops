# Architecture and threat model

## Data flow

```text
application ──HTTP──> gateway ──HTTPS──> ordered decision providers
                         │
                         ├─ bounded validation and redaction
                         ├─ cache, retry, circuit and confidence policy
                         ├─ metrics without state
                         └─ append-only audit with hashes

labeled dataset ──> evaluator ──same wire request──> provider/gateway
                         │
                         ├─ checkpointed per-case observations
                         └─ JSON + standalone HTML report
```

The gateway preserves the provider response body. Operational metadata uses response headers so official or community SDKs can continue decoding the normal System One response.

## Trust boundaries

- The caller is untrusted. Body size, JSON shape, question count, rate, and concurrency are bounded before an upstream call.
- State content is untrusted. Optional redaction removes configured paths and common secret-bearing keys, but it does not neutralize semantic prompt injection.
- The upstream is untrusted for correctness and availability. Responses are structurally validated, retries are bounded, and malformed success bodies fail closed.
- Model confidence is untrusted as an authorization signal. The gateway recomputes a conservative minimum from returned distributions. Applications still own permissions and irreversible actions.
- Configuration and environment variables are operator-controlled trusted input. They must not be writable by gateway callers.
- Audit storage is sensitive metadata. It deliberately excludes raw state but includes client addresses and stable hashes; protect and rotate it accordingly.

## Failure behavior

| Condition | Behavior |
|---|---|
| Invalid client request | 4xx, no upstream call |
| Authentication failure | 401 |
| Rate exceeded | 429 with `Retry-After` |
| Transient upstream failure | bounded retry, then ordered fallback |
| Permanent upstream failure | fail closed |
| Malformed provider success | fail closed; circuit records failure |
| Low confidence | return, reject, or fallback according to policy |
| All circuits open | 503 readiness and request failure |
| Audit write failure | request fails rather than silently losing the required audit record |

## Evaluator reproducibility

Every result stores a hash of the full case and of the provider request. Resume skips a case only when the full case hash matches, so changed labels, tags, questions, or recorded answers are rerun. Historical lines remain append-only, while reports select only the newest result matching the current dataset.

Provider requests are assembled from `state`, `model`, and `questions`; `expected`, tags, and grouping metadata never cross the provider boundary. Reports include the configuration hash and resolved model reported by each case result.

## Deliberate exclusions

- No model is treated as an access-control engine.
- No raw-state logging or distributed trace export is provided by default.
- The in-memory cache and rate limiter are per process. Horizontally scaled deployments need an ingress/global limiter and may add a shared cache later.
- TLS, user identity, WAF policy, and audit retention belong to deployment infrastructure.
