// Persistent, rolling per-provider performance history for the last few days.
//
// Unlike provider_health (current in-memory session status), this keeps a
// time-bucketed record of every request outcome so the settings panel can show
// a 3-day performance report and users can file precise bug reports.

import { asRecord, getArray, getNumber, getString } from "@utils/json";

export type FailureReason =
  | "blocked"
  | "rate_limited"
  | "server_error"
  | "network"
  | "parse"
  | "other";

export const FAILURE_REASONS: FailureReason[] = [
  "blocked",
  "rate_limited",
  "server_error",
  "network",
  "parse",
  "other",
];

export const FAILURE_REASON_LABELS: Record<FailureReason, string> = {
  blocked: "Blocked / bot-challenge",
  rate_limited: "Rate-limited (429)",
  server_error: "Server error (5xx)",
  network: "Timeout / network",
  parse: "Parse / format error",
  other: "Other",
};

interface HourBucket {
  h: number; // hour index = floor(epochMs / HOUR_MS)
  ok: number;
  fail: number;
  reasons: Partial<Record<FailureReason, number>>;
}

interface ProviderRecord {
  buckets: HourBucket[];
  lastErrorAt?: number;
  lastErrorCode?: number;
  lastErrorMessage?: string;
  lastErrorReason?: FailureReason;
  lastSuccessAt?: number;
}

export interface DayStat {
  dayStartMs: number;
  ok: number;
  fail: number;
  total: number;
  rate: number | null; // success ratio 0..1, or null when no requests
}

