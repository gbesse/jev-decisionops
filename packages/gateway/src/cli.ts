#!/usr/bin/env node
import { assertEnvironment, loadConfig } from "./config.js";
import { listen } from "./server.js";

function option(args: string[], name: string): string | undefined { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
function usage(): never { console.error("Usage:\n  jev-gateway check --config <file>\n  jev-gateway serve --config <file>"); process.exit(2); }

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || !["check", "serve"].includes(command)) usage();
  const path = option(args, "--config") ?? usage();
  const { config } = await loadConfig(path);
  assertEnvironment(config);
  if (command === "check") { console.log(`valid: ${config.upstreams.length} upstream(s), listen ${config.listen?.host ?? "127.0.0.1"}:${config.listen?.port ?? 4318}`); return; }
  const running = await listen(config);
  console.error(`jev-gateway listening on http://${config.listen?.host ?? "127.0.0.1"}:${config.listen?.port ?? 4318}`);
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await running.close(); };
  process.once("SIGINT", () => void close()); process.once("SIGTERM", () => void close());
}

main().catch((error) => { console.error(`jev-gateway: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
