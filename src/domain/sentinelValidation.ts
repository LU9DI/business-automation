export const ENTITY_TYPES = [
  "person",
  "company",
  "account",
  "contract",
  "asset",
  "address",
  "vehicle",
  "case",
  "organization",
] as const;

export const RULE_KINDS = [
  "degree_threshold",
  "event_frequency",
  "amount_threshold",
  "temporal_burst",
  "shared_attribute",
] as const;

export const RULE_SEVERITIES = ["low", "medium", "high"] as const;

export function cleanText(value: unknown, maxLength = 180): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\export function finiteNumber(value: unknown): number | null {");
}

export function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
