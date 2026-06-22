// Small, dependency-free helpers for safely reading values out of parsed JSON
// (and other `unknown` data) without resorting to `any`. Centralised so every
// API client narrows untrusted responses the same way.

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns the value as a record, or an empty record if it isn't one. */
export function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

/** Returns the value if it's a string, otherwise "". */
export function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Returns a finite number, or undefined. */
export function getNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

/** Returns the value if it's an array, otherwise an empty array. */
export function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Returns only the string members of an array value. */
export function getStringArray(value: unknown): string[] {
  return getArray(value).filter((v): v is string => typeof v === "string");
}

/** Reads a single property from a value if it's a record. */
export function getProp(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/** Walks a path of keys through nested records, returning undefined on a miss. */
export function getPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** Extracts a readable message from an unknown thrown value. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}
