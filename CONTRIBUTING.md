# Contributing

Node.js 22 or newer is required.

```bash
npm install
npm run release:check
```

Changes to metrics or validation behavior need tests with a counterexample. Changes to public report fields must preserve `schemaVersion` or increment it. Never add fixtures containing live API keys, personal data, or proprietary model inputs.
