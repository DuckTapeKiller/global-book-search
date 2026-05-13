export type ProviderHealthStatus = "ok" | "flaky" | "blocked" | "down";

export interface ProviderHealth {
  providerId: string;
  status: ProviderHealthStatus;
  consecutiveFailures: number;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastStatusCode?: number;
  lastErrorMessage?: string;
}

const healthByProvider = new Map<string, ProviderHealth>();

function now(): number {
  return Date.now();
}

function classify(
  providerId: string,
  err?: unknown,
  status?: number,
): ProviderHealthStatus {
  const msg = (
    err instanceof Error ? err.message : String(err || "")
  ).toLowerCase();

  // Best-effort heuristics; we intentionally keep this simple and robust.
  if (status === 401 || status === 403) return "blocked";
  if (status === 429) return "flaky";
  if (status && status >= 500) return "down";

  if (
    msg.includes("cloudflare") ||
    msg.includes("captcha") ||
    msg.includes("access denied")
  ) {
    return "blocked";
  }
  if (
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("econnreset")
  ) {
    return "flaky";
  }
  if (
    msg.includes("getaddrinfo") ||
    msg.includes("dns") ||
    msg.includes("failed to fetch")
  ) {
    return "down";
  }

  // Default: treat as flaky unless the provider has a long failure streak.
  const current = healthByProvider.get(providerId);
  if (current && current.consecutiveFailures >= 3) return "down";
  return "flaky";
}

export function getProviderHealth(providerId: string): ProviderHealth {
  const existing = healthByProvider.get(providerId);
  if (existing) return existing;
  const created: ProviderHealth = {
    providerId,
    status: "ok",
    consecutiveFailures: 0,
  };
  healthByProvider.set(providerId, created);
  return created;
}

export function recordProviderSuccess(providerId: string): ProviderHealth {
  const current = getProviderHealth(providerId);
  const next: ProviderHealth = {
    ...current,
    status: "ok",
    consecutiveFailures: 0,
    lastSuccessAt: now(),
  };
  healthByProvider.set(providerId, next);
  return next;
}

export function recordProviderFailure(
  providerId: string,
  err?: unknown,
  status?: number,
): ProviderHealth {
  const current = getProviderHealth(providerId);
  const nextFailures = (current.consecutiveFailures || 0) + 1;
  const next: ProviderHealth = {
    ...current,
    status: classify(providerId, err, status),
    consecutiveFailures: nextFailures,
    lastErrorAt: now(),
    lastStatusCode: status ?? current.lastStatusCode,
    lastErrorMessage: err instanceof Error ? err.message : String(err || ""),
  };
  healthByProvider.set(providerId, next);
  return next;
}

export function resetProviderHealth(): void {
  healthByProvider.clear();
}

export function getAllProviderHealth(): ProviderHealth[] {
  return Array.from(healthByProvider.values());
}
