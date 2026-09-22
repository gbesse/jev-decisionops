#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadConfig, loadDataset } from "./io.js";
import { compareReports, runEvaluation } from "./runner.js";
import type { EvalReport } from "./types.js";

function valueOf(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage(): never {
  console.error("Usage:\n  jev-eval validate --config <file>\n  jev-eval run --config <file>\n  jev-eval compare --baseline <report.json> --candidate <report.json>");
  process.exit(2);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "validate" || command === "run") {
    const path = valueOf(args, "--config") ?? usage();
    const { config, configPath } = await loadConfig(path);
    if (command === "validate") {
      const cases = await loadDataset(resolve(dirname(configPath), config.dataset));
      console.log(`valid: ${cases.length} case(s), model ${config.model}`);
      return;
    }
    const report = await runEvaluation(config, configPath);
    console.log(JSON.stringify({ passed: report.gates.passed, metrics: report.metrics, optimizedThreshold: report.optimizedThreshold }, null, 2));
    if (!report.gates.passed) process.exitCode = 1;
    return;
  }
  if (command === "compare") {
    const baselinePath = valueOf(args, "--baseline") ?? usage();
    const candidatePath = valueOf(args, "--candidate") ?? usage();
    const [baseline, candidate] = await Promise.all([baselinePath, candidatePath].map(async (path) => JSON.parse(await readFile(path, "utf8")) as EvalReport));
    console.log(JSON.stringify(compareReports(baseline!, candidate!), null, 2));
    return;
  }
  usage();
}

main().catch((error) => { console.error(`jev-eval: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
