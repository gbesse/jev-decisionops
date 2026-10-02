# Jev DecisionOps

Production tooling for typed probabilistic decision models. This repository ships two independent packages:

- **`@gbesse/jev-eval`** — reproducible datasets, checkpointed runs, calibration metrics, threshold optimization, regression gates, and HTML/JSON reports.
- **`@gbesse/jev-gateway`** — a System One-compatible gateway with response validation, secret redaction, retries, rate limiting, caching, circuit breaking, confidence fallbacks, and append-only audit logs.

The packages work with TypeSafe Jev and compatible endpoints. They are community software and are not affiliated with or endorsed by TypeSafe AI.

## Why

Schema-valid output is not the same as a correct decision. Production systems need to measure calibration on their own data, pin model versions, handle overloads, avoid leaking secrets, and explicitly choose what happens when confidence is low. DecisionOps makes those controls code and data rather than conventions hidden in application glue.

## Quick start

```bash
npm install
npm run release:check

# Run an offline example using recorded answers.
npx jev-eval run --config examples/eval.yaml

# Validate and start the gateway.
TYPESAFE_API_KEY=... npx jev-gateway check --config examples/gateway.yaml
TYPESAFE_API_KEY=... npx jev-gateway serve --config examples/gateway.yaml
```

See [`packages/eval/README.md`](packages/eval/README.md) and [`packages/gateway/README.md`](packages/gateway/README.md) for schemas and production guidance.

## See a regression gate fail offline

`npm run demo:gate` evaluates the same recorded synthetic support answers twice. The baseline policy passes; a deliberately stricter Brier threshold fails and reports its reason. The example writes temporary reports only and makes no model or gateway call. The stricter number is illustrative, not a recommended production threshold.

## Design rules

1. Labels are never sent to a provider.
2. Failed or malformed upstream responses never become successful decisions.
3. Confidence thresholds are policy, not truth; calibrate them per workload.
4. Audit logs exclude state by default and redact common secret fields.
5. Numeric and temporal logic stays in deterministic code.
6. Provider aliases are allowed for exploration; production examples pin versions.

## Repository status

Public alpha. The wire contracts and report schema are versioned, but APIs may evolve before 1.0. See [SECURITY.md](SECURITY.md) before exposing the gateway to untrusted networks.

## License

MIT.
