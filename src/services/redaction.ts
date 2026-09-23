const SENSITIVE_KEY = /(secret|token|password|api[_-]?key|authorization|cookie|private[_-]?key|client[_-]?secret)/i;
const MAX_DEPTH = 12;

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[REDACTED_DEPTH]";
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, depth + 1));
  }

  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    output[key] = SENSITIVE_KEY.test(key)
      ? "[REDACTED]"
      : redactSensitive(item, depth + 1);
  }
  return output;
}

export function redactedJson(value: unknown): string {
  return JSON.stringify(redactSensitive(value));
}
