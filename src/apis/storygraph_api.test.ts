jest.mock("obsidian", () => ({ requestUrl: jest.fn() }));

import {
  requestUrl,
  type RequestUrlParam,
  type RequestUrlResponse,
} from "obsidian";
import {
  StoryGraphApi,
  cleanCookieValue,
  isSignInPage,
  isStoryGraphUrl,
  parseTranslators,
  storyGraphLogin,
  parseNarrators,
  parseStoryGraphDate,
  splitStoryGraphTags,
  storyGraphDescription,
  parseStoryGraphBookPage,
} from "@apis/storygraph_api";
import { Book } from "@models/book.model";
import {
  clearHttpCache,
  configureHttp,
  ProviderBlockedError,
} from "@utils/http";
import { resetProviderHealth } from "@utils/provider_health";

const mockedRequest = requestUrl as unknown as jest.Mock<
  Promise<RequestUrlResponse>,
  [RequestUrlParam]
>;

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
    const error = await new StoryGraphApi()
      .getByQuery("dune")
      .catch((e: unknown) => e);

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
      .catch((e: unknown) => e);
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
      .catch((e: unknown) => e);
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

describe("parseTranslators", () => {
  it("reads a single translator", () => {
    expect(parseTranslators("with Gregory Rabassa (Translator)")).toEqual([
      "Gregory Rabassa",
    ]);
  });

  it("keeps every translator, in order", () => {
    expect(
      parseTranslators(
        "with William Weaver (Translator), Richard Dixon (Translator)",
      ),
    ).toEqual(["William Weaver", "Richard Dixon"]);
  });

  it("leaves out contributors in other roles", () => {
    expect(
      parseTranslators("with Jane Doe (Illustrator), John Roe (Translator)"),
    ).toEqual(["John Roe"]);
    expect(parseTranslators("with Jane Doe (Narrator)")).toEqual([]);
  });

  it("accepts a translator with a second role", () => {
    expect(parseTranslators("with Ann Lee (Translator, Introduction)")).toEqual(
      ["Ann Lee"],
    );
  });

  it("reads a line without roles as translators", () => {
    expect(parseTranslators("with Mary Ann Evans")).toEqual(["Mary Ann Evans"]);
    expect(parseTranslators("with A. Smith and B. Jones")).toEqual([
      "A. Smith",
      "B. Jones",
    ]);
  });

  it("returns nothing for an empty line and drops repeats", () => {
    expect(parseTranslators("")).toEqual([]);
    expect(
      parseTranslators("with Ann Lee (Translator), Ann Lee (Translator)"),
    ).toEqual(["Ann Lee"]);
  });
});

describe("parseNarrators", () => {
  it("keeps narrators only", () => {
    expect(
      parseNarrators("with Ray Porter (Narrator), Jane Doe (Translator)"),
    ).toEqual(["Ray Porter"]);
    expect(parseNarrators("with William Weaver")).toEqual([]);
  });
});

describe("parseStoryGraphDate", () => {
  it("writes StoryGraph's dates the way Goodreads does", () => {
    expect(parseStoryGraphDate("26 Jun 1997")).toBe("1997/06/26");
    expect(parseStoryGraphDate("1 Feb 2006")).toBe("2006/02/01");
    expect(parseStoryGraphDate("Sep 2012")).toBe("2012/09");
    expect(parseStoryGraphDate("1980")).toBe("1980");
  });

  it("leaves placeholders and unknown text empty", () => {
    expect(parseStoryGraphDate("Not specified")).toBe("");
    expect(parseStoryGraphDate("")).toBe("");
  });
});

describe("splitStoryGraphTags", () => {
  it("tells genres, moods and pace apart by their colour", () => {
    const teal = "inline-block text-teal-700 dark:text-teal-200";
    const pink = "inline-block text-pink-500 dark:text-pink-200";
    expect(
      splitStoryGraphTags([
        { text: "fiction", className: teal },
        { text: "fantasy", className: teal },
        { text: "adventurous", className: pink },
        { text: "lighthearted", className: pink },
        { text: "fast-paced", className: pink },
      ]),
    ).toEqual({
      categories: "fiction, fantasy",
      moods: "adventurous, lighthearted",
      pace: "fast-paced",
    });
  });
});

