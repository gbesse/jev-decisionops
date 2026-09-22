import type { DecisionRequest, JsonValue } from "./types.js";

const SECRET_KEY = /(^|_)(authorization|api[-_]?key|password|passwd|secret|token|cookie)($|_)/i;

function redact(value: JsonValue, path: string, explicit: Set<string>, common: boolean, replacement: string, counter: { value: number }): JsonValue {
  if (Array.isArray(value)) return value.map((child, index) => redact(child, `${path}.${index}`, explicit, common, replacement, counter));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      const childPath = path ? `${path}.${key}` : key;
      if (explicit.has(childPath) || (common && SECRET_KEY.test(key))) { counter.value++; return [key, replacement]; }
      return [key, redact(child, childPath, explicit, common, replacement, counter)];
    }));
  }
  return value;
}

export function redactRequest(request: DecisionRequest, options: { enabled?: boolean; paths?: string[]; redactCommonSecretKeys?: boolean; replacement?: string } | undefined): { request: DecisionRequest; count: number } {
  if (!options?.enabled) return { request, count: 0 };
  const counter = { value: 0 };
  const clone = redact(request as unknown as JsonValue, "", new Set(options.paths ?? []), options.redactCommonSecretKeys !== false, options.replacement ?? "[REDACTED]", counter) as unknown as DecisionRequest;
  return { request: clone, count: counter.value };
}
