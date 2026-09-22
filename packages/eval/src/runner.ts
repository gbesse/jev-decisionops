import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CaseResult, DecisionObservation, EvalCase, EvalConfig, EvalReport, Metrics } from "./types.js";
import { createProvider, RecordedProvider } from "./provider.js";
import { appendJsonLine, atomicWrite, loadDataset, sha256 } from "./io.js";
import { computeMetrics, observe, optimizeThreshold } from "./metrics.js";
import { renderHtml } from "./report.js";

async function existingCases(path: string): Promise<Map<string, string>> {
  try {
    const text = await readFile(path, "utf8");
    return new Map(text.split("\n").filter(Boolean).map((line) => {
      const item = JSON.parse(line) as CaseResult;
      return [item.caseId, item.caseHash];
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
}

async function readResults(path: string): Promise<CaseResult[]> {
  const text = await readFile(path, "utf8");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as CaseResult);
}

function groupMetrics(observations: DecisionObservation[], latencies: number[], predicate: (item: DecisionObservation) => boolean, bins: number): Metrics {
  return computeMetrics(observations.filter(predicate), latencies, 0, bins);
}

function applyGates(metrics: Metrics, gates: EvalConfig["gates"]): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  if (gates?.minAccuracy !== undefined && metrics.accuracy < gates.minAccuracy) failures.push(`accuracy ${metrics.accuracy.toFixed(4)} < ${gates.minAccuracy}`);
  if (gates?.minCoverage !== undefined && metrics.coverage < gates.minCoverage) failures.push(`coverage ${metrics.coverage.toFixed(4)} < ${gates.minCoverage}`);
  if (gates?.minAcceptedAccuracy !== undefined && metrics.acceptedAccuracy < gates.minAcceptedAccuracy) failures.push(`accepted accuracy ${metrics.acceptedAccuracy.toFixed(4)} < ${gates.minAcceptedAccuracy}`);
  if (gates?.maxBrier !== undefined && metrics.brier > gates.maxBrier) failures.push(`Brier ${metrics.brier.toFixed(4)} > ${gates.maxBrier}`);
  if (gates?.maxEce !== undefined && metrics.ece > gates.maxEce) failures.push(`ECE ${metrics.ece.toFixed(4)} > ${gates.maxEce}`);
  if (metrics.errors > 0) failures.push(`${metrics.errors} decision(s) could not be evaluated`);
  return { passed: failures.length === 0, failures };
}

export async function runEvaluation(config: EvalConfig, configPath: string): Promise<EvalReport> {
  const base = dirname(resolve(configPath));
  const datasetPath = resolve(base, config.dataset);
  const outputDir = resolve(base, config.outputDir ?? "output");
  const resultsFile = resolve(outputDir, "results.jsonl");
  const cases = await loadDataset(datasetPath);
  const threshold = config.policy?.confidenceThreshold ?? 0.5;
  const provider = createProvider(config);
  const done = config.run?.resume === false ? new Map<string, string>() : await existingCases(resultsFile);
  const pending = cases.filter((item) => done.get(item.id) !== sha256(item));
  const concurrency = Math.max(1, Math.min(64, config.run?.concurrency ?? 4));
  let cursor = 0;
  let appendQueue = Promise.resolve();
  async function worker(): Promise<void> {
    while (cursor < pending.length) {
      const index = cursor++;
      const evalCase = pending[index];
      if (!evalCase) return;
      const request = { state: evalCase.state, model: config.model, questions: evalCase.questions };
      const started = performance.now();
      let result: CaseResult;
      try {
        const response = provider instanceof RecordedProvider ? await provider.evaluateCase(evalCase, request) : await provider.evaluate(request);
        result = {
          schemaVersion: 1,
          caseId: evalCase.id,
          caseHash: sha256(evalCase),
          requestHash: sha256(request),
          model: response.model,
          questionCount: Object.keys(evalCase.questions).length,
          latencyMs: performance.now() - started,
          observations: observe(evalCase, response.answers, threshold),
          ...(response.usage ? { usage: response.usage } : {}),
        };
      } catch (error) {
        result = {
          schemaVersion: 1,
          caseId: evalCase.id,
          caseHash: sha256(evalCase),
          requestHash: sha256(request),
          model: config.model,
          questionCount: Object.keys(evalCase.questions).length,
          latencyMs: performance.now() - started,
          observations: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
      appendQueue = appendQueue.then(() => appendJsonLine(resultsFile, result));
      await appendQueue;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()));
  if (cases.length === 0) throw new Error("dataset is empty");
  const results = await readResults(resultsFile);
  const wanted = new Map(cases.map((item) => [item.id, sha256(item)]));
  const latest = new Map<string, CaseResult>();
  for (const item of results) if (wanted.get(item.caseId) === item.caseHash) latest.set(item.caseId, item);
  const relevant = cases.map((item) => latest.get(item.id)).filter((item): item is CaseResult => Boolean(item));
  const observations = relevant.flatMap((item) => item.observations);
  for (const item of observations) item.accepted = item.confidence >= threshold;
  const latencies = relevant.filter((item) => !item.error).map((item) => item.latencyMs);
  const errors = relevant.filter((item) => item.error).reduce((sum, item) => sum + item.questionCount, 0);
  const bins = config.policy?.calibrationBins ?? 10;
  const metrics = computeMetrics(observations, latencies, errors, bins);
  const types = [...new Set(observations.map((item) => item.type))];
  const tags = [...new Set(observations.flatMap((item) => item.tags))];
  const report: EvalReport = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    model: config.model,
    dataset: datasetPath,
    configHash: sha256(config),
    threshold,
    optimizedThreshold: optimizeThreshold(observations, config.policy?.costs?.falseDecision ?? 1, config.policy?.costs?.review ?? 0.1),
    metrics,
    byType: Object.fromEntries(types.map((type) => [type, groupMetrics(observations, latencies, (item) => item.type === type, bins)])),
    byTag: Object.fromEntries(tags.map((tag) => [tag, groupMetrics(observations, latencies, (item) => item.tags.includes(tag), bins)])),
    gates: applyGates(metrics, config.gates),
    resultsFile,
  };
  await atomicWrite(resolve(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await atomicWrite(resolve(outputDir, "report.html"), renderHtml(report));
  return report;
}

export function compareReports(baseline: EvalReport, candidate: EvalReport) {
  return {
    accuracy: candidate.metrics.accuracy - baseline.metrics.accuracy,
    coverage: candidate.metrics.coverage - baseline.metrics.coverage,
    acceptedAccuracy: candidate.metrics.acceptedAccuracy - baseline.metrics.acceptedAccuracy,
    brier: candidate.metrics.brier - baseline.metrics.brier,
    ece: candidate.metrics.ece - baseline.metrics.ece,
    p95LatencyMs: candidate.metrics.p95LatencyMs - baseline.metrics.p95LatencyMs,
  };
}
