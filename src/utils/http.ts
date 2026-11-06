import {
  requestUrl,
  type RequestUrlParam,
  type RequestUrlResponse,
} from "obsidian";
import { GLOBAL_SEARCH_SOURCE_LABELS } from "@src/constants";
import {
  recordProviderFailure,
  recordProviderSuccess,
} from "@utils/provider_health";

export type HttpResponseType = "text" | "json" | "arrayBuffer";

export interface HttpConfig {
  diagnosticsEnabled: boolean;
  cacheEnabled: boolean;
  cacheTtlMs: number;
  // Minimum delay between requests to the same domain.
  rateLimitMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
}

const DEFAULT_HTTP_CONFIG: HttpConfig = {
  diagnosticsEnabled: false,
  cacheEnabled: true,
  cacheTtlMs: 10 * 60 * 1000, // 10 minutes
  rateLimitMs: 400,
  maxRetries: 2,
  retryBaseDelayMs: 650,
};

let httpConfig: HttpConfig = { ...DEFAULT_HTTP_CONFIG };

export function configureHttp(next: Partial<HttpConfig>): void {
  httpConfig = { ...httpConfig, ...next };
}

export function getHttpConfig(): HttpConfig {
  return { ...httpConfig };
}

type CacheEntry = {
  expiresAt: number;
  response: Pick<RequestUrlResponse, "status" | "headers" | "text"> & {
    json?: unknown;
  };
};

const responseCache = new Map<string, CacheEntry>();
const nextAllowedAtByHost = new Map<string, number>();

