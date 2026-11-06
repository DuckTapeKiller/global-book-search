jest.mock("obsidian", () => ({ requestUrl: jest.fn() }));

import { requestUrl } from "obsidian";
import { GoogleBooksApi } from "@apis/google_books_api";
import {
  clearHttpCache,
  configureHttp,
  ProviderBlockedError,
} from "@utils/http";
import { getProviderHealth, resetProviderHealth } from "@utils/provider_health";

const mockedRequest = requestUrl as unknown as jest.Mock;

beforeAll(() => {
  (globalThis as unknown as { window: unknown }).window = globalThis;
});

beforeEach(() => {
  mockedRequest.mockReset();
  clearHttpCache();
  resetProviderHealth();
  configureHttp({ cacheEnabled: false, rateLimitMs: 0, maxRetries: 0 });
});

describe("Google Books in the service-performance panel", () => {
  it("files a successful search under google, not a generic http label", async () => {
    mockedRequest.mockResolvedValue({
      status: 200,
      text: JSON.stringify({ totalItems: 0 }),
      headers: { "content-type": "application/json" },
      json: undefined,
      arrayBuffer: new ArrayBuffer(0),
    });
    await new GoogleBooksApi("en", false, "").getByQuery("dune");

    expect(getProviderHealth("google").lastSuccessAt).toBeDefined();
    expect(getProviderHealth("http").lastSuccessAt).toBeUndefined();
  });

  const quotaReply = () =>
    mockedRequest.mockResolvedValue({
      status: 429,
      text: JSON.stringify({ error: { code: 429 } }),
      headers: { "content-type": "application/json" },
      json: undefined,
      arrayBuffer: new ArrayBuffer(0),
    });

  it("files a quota failure (HTTP 429) under google too", async () => {
    quotaReply();
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      await new GoogleBooksApi("en", false, "")
        .getByQuery("dune")
        .catch(() => []);
    } finally {
      warn.mockRestore();
    }
    expect(getProviderHealth("google").lastStatusCode).toBe(429);
    expect(getProviderHealth("http").lastStatusCode).toBeUndefined();
  });

  it("explains a used-up shared quota instead of reporting no results", async () => {
    quotaReply();
    const error = await new GoogleBooksApi("en", false, "")
      .getByQuery("dune")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderBlockedError);
    expect((error as ProviderBlockedError).shortReason).toBe("quota used up");
    expect((error as Error).message).toContain("Add your own free API key");
  });

  it("tells someone with their own key that the key's quota is used up", async () => {
    quotaReply();
    const error = await new GoogleBooksApi("en", false, "my-key")
      .getByQuery("dune")
      .catch((e: unknown) => e);
    expect((error as Error).message).toContain("your API key has used up");
  });

  it("tries a refused request as often as the retry setting says, not more", async () => {
    configureHttp({ maxRetries: 2, retryBaseDelayMs: 1 });
    quotaReply();
    await new GoogleBooksApi("en", false, "")
      .getByQuery("dune")
      .catch(() => []);
    expect(mockedRequest).toHaveBeenCalledTimes(3);
  });
});