describe("storyGraphDescription", () => {
  it("reads the whole text from the Show More script", () => {
    const html =
      '<p class="trix-content mt-3">The year is 1327. Benedictines...</p>' +
      "<script>$('.read-more-btn').on('click', function(e) { $(this).parent().parent().html('<h4 class=\"section-heading uppercase\">Description</h4><div class=\"trix-content mt-3\"><div>The year is 1327. Brother William\\'s mission<br>is overshadowed &amp; dark.</div></div>') })</script>";
    expect(storyGraphDescription(html)).toBe(
      "The year is 1327. Brother William's mission is overshadowed & dark.",
    );
  });

  it("falls back to the visible text of a short description", () => {
    expect(
      storyGraphDescription(
        '<p class="trix-content mt-3">A short &quot;book&quot;.</p>',
      ),
    ).toBe('A short "book".');
  });
});

describe("parseStoryGraphBookPage", () => {
  const page = `
    <div class="book-cover w-28"><img src="https://cdn.thestorygraph.com/cover.jpg"></div>
    <div class="book-title-author-and-series">
      <p class="font-semibold tracking-tight text-base"><a href="/series/152">Harry Potter</a> <a href="/series/152">#1</a></p>
      <h3 class="font-semibold text-2xl md:w-11/12"> Harry Potter y la piedra filosofal </h3>
      <p class="font-body font-medium mb-1 text-base"> <a href="/authors/1">J.K. Rowling</a> <span class="font-normal">with</span> <a href="/authors/2">Alicia Dellepiane Rawson</a> <span class="font-normal">(Translator)</span> </p></div>
    <p class='text-sm font-light text-darkestGrey mt-1'> <span>254 pages</span> <span> • hardcover • first pub 1997</span> • <a href="/books/x/editions">1.6k editions</a> </p>
    <div class="hidden edition-info mt-3" data-book-id=x>
      <p class="text-sm"><span class="font-semibold">ISBN/UID:</span> 9788478884452</p>
      <p class="text-sm"><span class="font-semibold">Format:</span> Hardcover</p>
      <p class="text-sm"><span class="font-semibold">Language:</span> Spanish</p>
      <p class="text-sm"><span class="font-semibold">Publisher:</span> Salamandra</p>
      <p class="text-sm"><span class="font-semibold">Edition Pub Date:</span> 26 Jun 1997</p>
    </div>
    <div class="book-page-tag-section relative" data-book-id=x>
      <span class="inline-block text-teal-700">fiction</span>
      <span class="inline-block text-pink-500">adventurous</span>
      <span class="inline-block text-pink-500">fast-paced</span>
    </div>
    <p class="trix-content mt-3">Harry vive con sus tíos.</p>`;

  it("reads everything about the edition", () => {
    expect(
      parseStoryGraphBookPage(page, "https://app.thestorygraph.com/books/x"),
    ).toMatchObject({
      title: "Harry Potter y la piedra filosofal",
      series: "Harry Potter",
      seriesNumber: "1",
      author: "J.K. Rowling",
      authors: ["J.K. Rowling"],
      translator: "Alicia Dellepiane Rawson",
      narrator: "",
      totalPage: "254",
      format: "Hardcover",
      language: "Spanish",
      publisher: "Salamandra",
      publishDate: "1997/06/26",
      firstPublishDate: "1997",
      isbn13: "9788478884452",
      isbn10: "",
      categories: "fiction",
      moods: "adventurous",
      pace: "fast-paced",
      description: "Harry vive con sus tíos.",
      coverUrl: "https://cdn.thestorygraph.com/cover.jpg",
    });
  });

  it("leaves a placeholder publisher and date empty and reads an ASIN", () => {
    const book = parseStoryGraphBookPage(
      page
        .replace("Salamandra", "Not specified")
        .replace("26 Jun 1997", "Not specified")
        .replace("9788478884452", "B074W9WW4S"),
      "https://app.thestorygraph.com/books/x",
    );
    expect(book.publisher).toBe("");
    expect(book.publishDate).toBe("");
    expect(book.asin).toBe("B074W9WW4S");
    expect(book.isbn13).toBe("");
  });
});