function now(): number {
  return Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getHost(url: string): string {
  try {
    return new URL(url).host || "";
  } catch {
    return "";
  }
}

function cacheKey(
  req: RequestUrlParam,
  responseType: HttpResponseType,
): string {
  // GETs only: url + accept header + responseType, plus the login the request
  // carries, so a response fetched with one login is never served for another.
  const accept = (req.headers?.Accept || req.headers?.accept || "").toString();
  return `GET ${req.url} | accept=${accept} | type=${responseType} | login=${credentialTag(req)}`;
}

/**
 * A short fingerprint of the login (Cookie header) a request carries, or ""
 * for an anonymous request. Keeps logins apart in the cache and in challenge
 * cooldowns without keeping the cookie itself.
 */
function credentialTag(req: RequestUrlParam): string {
  const cookie = headerValue(req.headers, "cookie");
  if (!cookie) return "";
  let hash = 0x811c9dc5; // FNV-1a, 32 bit
  for (let i = 0; i < cookie.length; i++) {
    hash ^= cookie.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function isRetryableStatus(status?: number): boolean {
  if (!status) return true;
  return status === 202 || status === 429 || status >= 500;
}

// Markers of JavaScript bot challenges (AWS WAF on Goodreads, Cloudflare, …)
// that some providers serve instead of the real page. Goodreads additionally
// answers HTTP 202 with an empty body when it refuses a request outright.
const BOT_CHALLENGE_MARKERS = [
  "awswaf",
  "gokuprops",
  "challenge-container",
  "cf-chl",
  "cf-browser-verification",
];

export function looksLikeBotChallenge(
  status?: number,
  bodyText?: string,
  headers?: Record<string, string>,
): boolean {
  if (status === 202) return true;
  if (isCloudflareChallenge(headers, bodyText)) return true;
  const head = (bodyText || "").slice(0, 5000).toLowerCase();
  if (!head) return false;
  return BOT_CHALLENGE_MARKERS.some((marker) => head.includes(marker));
}

function headerValue(
  headers: Record<string, string> | undefined,
  name: string,
): string {
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === name) return String(value);
  }
  return "";
}

/**
 * A Cloudflare managed challenge ("Just a moment..."). Cloudflare marks these
 * with a `cf-mitigated: challenge` header; the page itself is the fallback
 * check. Cloudflare's `challenge-platform` script is also injected into
 * ordinary pages, so it is deliberately not treated as a sign of a challenge.
 */
export function isCloudflareChallenge(
  headers?: Record<string, string>,
  bodyText?: string,
): boolean {
  if (headerValue(headers, "cf-mitigated").toLowerCase() === "challenge") {
    return true;
  }
  const head = (bodyText || "").slice(0, 6000).toLowerCase();
  return (
    head.includes("<title>just a moment...</title>") &&
    head.includes("challenges.cloudflare.com")
  );
}

/** How long a host that served a Cloudflare challenge is left alone. */
export const CHALLENGE_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * A provider refusing requests: a bot check that plain requests cannot pass
 * (thrown by `httpRequest` to callers that pass `rejectOnChallenge`), or a
 * provider's own refusal such as a used-up quota. The message is meant to be
 * shown to the user as it is; `shortReason` suits compact status lines.
 */
export class ProviderBlockedError extends Error {
  /** A few words for compact status lines, such as "blocked". */
  readonly shortReason: string;

  constructor(
    readonly providerId: string,
    readonly status: number,
    readonly retryInMs: number,
    detail: { message?: string; shortReason?: string } = {},
  ) {
    const label = GLOBAL_SEARCH_SOURCE_LABELS[providerId] || providerId;
    const minutes = Math.max(1, Math.ceil(retryInMs / 60_000));
    super(
      detail.message ??
        `${label} is blocking automated requests (a Cloudflare bot check, HTTP ${status}). ` +
          `Try another source; ${label} will be tried again in about ${minutes} min.`,
    );
    this.name = "ProviderBlockedError";
    this.shortReason = detail.shortReason ?? "blocked";
  }
}

// Host (and login) pairs that recently served a challenge, and when they may
// be tried again. A request with a different login is not held back.
const challengeUntil = new Map<string, number>();

function cooldownKey(host: string, req: RequestUrlParam): string {
  const tag = credentialTag(req);
  return tag ? `${host}#${tag}` : host;
}

function getContentType(headers: Record<string, string>): string {
  return (headers["content-type"] || headers["Content-Type"] || "").toString();
}

function parseJsonOrThrow(args: {
  text: string;
  url: string;
  status: number;
  headers: Record<string, string>;
  providerId: string;
  purpose: string;
}): unknown {
  const { text, url, status, headers, providerId, purpose } = args;
  try {
    return JSON.parse(text);
  } catch (err) {
    const contentType = getContentType(headers);
    const preview = (text || "").slice(0, 160).replace(/\s+/g, " ").trim();
    const message = `Failed to parse JSON (${providerId}${purpose ? `:${purpose}` : ""}) status=${status} content-type=${contentType} url=${url} preview=${JSON.stringify(preview)}`;
    const wrapped = new Error(message);
    // Preserve original error without relying on newer `ErrorOptions.cause`.
    (wrapped as unknown as Record<string, unknown>).cause = err;
    throw wrapped;
  }
}

export interface HttpRequestOptions {
  providerId?: string; // for health tracking + diagnostics
  purpose?: string; // optional label for logs
  responseType?: HttpResponseType;
  cacheTtlMs?: number;
  bypassCache?: boolean;
  // Overrides global config per call.
  maxRetries?: number;
  // Throw ProviderBlockedError when the host answers with a Cloudflare
  // challenge, and skip the request outright while the host is cooling down
  // from an earlier one. Without it the challenge page is returned as is.
  rejectOnChallenge?: boolean;
}

export async function httpRequest(
  req: RequestUrlParam,
  options: HttpRequestOptions = {},
): Promise<RequestUrlResponse> {
  const responseType: HttpResponseType = options.responseType || "text";
  const providerId = options.providerId || "unknown";
  const purpose = options.purpose || "";

  const method = (req.method || "GET").toUpperCase();
  const useCache =
    httpConfig.cacheEnabled &&
    !options.bypassCache &&
    method === "GET" &&
    responseType !== "arrayBuffer";

  const key = useCache ? cacheKey(req, responseType) : "";
  if (useCache && key) {
    const cached = responseCache.get(key);
    if (cached && cached.expiresAt > now()) {
      if (httpConfig.diagnosticsEnabled) {
        console.debug(`[http cache hit] ${providerId} ${purpose} ${req.url}`);
      }
      return {
        status: cached.response.status,
        headers: cached.response.headers,
        text: cached.response.text ?? "",
        json: cached.response.json,
        arrayBuffer: new ArrayBuffer(0),
      };
    }
  }

  const host = getHost(req.url);
  if (options.rejectOnChallenge && host) {
    const retryInMs = (challengeUntil.get(cooldownKey(host, req)) ?? 0) - now();
    if (retryInMs > 0) {
      throw new ProviderBlockedError(providerId, 403, retryInMs);
    }
  }
  if (host && httpConfig.rateLimitMs > 0) {
    const nextAllowedAt = nextAllowedAtByHost.get(host) || 0;
    const wait = nextAllowedAt - now();
    if (wait > 0) await sleep(wait);
  }

  const retries = options.maxRetries ?? httpConfig.maxRetries;
  let lastError: unknown = undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (httpConfig.diagnosticsEnabled) {
        console.debug(
          `[http] ${providerId}${purpose ? ` (${purpose})` : ""} ${method} ${req.url}`,
        );
      }

      const res = await requestUrl({
        ...req,
        // Always allow callers to inspect non-2xx responses; we handle status
        // checks + retries ourselves.
        throw: req.throw ?? false,
      });

      if (host && httpConfig.rateLimitMs > 0) {
        nextAllowedAtByHost.set(host, now() + httpConfig.rateLimitMs);
      }

      const normalizedText = res.text ?? "";
      let normalizedJson: unknown = undefined;
      if (responseType === "json") {
        try {
          normalizedJson = parseJsonOrThrow({
            text: normalizedText,
            url: req.url,
            status: res.status,
            headers: res.headers || {},
            providerId,
            purpose,
          });
        } catch (err) {
          // Preserve status on the thrown error so the outer handler can record
          // provider health once, consistently.
          if (typeof err === "object" && err !== null) {
            (err as unknown as Record<string, unknown>).status = res.status;
          }
          throw err;
        }
      }

      const challenged =
        responseType !== "arrayBuffer" &&
        isCloudflareChallenge(res.headers, normalizedText);
      const blocked =
        responseType !== "arrayBuffer" &&
        looksLikeBotChallenge(res.status, normalizedText, res.headers);

      if (blocked) {
        recordProviderFailure(
          providerId,
          new Error(`Bot challenge response (HTTP ${res.status})`),
          res.status,
        );
      } else if (res.status >= 200 && res.status < 400) {
        recordProviderSuccess(providerId);
      } else {
        recordProviderFailure(
          providerId,
          new Error(`HTTP ${res.status}`),
          res.status,
        );
      }

      if (challenged && host) {
        challengeUntil.set(
          cooldownKey(host, req),
          now() + CHALLENGE_COOLDOWN_MS,
        );
        if (options.rejectOnChallenge) {
          throw new ProviderBlockedError(
            providerId,
            res.status,
            CHALLENGE_COOLDOWN_MS,
          );
        }
      }

      // Cache successful responses only. Never cache bot-challenge pages:
      // a cached challenge would mask recovery for the whole TTL.
      if (
        useCache &&
        key &&
        !blocked &&
        res.status >= 200 &&
        res.status < 400
      ) {
        const ttl = Math.max(0, options.cacheTtlMs ?? httpConfig.cacheTtlMs);
        responseCache.set(key, {
          expiresAt: now() + ttl,
          response: {
            status: res.status,
            headers: res.headers,
            text: normalizedText,
            json: responseType === "json" ? normalizedJson : undefined,
          },
        });
      }

      // Retry on rate-limit / server errors / bot challenges. A Cloudflare
      // challenge never clears on retry, and retrying only hammers the host.
      if (
        attempt < retries &&
        !challenged &&
        (blocked || isRetryableStatus(res.status))
      ) {
        const delay = httpConfig.retryBaseDelayMs * Math.pow(2, attempt);
        if (httpConfig.diagnosticsEnabled) {
          console.debug(
            `[http retry] ${providerId} status=${res.status} attempt=${attempt + 1}/${retries} delay=${delay}ms`,
          );
        }
        await sleep(delay);
        continue;
      }

      // IMPORTANT: Do not touch `res.json` for HTML/text requests.
      // Obsidian's `RequestUrlResponse.json` can throw when the response body
      // isn't valid JSON (e.g., StoryGraph / Goodreads HTML pages).
      if (responseType === "arrayBuffer") {
        return res;
      }

      return {
        status: res.status,
        headers: res.headers,
        arrayBuffer: res.arrayBuffer,
        text: normalizedText,
        json: responseType === "json" ? normalizedJson : undefined,
      };
    } catch (err: unknown) {
      // Already recorded above; retrying would not change the outcome.
      if (err instanceof ProviderBlockedError) throw err;
      lastError = err;

      const status = (
        typeof err === "object" && err !== null && "status" in err
          ? (err as Record<string, unknown>).status
          : undefined
      ) as number | undefined;

      recordProviderFailure(providerId, err, status);

      if (attempt < retries && isRetryableStatus(status)) {
        const delay = httpConfig.retryBaseDelayMs * Math.pow(2, attempt);
        if (httpConfig.diagnosticsEnabled) {
          console.debug(
            `[http retry] ${providerId} error attempt=${attempt + 1}/${retries} delay=${delay}ms`,
          );
        }
        await sleep(delay);
        continue;
      }

      break;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(typeof lastError === "string" ? lastError : "Request failed");
}

export function clearHttpCache(): void {
  responseCache.clear();
  challengeUntil.clear();
}
