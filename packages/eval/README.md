# `@gbesse/jev-eval`

Reproducible evaluation and calibration for System One-compatible decision models.

## What it measures

- Accuracy and accepted accuracy after confidence gating.
- Coverage: the fraction of decisions accepted automatically.
- Binary or multiclass Brier score from the full probability distribution.
- Expected calibration error (ECE).
- Mean, p50, and p95 end-to-end latency.
- Metrics sliced by question type and user-defined tags.
- A cost-optimal review threshold for configurable false-decision and human-review costs.

The runner writes every completed case to `results.jsonl` before starting another. Interrupted runs resume by case id. Labels remain in the evaluator and are never included in provider requests.

## Install and run

```bash
npm install @gbesse/jev-eval
jev-eval validate --config eval.yaml
jev-eval run --config eval.yaml
```

Use `provider.type: typesafe` for the official endpoint, `http` for a compatible gateway, or `recorded` for deterministic offline fixtures. With TypeSafe, set `TYPESAFE_API_KEY`; the key name is configurable with `apiKeyEnv`.

See the repository [`examples/eval.yaml`](../../examples/eval.yaml) and [`examples/data/eval.json`](../../examples/data/eval.json). A dataset is a JSON array or JSONL file. Each case contains `id`, `state`, `questions`, `expected`, and optional `tags`, `group`, or `recordedResponse`.

## CI gates

`gates` can require minimum accuracy, coverage, and accepted accuracy or maximum Brier and ECE. A failed gate exits with status 1. Provider errors also fail the gate instead of disappearing from the denominator.

```yaml
gates:
  minAccuracy: 0.90
  minAcceptedAccuracy: 0.98
  maxEce: 0.08
```

`report.json` is stable, machine-readable output. `report.html` is a standalone human report. Use `jev-eval compare` to calculate candidate-minus-baseline changes.

## Production methodology

Keep near-duplicates and paraphrases in the same `group` when splitting datasets. Pin the resolved model version. Evaluate option-order rotations and adversarial text as separate cases. Choose review costs before inspecting the held-out test set. A low ECE on a small dataset is not evidence of general calibration.
