// Demonstrate a passing and a failing evaluation gate on recorded synthetic answers.
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfig} from '../packages/eval/dist/io.js';
import {runEvaluation} from '../packages/eval/dist/runner.js';

const {config, configPath} = await loadConfig(new URL('./eval.yaml', import.meta.url).pathname);
const temporary = await mkdtemp(join(tmpdir(), 'jev-eval-gate-'));
try {
  const baseline = await runEvaluation({...config, outputDir: join(temporary, 'baseline'), run: {...config.run, resume: false}}, configPath);
  const strict = await runEvaluation({...config, outputDir: join(temporary, 'strict'), run: {...config.run, resume: false}, gates: {...config.gates, maxBrier: 0.001}}, configPath);
  if (!baseline.gates.passed || strict.gates.passed) throw new Error('Expected baseline pass and strict gate failure');
  console.log(JSON.stringify({source: 'recorded synthetic answers; no provider call', baselinePassed: baseline.gates.passed, strictPassed: strict.gates.passed, strictFailures: strict.gates.failures}, null, 2));
} finally {
  await rm(temporary, {recursive: true, force: true});
}
