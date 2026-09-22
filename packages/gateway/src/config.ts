import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { GatewayConfig } from "./types.js";
import { validateConfig } from "./validation.js";

export async function loadConfig(path: string): Promise<{ config: GatewayConfig; configPath: string }> {
  const configPath = resolve(path);
  const text = await readFile(configPath, "utf8");
  const parsed = extname(configPath).toLowerCase() === ".json" ? JSON.parse(text) : parseYaml(text);
  validateConfig(parsed);
  const config = parsed as GatewayConfig;
  if (config.audit?.path) config.audit.path = resolve(dirname(configPath), config.audit.path);
  return { config, configPath };
}

export function assertEnvironment(config: GatewayConfig): void {
  for (const upstream of config.upstreams) {
    if (upstream.apiKeyEnv && !process.env[upstream.apiKeyEnv]) throw new Error(`${upstream.apiKeyEnv} is required by upstream ${upstream.id}`);
  }
  if (config.access?.bearerTokenEnv && !process.env[config.access.bearerTokenEnv]) throw new Error(`${config.access.bearerTokenEnv} is required by access policy`);
}
