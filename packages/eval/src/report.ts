import { basename } from "node:path";
import type { EvalReport, Metrics } from "./types.js";

function escape(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}

function percent(value: number): string { return `${(value * 100).toFixed(2)}%`; }

function row(name: string, metrics: Metrics): string {
  return `<tr><td>${escape(name)}</td><td>${metrics.total}</td><td>${percent(metrics.accuracy)}</td><td>${percent(metrics.coverage)}</td><td>${percent(metrics.acceptedAccuracy)}</td><td>${metrics.brier.toFixed(4)}</td><td>${metrics.ece.toFixed(4)}</td><td>${metrics.p95LatencyMs.toFixed(1)} ms</td></tr>`;
}

export function renderHtml(report: EvalReport): string {
  const groups = Object.entries(report.byType).map(([name, metrics]) => row(`type:${name}`, metrics)).join("") + Object.entries(report.byTag).map(([name, metrics]) => row(`tag:${name}`, metrics)).join("");
  const status = report.gates.passed ? "PASS" : "FAIL";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Jev Eval — ${escape(report.model)}</title><style>
body{font:15px/1.5 ui-sans-serif,system-ui;margin:0;background:#0c1117;color:#dce7f3}.wrap{max-width:1100px;margin:auto;padding:40px 24px}h1{margin-bottom:4px}.muted{color:#8da0b5}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:28px 0}.card{background:#141c25;border:1px solid #273545;border-radius:10px;padding:16px}.value{font-size:24px;font-weight:700}.pass{color:#54d68c}.fail{color:#ff7a86}table{width:100%;border-collapse:collapse;background:#141c25}th,td{text-align:left;padding:10px;border-bottom:1px solid #273545}code{color:#9bd0ff}</style></head><body><main class="wrap"><h1>Jev Eval</h1><div class="muted">${escape(report.dataset)} · ${escape(report.model)} · ${escape(report.createdAt)}</div><div class="cards">
<div class="card"><div class="muted">Gate</div><div class="value ${report.gates.passed ? "pass" : "fail"}">${status}</div></div>
<div class="card"><div class="muted">Accuracy</div><div class="value">${percent(report.metrics.accuracy)}</div></div>
<div class="card"><div class="muted">Coverage</div><div class="value">${percent(report.metrics.coverage)}</div></div>
<div class="card"><div class="muted">Accepted accuracy</div><div class="value">${percent(report.metrics.acceptedAccuracy)}</div></div>
<div class="card"><div class="muted">Brier</div><div class="value">${report.metrics.brier.toFixed(4)}</div></div>
<div class="card"><div class="muted">ECE</div><div class="value">${report.metrics.ece.toFixed(4)}</div></div></div>
${report.gates.failures.length ? `<h2>Gate failures</h2><ul>${report.gates.failures.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>` : ""}
<h2>Segments</h2><table><thead><tr><th>Segment</th><th>N</th><th>Accuracy</th><th>Coverage</th><th>Accepted accuracy</th><th>Brier</th><th>ECE</th><th>P95</th></tr></thead><tbody>${row("all", report.metrics)}${groups}</tbody></table>
<p class="muted">Optimized threshold: <code>${report.optimizedThreshold.threshold.toFixed(4)}</code>; results: <code>${escape(basename(report.resultsFile))}</code>; config: <code>${escape(report.configHash.slice(0, 12))}</code>.</p></main></body></html>`;
}
