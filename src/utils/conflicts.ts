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
 *
 * A choice is the most frequent only when more sources gave it than any other
 * value; a tie marks none. The incoming `isQuorum` flags are not used: they
 * mark the value the merge preferred, which the window preselects instead.
 */
export function groupConflictValues(
  values: FieldConflict["values"],
): ConflictChoice[] {
  const choices = new Map<string, ConflictChoice>();
  for (const { value, source } of values) {
    const key = comparableValue(value);
    const existing = choices.get(key);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
    } else {
      choices.set(key, { value, sources: [source], isQuorum: false });
    }
  }
  const grouped = [...choices.values()];
  const most = Math.max(0, ...grouped.map((choice) => choice.sources.length));
  const leaders = grouped.filter((choice) => choice.sources.length === most);
  if (leaders.length === 1) leaders[0].isQuorum = true;
  return grouped;
}
