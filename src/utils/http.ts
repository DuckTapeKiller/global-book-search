import {
  requestUrl,
  type RequestUrlParam,
  type RequestUrlResponse,
} from "obsidian";
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
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  // We only cache GETs, so url + accept header + responseType is sufficient.
  const accept = (req.headers?.Accept || req.headers?.accept || "").toString();
  return `GET ${req.url} | accept=${accept} | type=${responseType}`;
}

function isRetryableStatus(status?: number): boolean {
  if (!status) return true;
  return status === 429 || status >= 500;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wrapped as any).cause = err;
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (err as any).status = res.status;
          }
          throw err;
        }
      }

      if (res.status >= 200 && res.status < 400) {
        recordProviderSuccess(providerId);
      } else {
        recordProviderFailure(
          providerId,
          new Error(`HTTP ${res.status}`),
          res.status,
        );
      }

      // Cache successful responses only.
      if (useCache && key && res.status >= 200 && res.status < 400) {
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

      // Retry on rate-limit / server errors.
      if (attempt < retries && isRetryableStatus(res.status)) {
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
      lastError = err;

      const status =
        typeof err === "object" && err !== null && "status" in err
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (err as any).status
          : undefined;

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

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function clearHttpCache(): void {
  responseCache.clear();
}
