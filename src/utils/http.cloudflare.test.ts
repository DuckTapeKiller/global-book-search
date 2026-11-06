jest.mock("obsidian", () => ({ requestUrl: jest.fn() }));

import { requestUrl } from "obsidian";
import {
  CHALLENGE_COOLDOWN_MS,
  ProviderBlockedError,
  clearHttpCache,
  configureHttp,
  httpRequest,
  isCloudflareChallenge,
  looksLikeBotChallenge,
} from "@utils/http";
import { getProviderHealth, resetProviderHealth } from "@utils/provider_health";

// What app.thestorygraph.com answers to a plain request (captured 6 Nov 2026):
// HTTP 403, header `cf-mitigated: challenge`, and this kind of page.
const CHALLENGE_HEADERS = {
  "content-type": "text/html; charset=UTF-8",
  "cf-mitigated": "challenge",
  server: "cloudflare",
};
const CHALLENGE_HTML = `<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title>
<meta http-equiv="content-security-policy" content="default-src 'none'; script-src 'nonce-x' 'unsafe-eval' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com">
</head><body><noscript>Enable JavaScript and cookies to continue</noscript></body></html>`;

// An ordinary page served through Cloudflare: it carries the same
// `challenge-platform` script Cloudflare injects everywhere.
const NORMAL_CLOUDFLARE_PAGE = `<html><head><title>Browse</title></head><body>
<script defer src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
<div class="book-pane">A book</div></body></html>`;

const mockedRequest = requestUrl as unknown as jest.Mock;

function respond(status: number, text: string, headers = {}) {
  mockedRequest.mockResolvedValueOnce({
    status,
    text,
    headers,
    json: undefined,
    arrayBuffer: new ArrayBuffer(0),
  });
}

beforeAll(() => {
  // http.ts sleeps through window.setTimeout; there is no window in node.
  (globalThis as unknown as { window: unknown }).window = globalThis;
});

beforeEach(() => {
  mockedRequest.mockReset();
  clearHttpCache();
  resetProviderHealth();
  configureHttp({
    cacheEnabled: false,
    rateLimitMs: 0,
    maxRetries: 2,
    retryBaseDelayMs: 1,
  });
});

describe("isCloudflareChallenge", () => {
  it("recognises the cf-mitigated header, whatever its case", () => {
    expect(isCloudflareChallenge({ "cf-mitigated": "challenge" }, "")).toBe(
      true,
    );
    expect(isCloudflareChallenge({ "CF-Mitigated": "Challenge" }, "")).toBe(
      true,
    );
  });

  it("recognises the challenge page even without the header", () => {
    expect(isCloudflareChallenge({}, CHALLENGE_HTML)).toBe(true);
  });

  it("does not mistake an ordinary Cloudflare-served page for a challenge", () => {
    expect(
      isCloudflareChallenge({ server: "cloudflare" }, NORMAL_CLOUDFLARE_PAGE),
    ).toBe(false);
  });

  it("does not flag a plain 403 page, a page titled like a challenge, or nothing", () => {
    expect(isCloudflareChallenge({}, "<title>Forbidden</title>")).toBe(false);
    expect(isCloudflareChallenge({}, "<title>Just a moment...</title>")).toBe(
      false,
    );
    expect(isCloudflareChallenge(undefined, undefined)).toBe(false);
    expect(isCloudflareChallenge({ "cf-mitigated": "other" }, "")).toBe(false);
  });
});

describe("looksLikeBotChallenge with headers", () => {
  it("flags a Cloudflare challenge", () => {
    expect(looksLikeBotChallenge(403, CHALLENGE_HTML, CHALLENGE_HEADERS)).toBe(
      true,
    );
  });

  it("still ignores a normal page and keeps the older checks working", () => {
    expect(looksLikeBotChallenge(200, NORMAL_CLOUDFLARE_PAGE, {})).toBe(false);
    expect(looksLikeBotChallenge(202, "", {})).toBe(true);
  });
});

