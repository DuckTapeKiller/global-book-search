import type { FieldConflict } from "@models/accuracy.model";

/** A conflict value as text, without ever producing "[object Object]". */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map((v) => displayValue(v)).join(", ");
  return "";
}

/** The form two values are compared in: same text, ignoring case and spacing. */
export function comparableValue(value: unknown): string {
  return displayValue(value).toLowerCase().replace(/\s+/g, " ").trim();
}

export interface ConflictChoice {
  value: unknown;
  sources: string[];
  isQuorum: boolean;
}

/**
 * One choice per distinct value, naming every source that gave it, so two
 * sources that agree are shown as one card rather than two identical ones.
 */
export function groupConflictValues(
  values: FieldConflict["values"],
): ConflictChoice[] {
  const choices = new Map<string, ConflictChoice>();
  for (const { value, source, isQuorum } of values) {
    const key = comparableValue(value);
    const existing = choices.get(key);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      existing.isQuorum = existing.isQuorum || isQuorum;
    } else {
      choices.set(key, { value, sources: [source], isQuorum });
    }
  }
  return [...choices.values()];
}