export interface ProviderSummary {
  providerId: string;
  totalOk: number;
  totalFail: number;
  total: number;
  successRate: number | null;
  reasons: Record<FailureReason, number>;
  days: DayStat[]; // oldest first; length === WINDOW_DAYS
  lastErrorAt?: number;
  lastErrorCode?: number;
  lastErrorMessage?: string;
  lastErrorReason?: FailureReason;
  lastSuccessAt?: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WINDOW_DAYS = 3;
const WINDOW_MS = WINDOW_DAYS * DAY_MS;

const store = new Map<string, ProviderRecord>();

function emptyReasons(): Record<FailureReason, number> {
  return {
    blocked: 0,
    rate_limited: 0,
    server_error: 0,
    network: 0,
    parse: 0,
    other: 0,
  };
}

function isFailureReason(value: string): value is FailureReason {
  return (FAILURE_REASONS as string[]).includes(value);
}

/** Map an HTTP status / thrown error to a coarse, reportable failure reason. */
export function categorizeFailure(
  status?: number,
  error?: unknown,
): FailureReason {
  if (status === 429) return "rate_limited";
  if (status === 202 || status === 401 || status === 403) return "blocked";
  if (status && status >= 500) return "server_error";

  const msg = (
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""
  ).toLowerCase();

  if (
    msg.includes("cloudflare") ||
    msg.includes("captcha") ||
    msg.includes("bot challenge") ||
    msg.includes("awswaf") ||
    msg.includes("access denied")
  ) {
    return "blocked";
  }
  if (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("econnreset") ||
    msg.includes("failed to fetch") ||
    msg.includes("getaddrinfo") ||
    msg.includes("network") ||
    msg.includes("dns")
  ) {
    return "network";
  }
  if (
    msg.includes("parse") ||
    msg.includes("json") ||
    msg.includes("unexpected token")
  ) {
    return "parse";
  }
  return "other";
}

function getOrCreate(providerId: string): ProviderRecord {
  let rec = store.get(providerId);
  if (!rec) {
    rec = { buckets: [] };
    store.set(providerId, rec);
  }
  return rec;
}

function pruneRecord(rec: ProviderRecord, nowMs: number): void {
  const minHour = Math.floor((nowMs - WINDOW_MS) / HOUR_MS);
  rec.buckets = rec.buckets.filter((b) => b.h >= minHour);
}

/** Record a single request outcome for a provider. */
export function recordOutcome(
  providerId: string,
  ok: boolean,
  opts: { status?: number; error?: unknown } = {},
  nowMs: number = Date.now(),
): void {
  const rec = getOrCreate(providerId);
  const hour = Math.floor(nowMs / HOUR_MS);

  let bucket = rec.buckets[rec.buckets.length - 1];
  if (!bucket || bucket.h !== hour) {
    bucket = { h: hour, ok: 0, fail: 0, reasons: {} };
    rec.buckets.push(bucket);
  }

  if (ok) {
    bucket.ok += 1;
    rec.lastSuccessAt = nowMs;
  } else {
    bucket.fail += 1;
    const reason = categorizeFailure(opts.status, opts.error);
    bucket.reasons[reason] = (bucket.reasons[reason] ?? 0) + 1;
    rec.lastErrorAt = nowMs;
    rec.lastErrorCode = opts.status;
    rec.lastErrorMessage =
      opts.error instanceof Error
        ? opts.error.message
        : typeof opts.error === "string"
          ? opts.error
          : opts.status
            ? `HTTP ${opts.status}`
            : "Unknown error";
    rec.lastErrorReason = reason;
  }

  pruneRecord(rec, nowMs);
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Aggregate a provider's outcomes over the trailing `days` calendar days. */
export function summarizeProvider(
  providerId: string,
  nowMs: number = Date.now(),
  days: number = WINDOW_DAYS,
): ProviderSummary {
  const rec = store.get(providerId);
  const reasons = emptyReasons();
  const todayStart = startOfLocalDay(nowMs);

  const windows: Array<{
    start: number;
    end: number;
    ok: number;
    fail: number;
  }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = todayStart - i * DAY_MS;
    windows.push({ start, end: start + DAY_MS, ok: 0, fail: 0 });
  }
  const windowStart = windows[0].start;
  const windowEnd = windows[windows.length - 1].end;

  let totalOk = 0;
  let totalFail = 0;

  if (rec) {
    for (const b of rec.buckets) {
      const bms = b.h * HOUR_MS;
      if (bms < windowStart || bms >= windowEnd) continue;
      totalOk += b.ok;
      totalFail += b.fail;
      for (const reason of FAILURE_REASONS) {
        reasons[reason] += b.reasons[reason] ?? 0;
      }
      for (const w of windows) {
        if (bms >= w.start && bms < w.end) {
          w.ok += b.ok;
          w.fail += b.fail;
        }
      }
    }
  }

  const dayStats: DayStat[] = windows.map((w) => {
    const total = w.ok + w.fail;
    return {
      dayStartMs: w.start,
      ok: w.ok,
      fail: w.fail,
      total,
      rate: total > 0 ? w.ok / total : null,
    };
  });

  const total = totalOk + totalFail;
  return {
    providerId,
    totalOk,
    totalFail,
    total,
    successRate: total > 0 ? totalOk / total : null,
    reasons,
    days: dayStats,
    lastErrorAt: rec?.lastErrorAt,
    lastErrorCode: rec?.lastErrorCode,
    lastErrorMessage: rec?.lastErrorMessage,
    lastErrorReason: rec?.lastErrorReason,
    lastSuccessAt: rec?.lastSuccessAt,
  };
}

/** Provider ids that have at least one recorded outcome. */
export function getTrackedProviderIds(): string[] {
  return [...store.keys()];
}

export function clearHistory(): void {
  store.clear();
}

/** Plain JSON snapshot for persistence in the plugin data file. */
export function serializeHistory(): Record<string, ProviderRecord> {
  const out: Record<string, ProviderRecord> = {};
  for (const [id, rec] of store) out[id] = rec;
  return out;
}

/** Rehydrate from a persisted snapshot, dropping anything outside the window. */
export function loadHistory(data: unknown, nowMs: number = Date.now()): void {
  store.clear();
  for (const [id, value] of Object.entries(asRecord(data))) {
    const recRaw = asRecord(value);
    const buckets: HourBucket[] = [];
    for (const bRaw of getArray(recRaw.buckets)) {
      const b = asRecord(bRaw);
      const h = getNumber(b.h);
      if (h === undefined) continue;
      const reasonsRaw = asRecord(b.reasons);
      const reasons: Partial<Record<FailureReason, number>> = {};
      for (const reason of FAILURE_REASONS) {
        const n = getNumber(reasonsRaw[reason]);
        if (n) reasons[reason] = n;
      }
      buckets.push({
        h,
        ok: getNumber(b.ok) ?? 0,
        fail: getNumber(b.fail) ?? 0,
        reasons,
      });
    }

    const reasonRaw = getString(recRaw.lastErrorReason);
    const rec: ProviderRecord = {
      buckets,
      lastErrorAt: getNumber(recRaw.lastErrorAt),
      lastErrorCode: getNumber(recRaw.lastErrorCode),
      lastErrorMessage: getString(recRaw.lastErrorMessage) || undefined,
      lastErrorReason: isFailureReason(reasonRaw) ? reasonRaw : undefined,
      lastSuccessAt: getNumber(recRaw.lastSuccessAt),
    };
    pruneRecord(rec, nowMs);

    if (rec.buckets.length || rec.lastErrorAt || rec.lastSuccessAt) {
      store.set(id, rec);
    }
  }
}
