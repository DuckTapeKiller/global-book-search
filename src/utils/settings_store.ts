/**
 * Settings persistence that never destroys data it did not change.
 *
 * Obsidian's `loadData()` / `saveData()` read and write the whole `data.json`.
 * Writing the entire in-memory settings object each time is unsafe:
 *
 *  - If the file was missing or not yet synced when the plugin started, the
 *    in-memory copy is just the defaults, and the next write replaces the
 *    user's real settings with them.
 *  - If a second device (or a sync client) updated the file, a copy that was
 *    loaded earlier writes its stale values back over the newer ones.
 *
 * `SettingsStore` therefore keeps a snapshot of what it last loaded or wrote
 * and, on every save, writes only the keys whose value differs from that
 * snapshot, merged onto the file as it is on disk right now. Saving when
 * nothing changed performs no write at all, and an unreadable file is never
 * overwritten.
 */

export interface SettingsStorage {
  /**
   * Contents of `data.json`; null when it does not exist yet. Must reject when
   * the file exists but cannot be read, so it is never mistaken for missing.
   */
  load(): Promise<unknown>;
  /** Replace the contents of `data.json`. */
  save(data: Record<string, unknown>): Promise<void>;
}

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A copy of `value` exactly as it would look after a round trip to disk. */
export function toDiskValue<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Structural equality for JSON values; key order does not matter. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => jsonEqual(item, b[i]))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && jsonEqual(a[key], b[key]))
    );
  }
  return false;
}

/**
 * Overlay stored values on the defaults. Nested objects merge key by key so a
 * map saved by an older version still receives keys added since; a stored
 * `null` never replaces a default; unknown stored keys are kept.
 */
export function mergeWithDefaults<T extends object>(
  defaults: T,
  stored: unknown,
): T {
  const result = { ...defaults } as unknown as PlainObject;
  if (!isPlainObject(stored)) return result as unknown as T;

  for (const [key, value] of Object.entries(stored)) {
    if (value === undefined || value === null) continue;
    const base = result[key];
    result[key] =
      isPlainObject(base) && isPlainObject(value)
        ? mergeWithDefaults(base, value)
        : value;
  }
  return result as unknown as T;
}

/**
 * Obsidian's `loadData()` resolves to null when `data.json` does not exist, but
 * to undefined when the file exists and cannot be parsed (truncated by a sync,
 * empty, corrupt). The second case must never be mistaken for "no settings yet",
 * or the file would be overwritten; surface it as an error instead.
 */
export function requireReadableSettings(loaded: unknown): unknown {
  if (loaded === undefined) {
    throw new Error("data.json exists but could not be parsed");
  }
  return loaded;
}

export class SettingsStore<T extends object> {
  /** What this store believes `data.json` holds for the keys it manages. */
  private persisted: PlainObject = {};
  private queue: Promise<unknown> = Promise.resolve();
  private unreadable = false;

  constructor(
    private readonly storage: SettingsStorage,
    private readonly createDefaults: () => T,
  ) {}

  /** True when the initial `load()` could not read the settings file. */
  get loadFailed(): boolean {
    return this.unreadable;
  }

  /**
   * Read the settings at startup, filling gaps from the defaults. Never
   * throws: when the file cannot be read the defaults are returned (see
   * `loadFailed`) and later saves leave the file alone until it is readable.
   */
  async load(): Promise<T> {
    let stored: unknown = null;
    this.unreadable = false;
    try {
      stored = await this.storage.load();
    } catch {
      this.unreadable = true;
    }
    return this.adopt(stored);
  }

  /**
   * Fold changes made to the file outside this store (for example by sync)
   * into `current`, in place. A key is adopted when its on-disk value differs
   * from what this store last loaded or wrote, unless `current` holds an
   * unsaved change to it. Returns the adopted keys. When the file is missing
   * or unreadable nothing changes and the result is empty, so a half-written
   * file can never disturb the baseline.
   */
  reload(current: T): Promise<string[]> {
    const run = this.queue.then(() => this.fold(current));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async fold(current: T): Promise<string[]> {
    let onDisk: unknown;
    try {
      onDisk = await this.storage.load();
    } catch {
      return [];
    }
    if (!isPlainObject(onDisk)) return [];
    this.unreadable = false;

    const fromDisk = mergeWithDefaults(
      this.createDefaults(),
      onDisk,
    ) as PlainObject;
    const target = current as unknown as PlainObject;
    const adopted: string[] = [];
    for (const [key, raw] of Object.entries(onDisk)) {
      if (raw === undefined || raw === null) continue;
      const value = toDiskValue(fromDisk[key]);
      if (jsonEqual(value, this.persisted[key])) continue;
      // Keep an edit that has not been saved yet; the next save writes it.
      if (!jsonEqual(toDiskValue(target[key]), this.persisted[key])) continue;

      target[key] = fromDisk[key];
      this.persisted[key] = value;
      adopted.push(key);
    }
    return adopted;
  }

  private adopt(stored: unknown): T {
    const settings = mergeWithDefaults(this.createDefaults(), stored);
    this.persisted = toDiskValue(settings) as PlainObject;
    return settings;
  }

  /**
   * Persist the keys of `current` that changed since the last load or save.
   * Resolves true when a write happened. Rejects, without writing, when the
   * file on disk cannot be read. Calls are queued, so the file always ends up
   * holding the newest state.
   */
  save(current: T): Promise<boolean> {
    const run = this.queue.then(() => this.write(current));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async write(current: T): Promise<boolean> {
    const source = current as unknown as PlainObject;
    const changed: Array<[string, unknown]> = [];
    for (const key of Object.keys(source)) {
      if (source[key] === undefined) continue;
      const value = toDiskValue(source[key]);
      if (!jsonEqual(value, this.persisted[key])) changed.push([key, value]);
    }
    if (changed.length === 0) return false;

    // Re-read right before writing so keys we did not change keep whatever
    // value is on disk now (a throw here aborts the save untouched).
    const onDisk = await this.storage.load();
    const merged: PlainObject = isPlainObject(onDisk) ? { ...onDisk } : {};
    for (const [key, value] of changed) merged[key] = value;

    await this.storage.save(merged);
    for (const [key, value] of changed) this.persisted[key] = value;
    return true;
  }
}
