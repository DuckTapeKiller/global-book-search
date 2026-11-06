jest.mock("obsidian", () => ({ requestUrl: jest.fn() }));

import { requestUrl } from "obsidian";
import {
  StoryGraphApi,
  cleanCookieValue,
  isSignInPage,
  isStoryGraphUrl,
  storyGraphLogin,
} from "@apis/storygraph_api";
import { Book } from "@models/book.model";
import {
  clearHttpCache,
  configureHttp,
  ProviderBlockedError,
} from "@utils/http";
import { resetProviderHealth } from "@utils/provider_health";

const mockedRequest = requestUrl as unknown as jest.Mock;

const CHALLENGE_HEADERS = { "cf-mitigated": "challenge", server: "cloudflare" };
const CHALLENGE_HTML =
  '<html><head><title>Just a moment...</title><meta content="script-src https://challenges.cloudflare.com"></head></html>';

function blockedOnce() {
  mockedRequest.mockResolvedValueOnce({
    status: 403,
    text: CHALLENGE_HTML,
    headers: CHALLENGE_HEADERS,
    json: undefined,
    arrayBuffer: new ArrayBuffer(0),
  });
}

beforeAll(() => {
  (globalThis as unknown as { window: unknown }).window = globalThis;
});

beforeEach(() => {
  mockedRequest.mockReset();
  clearHttpCache();
  resetProviderHealth();
  configureHttp({ cacheEnabled: false, rateLimitMs: 0, retryBaseDelayMs: 1 });
});

