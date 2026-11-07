// Jest runtime mock for the Obsidian API.
//
// Note: This file is mapped to the module name "obsidian" via `jest.config.js`.
// Do NOT import from "obsidian" within this file, or it will recurse.

import { parse } from "yaml";

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

// Unit tests never touch the network: a test that sends requests stubs
// requestUrl itself (jest.mock("obsidian", ...)) or mocks @utils/http.
export function requestUrl(
  request: string | RequestUrlParam,
): Promise<RequestUrlResponse> {
  const url = typeof request === "string" ? request : request.url;
  return Promise.reject(
    new Error(`requestUrl is not mocked in this test (requested ${url})`),
  );
}

// Obsidian's parseYaml is the yaml package's parser.
export function parseYaml(text: string): unknown {
  return parse(text) as unknown;
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
