import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runEvaluation } from "../src/index.js";
import type { EvalConfig } from "../src/types.js";

test("runs recorded datasets, writes reports, and resumes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-eval-"));
  const dataset = [{ id: "a", state: "hello", questions: { yes: { type: "noul", instructions: "friendly?" } }, expected: { yes: { type: "noul", value: true } }, recordedResponse: { model: "recorded", answers: { yes: { type: "noul", noul: 0.9 } } } }];
  await writeFile(join(directory, "data.json"), JSON.stringify(dataset));
  const config: EvalConfig = { version: 1, dataset: "data.json", outputDir: "out", model: "recorded", provider: { type: "recorded" }, run: { concurrency: 8 }, policy: { confidenceThreshold: 0.8 }, gates: { minAccuracy: 1 } };
  const report = await runEvaluation(config, join(directory, "eval.yaml"));
  assert.equal(report.gates.passed, true);
  assert.equal(report.metrics.accuracy, 1);
  assert.match(await readFile(join(directory, "out", "report.html"), "utf8"), /Jev Eval/);
  await runEvaluation(config, join(directory, "eval.yaml"));
  const lines = (await readFile(join(directory, "out", "results.jsonl"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);

  dataset[0]!.recordedResponse.answers.yes.noul = 0.1;
  dataset[0]!.expected.yes.value = false;
  await writeFile(join(directory, "data.json"), JSON.stringify(dataset));
  const changed = await runEvaluation(config, join(directory, "eval.yaml"));
  const changedLines = (await readFile(join(directory, "out", "results.jsonl"), "utf8")).trim().split("\n");
  assert.equal(changedLines.length, 2);
  assert.equal(changed.metrics.total, 1, "stale result must not be counted");
  assert.equal(changed.metrics.accuracy, 1);
});