describe("StoryGraphApi behind a Cloudflare challenge", () => {
  it("reports the block instead of returning empty search results", async () => {
    blockedOnce();
    await expect(new StoryGraphApi().getByQuery("dune")).rejects.toBeInstanceOf(
      ProviderBlockedError,
    );
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });

  it("does not send another request while it is cooling down", async () => {
    blockedOnce();
    const api = new StoryGraphApi();
    await api.getByQuery("dune").catch(() => undefined);
    await expect(api.getByQuery("emma")).rejects.toBeInstanceOf(
      ProviderBlockedError,
    );
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps the book it was given when enrichment is blocked", async () => {
    blockedOnce();
    const book = {
      title: "Dune",
      author: "Frank Herbert",
      authors: ["Frank Herbert"],
      coverUrl: "",
      link: "https://app.thestorygraph.com/books/abc",
    } as Book;

    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      await expect(new StoryGraphApi().getBook(book)).resolves.toBe(book);
      // A block is expected news, not a warning.
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

const LOGIN = { session: "sess123", rememberToken: "remember456" };

function respondOnce(status: number, text: string, headers = {}) {
  mockedRequest.mockResolvedValueOnce({
    status,
    text,
    headers,
    json: undefined,
    arrayBuffer: new ArrayBuffer(0),
  });
}

/** The headers of the n-th request the mocked transport received. */
const sentHeaders = (n = 0): Record<string, string> =>
  (mockedRequest.mock.calls[n][0] as { headers: Record<string, string> })
    .headers;

describe("cleanCookieValue", () => {
  it("keeps a plain value", () => {
    expect(cleanCookieValue("abc--123%3D", "remember_user_token")).toBe(
      "abc--123%3D",
    );
  });

  it("drops the cookie name when it was pasted along with the value", () => {
    expect(
      cleanCookieValue("remember_user_token=abc", "remember_user_token"),
    ).toBe("abc");
  });

  it("removes whitespace, quotes and separators that would break the header", () => {
    expect(cleanCookieValue('  "ab c;d,e\\f"\n', "x")).toBe("abcdef");
  });

  it("tolerates a missing value", () => {
    expect(cleanCookieValue(undefined as unknown as string, "x")).toBe("");
  });
});

describe("storyGraphLogin", () => {
  it("is undefined when no cookie is saved", () => {
    expect(
      storyGraphLogin({
        storygraphSessionCookie: "",
        storygraphRememberToken: " ",
      }),
    ).toBeUndefined();
  });

  it("returns the cleaned cookies, and accepts either one alone", () => {
    expect(
      storyGraphLogin({
        storygraphSessionCookie: "_storygraph_session=s1",
        storygraphRememberToken: "r1",
      }),
    ).toEqual({ session: "s1", rememberToken: "r1" });
    expect(
      storyGraphLogin({
        storygraphSessionCookie: "",
        storygraphRememberToken: "r1",
      }),
    ).toEqual({ session: "", rememberToken: "r1" });
  });
});

describe("isStoryGraphUrl", () => {
  it("accepts StoryGraph itself over HTTPS only", () => {
    expect(isStoryGraphUrl("https://app.thestorygraph.com/browse?x=1")).toBe(
      true,
    );
    expect(isStoryGraphUrl("http://app.thestorygraph.com/browse")).toBe(false);
  });

  it("rejects other and look-alike hosts and malformed addresses", () => {
    for (const url of [
      "https://www.thestorygraph.com/books/1",
      "https://app.thestorygraph.com.evil.example/books/1",
      "https://evil.example/?https://app.thestorygraph.com",
      "https://web.archive.org/web/2022/https://app.thestorygraph.com/books/1",
      "not a url",
      "",
    ]) {
      expect(isStoryGraphUrl(url)).toBe(false);
    }
  });
});

describe("isSignInPage", () => {
  it("recognises StoryGraph's sign-in page", () => {
    expect(
      isSignInPage("<html><title>Sign In | The StoryGraph</title></html>"),
    ).toBe(true);
    expect(
      isSignInPage("<p>You need to sign in or sign up before continuing.</p>"),
    ).toBe(true);
  });

  it("never mistakes a page with books for it", () => {
    expect(
      isSignInPage('<div class="book-pane">x</div><a>You need to sign in</a>'),
    ).toBe(false);
    expect(isSignInPage("<html><title>Browse</title></html>")).toBe(false);
    expect(isSignInPage("")).toBe(false);
  });
});

describe("StoryGraphApi with and without a login", () => {
  const CHALLENGE = [403, CHALLENGE_HTML, CHALLENGE_HEADERS] as const;

  it("sends no cookie, and asks for a login, when none is saved", async () => {
    respondOnce(...CHALLENGE);
    const error = await new StoryGraphApi().getByQuery("dune").catch((e) => e);

    expect(sentHeaders().Cookie).toBeUndefined();
    expect(error).toBeInstanceOf(ProviderBlockedError);
    expect((error as ProviderBlockedError).shortReason).toBe("sign-in needed");
    expect((error as Error).message).toContain(
      "StoryGraph only answers signed-in requests",
    );
  });

  it("sends both cookies to StoryGraph when a login is saved", async () => {
    respondOnce(...CHALLENGE);
    await new StoryGraphApi(LOGIN).getByQuery("dune").catch(() => undefined);
    expect(sentHeaders().Cookie).toBe(
      "_storygraph_session=sess123; remember_user_token=remember456",
    );
  });

  it("sends only the cookie that is saved", async () => {
    respondOnce(...CHALLENGE);
    await new StoryGraphApi({ session: "", rememberToken: "r" })
      .getByQuery("dune")
      .catch(() => undefined);
    expect(sentHeaders().Cookie).toBe("remember_user_token=r");
  });

  it("says the login was not accepted when StoryGraph still challenges", async () => {
    respondOnce(...CHALLENGE);
    const error = await new StoryGraphApi(LOGIN)
      .getByQuery("dune")
      .catch((e) => e);
    expect((error as ProviderBlockedError).shortReason).toBe(
      "login not accepted",
    );
    expect((error as Error).message).toContain(
      "StoryGraph did not accept your login",
    );
  });

  it("treats a sign-in page instead of results as a login that was not accepted", async () => {
    respondOnce(
      200,
      "<html><head><title>Sign In | The StoryGraph</title></head></html>",
    );
    const error = await new StoryGraphApi(LOGIN)
      .getByQuery("dune")
      .catch((e) => e);
    expect(error).toBeInstanceOf(ProviderBlockedError);
    expect((error as ProviderBlockedError).shortReason).toBe(
      "login not accepted",
    );
  });

  it("is not held back by a pause earned without a login", async () => {
    respondOnce(...CHALLENGE);
    await new StoryGraphApi().getByQuery("dune").catch(() => undefined);

    respondOnce(...CHALLENGE);
    await new StoryGraphApi(LOGIN).getByQuery("dune").catch(() => undefined);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  it("pauses a rejected login, but tries fresh cookies at once", async () => {
    respondOnce(...CHALLENGE);
    await new StoryGraphApi(LOGIN).getByQuery("dune").catch(() => undefined);

    // Same (rejected) login again: no request.
    await new StoryGraphApi(LOGIN).getByQuery("dune").catch(() => undefined);
    expect(mockedRequest).toHaveBeenCalledTimes(1);

    // Fresh cookies: a real request.
    respondOnce(...CHALLENGE);
    await new StoryGraphApi({ session: "new", rememberToken: "new" })
      .getByQuery("dune")
      .catch(() => undefined);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  it("never sends the login to a book link on another host", async () => {
    respondOnce(200, "<html></html>");
    const book = {
      title: "Dune",
      author: "Frank Herbert",
      authors: ["Frank Herbert"],
      coverUrl: "",
      link: "https://example.org/books/abc",
    } as Book;
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      await new StoryGraphApi(LOGIN).getBook(book);
    } finally {
      warn.mockRestore();
    }
    expect(mockedRequest).toHaveBeenCalled();
    expect(sentHeaders().Cookie).toBeUndefined();
  });
});
