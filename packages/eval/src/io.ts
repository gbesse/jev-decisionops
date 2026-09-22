import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { EvalCase, EvalConfig, JsonValue } from "./types.js";
import { validateCase, validateConfig } from "./validation.js";

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export async function loadConfig(path: string): Promise<{ config: EvalConfig; configPath: string }> {
  const configPath = resolve(path);
  const text = await readFile(configPath, "utf8");
  const parsed = extname(configPath).toLowerCase() === ".json" ? JSON.parse(text) : parseYaml(text);
  validateConfig(parsed);
  return { config: parsed, configPath };
}

export async function loadDataset(path: string): Promise<EvalCase[]> {
  const text = await readFile(path, "utf8");
  const values: unknown[] = extname(path).toLowerCase() === ".jsonl"
    ? text.split("\n").filter((line) => line.trim()).map((line, index) => { try { return JSON.parse(line); } catch { throw new Error(`invalid JSON on dataset line ${index + 1}`); } })
    : (() => { const value: unknown = JSON.parse(text); return Array.isArray(value) ? value : [value]; })();
  values.forEach((value, index) => validateCase(value, index));
  const cases = values as EvalCase[];
  const ids = cases.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error("dataset case ids must be unique");
  return cases;
}

export async function appendJsonLine(path: string, value: JsonValue | object): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}