describe("httpRequest and Cloudflare challenges", () => {
  const url = "https://app.thestorygraph.com/browse?search_term=dune";

  it("throws ProviderBlockedError, with a plain message, when asked to reject", async () => {
    respond(403, CHALLENGE_HTML, CHALLENGE_HEADERS);

    const error = await httpRequest(
      { url },
      { providerId: "storygraph", rejectOnChallenge: true },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderBlockedError);
    expect((error as ProviderBlockedError).providerId).toBe("storygraph");
    expect((error as ProviderBlockedError).status).toBe(403);
    expect((error as Error).message).toBe(
      "StoryGraph is blocking automated requests (a Cloudflare bot check, HTTP 403). " +
        "Try another source; StoryGraph will be tried again in about 10 min.",
    );
  });

  it("never retries a challenge, even with retries enabled", async () => {
    respond(403, CHALLENGE_HTML, CHALLENGE_HEADERS);
    await httpRequest(
      { url },
      { providerId: "storygraph", rejectOnChallenge: true, maxRetries: 3 },
    ).catch(() => undefined);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });

  it("does not retry a challenge for callers that did not opt in, and returns it as before", async () => {
    respond(403, CHALLENGE_HTML, CHALLENGE_HEADERS);
    const res = await httpRequest({ url }, { providerId: "storygraph" });
    expect(res.status).toBe(403);
    expect(res.text).toContain("Just a moment");
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });

  it("records the failure once, as blocked", async () => {
    respond(403, CHALLENGE_HTML, CHALLENGE_HEADERS);
    await httpRequest(
      { url },
      { providerId: "storygraph", rejectOnChallenge: true },
    ).catch(() => undefined);

    const health = getProviderHealth("storygraph");
    expect(health.status).toBe("blocked");
    expect(health.consecutiveFailures).toBe(1);
    expect(health.lastStatusCode).toBe(403);
  });

  it("leaves the host alone while it cools down, without sending a request", async () => {
    respond(403, CHALLENGE_HTML, CHALLENGE_HEADERS);
    await httpRequest(
      { url },
      { providerId: "storygraph", rejectOnChallenge: true },
    ).catch(() => undefined);
    expect(mockedRequest).toHaveBeenCalledTimes(1);

    const again = await httpRequest(
      { url: "https://app.thestorygraph.com/books/abc/editions" },
      { providerId: "storygraph", rejectOnChallenge: true },
    ).catch((e: unknown) => e);

    expect(again).toBeInstanceOf(ProviderBlockedError);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    // The skipped request did not count as another failure.
    expect(getProviderHealth("storygraph").consecutiveFailures).toBe(1);
  });

  it("tries the host again once the cooldown is over", async () => {
    const start = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(start);
    try {
      respond(403, CHALLENGE_HTML, CHALLENGE_HEADERS);
      await httpRequest(
        { url },
        { providerId: "storygraph", rejectOnChallenge: true },
      ).catch(() => undefined);

      clock.mockReturnValue(start + CHALLENGE_COOLDOWN_MS - 1);
      await expect(
        httpRequest(
          { url },
          { providerId: "storygraph", rejectOnChallenge: true },
        ),
      ).rejects.toBeInstanceOf(ProviderBlockedError);
      expect(mockedRequest).toHaveBeenCalledTimes(1);

      clock.mockReturnValue(start + CHALLENGE_COOLDOWN_MS + 1);
      respond(200, NORMAL_CLOUDFLARE_PAGE, { server: "cloudflare" });
      const res = await httpRequest(
        { url },
        { providerId: "storygraph", rejectOnChallenge: true },
      );
      expect(res.status).toBe(200);
      expect(mockedRequest).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it("shortens the advertised wait as the cooldown runs down", async () => {
    const start = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(start);
    try {
      respond(403, CHALLENGE_HTML, CHALLENGE_HEADERS);
      await httpRequest(
        { url },
        { providerId: "storygraph", rejectOnChallenge: true },
      ).catch(() => undefined);

      clock.mockReturnValue(start + 8 * 60_000);
      const error = await httpRequest(
        { url },
        { providerId: "storygraph", rejectOnChallenge: true },
      ).catch((e: unknown) => e);
      expect((error as Error).message).toContain("in about 2 min");
    } finally {
      clock.mockRestore();
    }
  });

  it("clearing the cache also ends the cooldown", async () => {
    respond(403, CHALLENGE_HTML, CHALLENGE_HEADERS);
    await httpRequest(
      { url },
      { providerId: "storygraph", rejectOnChallenge: true },
    ).catch(() => undefined);

    clearHttpCache();
    respond(200, NORMAL_CLOUDFLARE_PAGE);
    const res = await httpRequest(
      { url },
      { providerId: "storygraph", rejectOnChallenge: true },
    );
    expect(res.status).toBe(200);
  });

  it("only cools down the host that challenged, not other providers", async () => {
    respond(403, CHALLENGE_HTML, CHALLENGE_HEADERS);
    await httpRequest(
      { url },
      { providerId: "storygraph", rejectOnChallenge: true },
    ).catch(() => undefined);

    respond(200, "<html>fine</html>");
    const res = await httpRequest(
      { url: "https://www.goodreads.com/book/auto_complete?q=x" },
      { providerId: "goodreads", rejectOnChallenge: true },
    );
    expect(res.status).toBe(200);
  });

  it("does not skip a cooling-down host for callers that did not opt in", async () => {
    respond(403, CHALLENGE_HTML, CHALLENGE_HEADERS);
    await httpRequest(
      { url },
      { providerId: "storygraph", rejectOnChallenge: true },
    ).catch(() => undefined);

    respond(200, "<html>fine</html>");
    const res = await httpRequest({ url }, { providerId: "storygraph" });
    expect(res.status).toBe(200);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  it("passes a normal page through untouched, even when Cloudflare serves it", async () => {
    respond(200, NORMAL_CLOUDFLARE_PAGE, { server: "cloudflare" });
    const res = await httpRequest(
      { url },
      { providerId: "storygraph", rejectOnChallenge: true },
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain("book-pane");
    expect(getProviderHealth("storygraph").status).toBe("ok");
  });

  it("never serves a response fetched with one login for another", async () => {
    configureHttp({ cacheEnabled: true });
    const withCookie = (cookie: string) => ({
      url: "https://app.thestorygraph.com/browse?search_term=x",
      headers: { Cookie: cookie },
    });

    respond(200, "<html>for A</html>");
    await httpRequest(withCookie("a=1"), { providerId: "storygraph" });
    // Same login: served from the cache.
    const again = await httpRequest(withCookie("a=1"), {
      providerId: "storygraph",
    });
    expect(again.text).toBe("<html>for A</html>");
    expect(mockedRequest).toHaveBeenCalledTimes(1);

    // Another login: a fresh request.
    respond(200, "<html>for B</html>");
    const other = await httpRequest(withCookie("b=2"), {
      providerId: "storygraph",
    });
    expect(other.text).toBe("<html>for B</html>");
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  it("still retries Goodreads' empty HTTP 202 block, which can clear", async () => {
    respond(202, "");
    respond(202, "");
    respond(200, "<html>the real page</html>");
    const res = await httpRequest(
      { url: "https://www.goodreads.com/book/show/1" },
      { providerId: "goodreads" },
    );
    expect(res.status).toBe(200);
    expect(mockedRequest).toHaveBeenCalledTimes(3);
  });
});
