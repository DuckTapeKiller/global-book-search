// Jest runtime mock for the Obsidian API.
//
// Note: This file is mapped to the module name "obsidian" via `jest.config.js`.
// Do NOT import from "obsidian" within this file, or it will recurse.

export type RequestUrlParam = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
  contentType?: string;
  throw?: boolean;
};

export type RequestUrlResponse = {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
  json: unknown;
  text: string;
};

export async function requestUrl(
  request: string | RequestUrlParam,
): Promise<RequestUrlResponse> {
  const url = typeof request === "string" ? request : request.url;
  const method = typeof request === "string" ? "GET" : request.method || "GET";
  const headers = typeof request === "string" ? undefined : request.headers;
  const body = typeof request === "string" ? undefined : request.body;

  const res = await fetch(url, { method, headers, body: body as BodyInit });
  const arrayBuffer = await res.arrayBuffer();
  const text = new TextDecoder().decode(new Uint8Array(arrayBuffer));

  let json: unknown = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore non-JSON responses
  }

  return {
    status: res.status,
    headers: (() => {
      const out: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        out[key] = value;
      });
      return out;
    })(),
    arrayBuffer,
    json,
    text,
  };
}

export function normalizePath(path: string): string {
  const normalized = (path ?? "")
    .replace(/[\u00A0\u202F]/g, " ")
    .replace(/[\\/]+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .normalize("NFC");

  // Collapse accidental double slashes after trimming.
  return normalized.replace(/\/{2,}/g, "/");
}

export class Notice {
  constructor(_message?: string, _timeout?: number) {}
  setMessage(_message: string) {}
  hide() {}
}

// Minimal classes used as runtime values in imports.
export class App {}
export class TFile {
  path = "";
  basename = "";
}
