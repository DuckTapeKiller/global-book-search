import { Book } from "@models/book.model";
import { BaseBooksApiImpl } from "@apis/base_api";
import { getHttpConfig, httpRequest, ProviderBlockedError } from "@utils/http";
import { getArray, getProp, getString, isRecord } from "@utils/json";
import type { BookSearchPluginSettings } from "@settings/settings";

/**
 * The user's own StoryGraph login: the two cookies their browser holds after
 * signing in. StoryGraph puts a Cloudflare check in front of anonymous
 * requests but answers signed-in ones, so this is what makes the source work.
 */
export interface StoryGraphLogin {
  session: string; // _storygraph_session
  rememberToken: string; // remember_user_token
}

const STORYGRAPH_HOST = "app.thestorygraph.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";

/**
 * A cookie value as pasted from the browser: accepted with or without its
 * name ("remember_user_token=…"), with characters that can never be part of a
 * cookie value (whitespace, quotes, separators) removed so the header stays
 * well formed.
 */
export function cleanCookieValue(raw: string, name: string): string {
  let value = (raw ?? "").trim();
  if (value.startsWith(`${name}=`)) value = value.slice(name.length + 1);
  return value.replace(/[\s;,"\\]/g, "");
}

/** The StoryGraph login saved in the settings, or undefined when there is none. */
export function storyGraphLogin(
  settings: Pick<
    BookSearchPluginSettings,
    "storygraphSessionCookie" | "storygraphRememberToken"
  >,
): StoryGraphLogin | undefined {
  const session = cleanCookieValue(
    settings.storygraphSessionCookie,
    "_storygraph_session",
  );
  const rememberToken = cleanCookieValue(
    settings.storygraphRememberToken,
    "remember_user_token",
  );
  return session || rememberToken ? { session, rememberToken } : undefined;
}

/** True only for HTTPS addresses on StoryGraph itself: the login goes nowhere else. */
export function isStoryGraphUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === STORYGRAPH_HOST;
  } catch {
    return false;
  }
}

/** StoryGraph's sign-in page, served instead of results when a login is missing or stale. */
export function isSignInPage(html: string): boolean {
  const text = html || "";
  if (text.includes("book-pane") || text.includes("data-book-id")) return false;
  return (
    text.includes("You need to sign in") ||
    text.includes("You are being redirected") ||
    text.includes("<title>Sign In")
  );
}

/**
 * The translators in StoryGraph's contributor line, in order: "with William
 * Weaver (Translator), Richard Dixon (Translator)" gives both. Contributors in
 * other roles (illustrators, narrators…) are left out. A line without any roles
 * is read as a list of translators.
 */
export function parseTranslators(text: string): string[] {
  return namesWithRole(text, /translat/i, true);
}

/** The narrators in StoryGraph's contributor line, in order. */
export function parseNarrators(text: string): string[] {
  return namesWithRole(text, /narrat|read by/i, false);
}

function namesWithRole(
  text: string,
  role: RegExp,
  rolelessLineMeansRole: boolean,
): string[] {
  const line = (text ?? "").replace(/^\s*with\s+/i, "").trim();
  const names: string[] = [];
  const add = (name: string) => {
    const clean = name.replace(/^\s*(?:and|&)\s+/i, "").trim();
    if (clean && !names.includes(clean)) names.push(clean);
  };
  if (!line) return names;
  if (!line.includes("(")) {
    if (!rolelessLineMeansRole) return names;
    for (const name of line.split(/,|\band\b|&/)) add(name);
    return names;
  }
  const entry = /([^,()]+?)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = entry.exec(line)) !== null) {
    if (role.test(match[2])) add(match[1]);
  }
  return names;
}

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

/**
 * A StoryGraph date ("26 Jun 1997", "Jun 1997", "1997") in the yyyy/mm/dd
 * form Goodreads uses, so the two sources agree when they give the same date.
 * "Not specified" and anything unrecognised come back empty.
 */
export function parseStoryGraphDate(text: string): string {
  const value = (text || "").trim();
  let m = /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})$/i.exec(value);
  if (m && MONTHS[m[2].toLowerCase()]) {
    return `${m[3]}/${MONTHS[m[2].toLowerCase()]}/${m[1].padStart(2, "0")}`;
  }
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{4})$/i.exec(value);
  if (m && MONTHS[m[1].toLowerCase()]) {
    return `${m[2]}/${MONTHS[m[1].toLowerCase()]}`;
  }
  m = /^(\d{4})$/.exec(value);
  return m ? m[1] : "";
}

/**
 * StoryGraph's tags, split the way the page colours them: genres (teal),
 * moods (pink) and pace ("fast-paced").
 */
export function splitStoryGraphTags(
  tags: Array<{ text: string; className: string }>,
): { categories: string; moods: string; pace: string } {
  const genres: string[] = [];
  const moods: string[] = [];
  const pace: string[] = [];
  for (const tag of tags) {
    const value = tag.text.replace(/\s+/g, " ").trim();
    if (!value || value.length > 40) continue;
    const list = /-paced$/i.test(value)
      ? pace
      : /\bpink\b|text-pink/.test(tag.className)
        ? moods
        : genres;
    if (!list.includes(value)) list.push(value);
  }
  return {
    categories: genres.join(", "),
    moods: moods.join(", "),
    pace: pace.join(", "),
  };
}

function htmlText(html: string): string {
  return (html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(?:div|p|li)>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_m, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A book page's description. The page shows 250 characters and keeps the
 * whole text in the script behind its "Show More" link; that is read first,
 * and the visible text only when there is no such script (a short
 * description, shown whole).
 */
export function storyGraphDescription(html: string): string {
  const scripts = (html || "").matchAll(/\.html\('((?:[^'\\]|\\.)*)'\)/g);
  for (const script of scripts) {
    const markup = script[1].replace(/\\(.)/g, (_m, c: string) =>
      c === "n" ? "\n" : c === "t" ? " " : c === "r" ? "" : c,
    );
    if (!/>\s*Description\s*</i.test(markup)) continue;
    const body = markup.replace(/<h4[^>]*>[\s\S]*?<\/h4>/i, "");
    const text = htmlText(body);
    if (text) return text;
  }
  const visible = /<p class="trix-content[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(
    html || "",
  );
  return visible ? htmlText(visible[1]) : "";
}

/**
 * Everything a StoryGraph book page says about its edition: title, series,
 * authors, translators and narrators, page count, format, language,
 * publisher, edition date, first publication, identifiers, genres, moods,
 * pace, cover and the full description. Pure: reads the page's HTML text.
 */
export function parseStoryGraphBookPage(html: string, link: string): Book {
  const page = html || "";
  const block =
    /class="book-title-author-and-series"[^>]*>([\s\S]*?)<\/div>/i.exec(
      page,
    )?.[1] || "";

  const seriesMatch =
    /<a href="\/series\/\d+"[^>]*>([^<]+)<\/a>(?:\s*<a href="\/series\/\d+"[^>]*>\s*#?([^<]*)<\/a>)?/i.exec(
      block,
    );
  const title = htmlText(/<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(block)?.[1] || "");

  const people =
    /<p class="font-body[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1] || "";
  const withAt = people.search(/<span[^>]*>\s*with\s*<\/span>/i);
  const authorPart = withAt >= 0 ? people.slice(0, withAt) : people;
  const contributorLine = withAt >= 0 ? htmlText(people.slice(withAt)) : "";
  const authors: string[] = [];
  for (const m of authorPart.matchAll(/<a[^>]*>([^<]+)<\/a>/g)) {
    const name = htmlText(m[1]);
    if (name && !authors.includes(name)) authors.push(name);
  }

  const summary = htmlText(
    /<p class='text-sm font-light[^']*'[^>]*>([\s\S]*?)<\/p>/i.exec(
      page,
    )?.[1] || "",
  );

  const info: Record<string, string> = {};
  const infoBlock =
    /class="[^"]*\bedition-info\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(
      page,
    )?.[1] || "";
  for (const m of infoBlock.matchAll(
    /<span class="font-semibold">\s*([^<:]+):\s*<\/span>\s*([^<]*)/g,
  )) {
    const key = m[1].trim().toLowerCase();
    if (!(key in info)) info[key] = htmlText(m[2]);
  }
  const uid = (info["isbn/uid"] || "").replace(/[^0-9A-Z]/gi, "").toUpperCase();

  const tagBlock =
    /class="book-page-tag-section[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(
      page,
    )?.[1] || "";
  const tags = [
    ...tagBlock.matchAll(/<span class="([^"]*)"[^>]*>([^<]+)<\/span>/g),
  ].map((m) => ({ className: m[1], text: htmlText(m[2]) }));

  const tagFields = splitStoryGraphTags(tags);

  const cover =
    /<div class="book-cover[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i.exec(
      page,
    )?.[1] || "";
  const coverUrl = /placeholder-cover/i.test(cover) ? "" : cover;

  const firstPub = /first pub (\d{3,4})/i.exec(summary)?.[1] || "";
  const publisher = info["publisher"] || "";

  return {
    title,
    author: authors[0] || "",
    authors,
    translator: parseTranslators(contributorLine)
      .filter((name) => !authors.includes(name))
      .join(", "),
    narrator: parseNarrators(contributorLine).join(", "),
    series: htmlText(seriesMatch?.[1] || ""),
    seriesNumber: (seriesMatch?.[2] || "").trim(),
    totalPage: /(\d[\d,]*)\s+pages/i.exec(summary)?.[1].replace(/,/g, "") || "",
    format: info["format"] || "",
    language: info["language"] || "",
    publisher: /^not specified$/i.test(publisher) ? "" : publisher,
    publishDate: parseStoryGraphDate(info["edition pub date"] || ""),
    firstPublishDate: firstPub,
    isbn13: /^97[89]\d{10}$/.test(uid) ? uid : "",
    isbn10: /^\d{9}[\dX]$/.test(uid) ? uid : "",
    asin: /^B0[0-9A-Z]{8}$/.test(uid) ? uid : "",
    categories: tagFields.categories,
    category: tagFields.categories,
    moods: tagFields.moods,
    pace: tagFields.pace,
    coverUrl,
    coverSmallUrl: coverUrl,
    description: storyGraphDescription(page),
    link,
    previewLink: link,
  };
}

export class StoryGraphApi implements BaseBooksApiImpl {
  static readonly SCRAPER_VERSION = "2026-05-13";

  private readonly baseUrl = `https://${STORYGRAPH_HOST}`;

  constructor(private readonly login?: StoryGraphLogin) {}

  /** Request headers for `url`; the login is attached only for StoryGraph itself. */
  private headersFor(url: string): Record<string, string> {
    const headers: Record<string, string> = { "User-Agent": USER_AGENT };
    if (!this.login || !isStoryGraphUrl(url)) return headers;
    const cookies = [
      this.login.session && `_storygraph_session=${this.login.session}`,
      this.login.rememberToken &&
        `remember_user_token=${this.login.rememberToken}`,
    ].filter(Boolean);
    if (cookies.length > 0) headers.Cookie = cookies.join("; ");
    return headers;
  }

  /** A refusal from StoryGraph, explained in terms of the login the user can fix. */
  private refusal(status: number, retryInMs = 0): ProviderBlockedError {
    return this.login
      ? new ProviderBlockedError("storygraph", status, retryInMs, {
          message:
            "StoryGraph did not accept your login; it has probably expired. Sign in to StoryGraph in your browser and copy fresh cookies into Settings → Global Book Search → Sources → StoryGraph.",
          shortReason: "login not accepted",
        })
      : new ProviderBlockedError("storygraph", status, retryInMs, {
          message:
            "StoryGraph only answers signed-in requests. Add your StoryGraph login in Settings → Global Book Search → Sources → StoryGraph to search it.",
          shortReason: "sign-in needed",
        });
  }

  private parseHtml(html: string): Document {
    const parser = new DOMParser();
    return parser.parseFromString(html || "", "text/html");
  }

  private text(el: Element | null | undefined): string {
    return (el?.textContent || "").trim();
  }

  async getByQuery(query: string): Promise<Book[]> {
    const searchUrl = `${this.baseUrl}/browse?search_term=${encodeURIComponent(query)}`;
    try {
      const searchRes = await httpRequest(
        { url: searchUrl, method: "GET", headers: this.headersFor(searchUrl) },
        {
          providerId: "storygraph",
          purpose: "search",
          rejectOnChallenge: true,
        },
      ).catch((error: unknown) => {
        throw error instanceof ProviderBlockedError
          ? this.refusal(error.status, error.retryInMs)
          : error;
      });

      // A sign-in page instead of results: the login is missing or stale.
      if (isSignInPage(searchRes.text)) throw this.refusal(401);

      const doc = this.parseHtml(searchRes.text);
      const books: Book[] = [];

      const strategies: Array<{ id: string; run: () => void }> = [
        {
          id: "book-pane",
          run: () => {
            doc.querySelectorAll(".book-pane").forEach((paneEl) => {
              const titleNode = paneEl.querySelector(
                ".book-title-author-and-series h3 a",
              );
              const relativeLink = titleNode?.getAttribute("href");

              if (!relativeLink) return;

              const fullLink = relativeLink.startsWith("http")
                ? relativeLink
                : `${this.baseUrl}${relativeLink}`;

              const bookData = this.extractBookData(paneEl, fullLink);
              if (bookData.title && bookData.title !== "Unknown Title") {
                bookData.sourceId =
                  paneEl.getAttribute("data-book-id") || undefined;
                books.push(bookData);
              }
            });
          },
        },
        {
          id: "data-book-id",
          run: () => {
            doc.querySelectorAll("[data-book-id]").forEach((paneEl) => {
              const titleNode = paneEl.querySelector("h3 a");
              const relativeLink = titleNode?.getAttribute("href");

              if (!relativeLink || !relativeLink.includes("/books/")) return;

              const fullLink = relativeLink.startsWith("http")
                ? relativeLink
                : `${this.baseUrl}${relativeLink}`;

              const bookData = this.extractBookData(paneEl, fullLink);
              if (bookData.title && bookData.title !== "Unknown Title") {
                bookData.sourceId =
                  paneEl.getAttribute("data-book-id") || undefined;
                books.push(bookData);
              }
            });
          },
        },
      ];

      for (const s of strategies) {
        if (books.length > 0) break;
        s.run();
        if (books.length > 0 && getHttpConfig().diagnosticsEnabled) {
          console.debug(
            `[storygraph] strategy=${s.id} results=${books.length}`,
          );
        }
      }

      return books;
    } catch (error) {
      // StoryGraph sits behind a Cloudflare bot check. Tell the caller instead
      // of reporting "no results", so the user learns why nothing came back.
      if (error instanceof ProviderBlockedError) throw error;
      console.warn("StoryGraph getByQuery failed:", {
        url: searchUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async getBook(book: Book): Promise<Book> {
    // The page of the edition the user picked has everything about that
    // edition in one request; the editions list is only a fallback.
    const fromPage = await this.fetchBookPage(book);
    if (fromPage) return fromPage;

    try {
      const editionsUrl = `${book.link}/editions`;
      const editionsRes = await httpRequest(
        {
          url: editionsUrl,
          method: "GET",
          headers: this.headersFor(editionsUrl),
        },
        {
          providerId: "storygraph",
          purpose: "editions",
          rejectOnChallenge: true,
        },
      );

      const doc = this.parseHtml(editionsRes.text);
      const allEditions = Array.from(doc.querySelectorAll(".book-pane"));

      if (allEditions.length === 0) {
        return book;
      }

      let bestBook = book;
      let maxScore = -1;
      let exactMatchFound = false;

      for (const paneEl of allEditions) {
        const id = paneEl.getAttribute("data-book-id") || undefined;
        const currentEdition = this.extractBookData(paneEl, book.link);
        currentEdition.sourceId = id;

        // CRITICAL: If this is the EXACT edition ID the user selected, use it!
        if (id && book.sourceId && id === book.sourceId) {
          bestBook = currentEdition;
          exactMatchFound = true;
          break;
        }

        const score = this.calculateEditionScore(currentEdition);
        if (score > maxScore) {
          maxScore = score;
          bestBook = currentEdition;
        }
      }

      // If we didn't find an exact match or the best one has no ISBN, try fallback
      if (!exactMatchFound && !bestBook.isbn13 && !bestBook.isbn10) {
        const { isbn10, isbn13 } = await this.fetchIsbnFromBookPage(book.link);
        if (isbn13) bestBook = { ...bestBook, isbn13 };
        if (isbn10) bestBook = { ...bestBook, isbn10 };
      }

      return bestBook;
    } catch (error) {
      if (!(error instanceof ProviderBlockedError)) {
        console.warn("StoryGraph getBook error", error);
      }
      return book;
    }
  }

  /** The picked edition, read from its own page, or null when that fails. */
  private async fetchBookPage(book: Book): Promise<Book | null> {
    if (!book.link || !isStoryGraphUrl(book.link)) return null;
    try {
      const res = await httpRequest(
        { url: book.link, method: "GET", headers: this.headersFor(book.link) },
        { providerId: "storygraph", purpose: "book", rejectOnChallenge: true },
      );
      if (isSignInPage(res.text)) return null;
      const page = parseStoryGraphBookPage(res.text, book.link);
      if (!page.title) return null;
      const merged: Record<string, unknown> = { ...book };
      for (const [key, value] of Object.entries(page)) {
        const empty =
          value === undefined ||
          value === null ||
          (typeof value === "string" && !value.trim()) ||
          (Array.isArray(value) && value.length === 0);
        if (!empty) merged[key] = value;
      }
      return merged as unknown as Book;
    } catch (error) {
      if (!(error instanceof ProviderBlockedError)) {
        console.warn("StoryGraph book page failed", error);
      }
      return null;
    }
  }

  private calculateEditionScore(book: Book): number {
    let score = 0;
    // ISBN is high value
    if (book.isbn13) score += 20;
    if (book.isbn10) score += 15;
    // Publisher is good
    if (book.publisher && book.publisher.toLowerCase() !== "not specified") {
      score += 10;
    }
    // Page count is very useful
    if (book.totalPage) {
      const pageStr = String(book.totalPage).toLowerCase();
      if (pageStr.length > 0 && !pageStr.includes("missing")) {
        score += 15;
      }
    }
    // Cover is nice to have
    if (book.coverUrl && book.coverUrl.length > 0) {
      score += 10;
    }
    // Language and date
    if (
      book.publishDate &&
      book.publishDate.toLowerCase() !== "not specified"
    ) {
      score += 5;
    }
    // Genres / Tags
    if (book.categories && book.categories.length > 0) {
      score += 5;
    }
    return score;
  }

  private async fetchIsbnFromBookPage(
    bookLink: string,
  ): Promise<{ isbn10: string; isbn13: string }> {
    let isbn10 = "";
    let isbn13 = "";

    try {
      const res = await httpRequest(
        {
          url: bookLink,
          method: "GET",
          headers: this.headersFor(bookLink),
        },
        {
          providerId: "storygraph",
          purpose: "book-fallback",
          rejectOnChallenge: true,
        },
      );

      const html: string = res.text;
      if (!html) return { isbn10, isbn13 };

      // Try JSON-LD structured data
      const jsonLdMatches = html.matchAll(
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
      );
      for (const match of jsonLdMatches) {
        try {
          const data: unknown = JSON.parse(match[1]);
          const entries = Array.isArray(data) ? (data as unknown[]) : [data];
          for (const entry of entries) {
            const rec = isRecord(entry) ? entry : {};
            const graphFirst = getArray(rec["@graph"])[0];
            const rawIsbn =
              getString(rec.isbn) ||
              getString(rec.isbn13) ||
              getString(rec.isbn10) ||
              getString(getProp(graphFirst, "isbn"));
            if (rawIsbn) {
              const digits = rawIsbn.replace(/[^0-9X]/gi, "");
              if (digits.length === 13) isbn13 = digits;
              else if (digits.length === 10) isbn10 = digits;
            }
          }
          if (isbn13 || isbn10) break;
        } catch {
          // malformed JSON-LD — continue
        }
      }

      // Fallback: try meta tags
      if (!isbn13 && !isbn10) {
        const metaMatch = html.match(
          /<meta[^>]+(?:name|property)=["'](?:isbn|og:isbn|book:isbn)["'][^>]+content=["']([0-9X]+)["']/i,
        );
        if (metaMatch) {
          const digits = metaMatch[1].replace(/[^0-9X]/gi, "");
          if (digits.length === 13) isbn13 = digits;
          else if (digits.length === 10) isbn10 = digits;
        }
      }

      // Fallback: scan entire HTML for 13-digit ISBN-like sequences near "isbn"
      if (!isbn13 && !isbn10) {
        const isbnPattern = /isbn[^0-9]{0,10}(97[89][0-9]{10})/gi;
        const isbnMatch = html.match(isbnPattern);
        if (isbnMatch) {
          const digits = isbnMatch[0].replace(/[^0-9]/g, "");
          if (digits.length === 13) isbn13 = digits;
        }
      }
    } catch (err) {
      if (!(err instanceof ProviderBlockedError)) {
        console.warn("StoryGraph fetchIsbnFromBookPage failed:", err);
      }
    }

    return { isbn10, isbn13 };
  }

  private extractBookData(paneEl: Element, link: string): Book {
    // Title, author, cover, summary come from desktopLayout
    const desktopLayout = paneEl.querySelector(".hidden.md\\:block") || paneEl;

    const title = this.text(
      desktopLayout.querySelector(".book-title-author-and-series h3 a"),
    );
    const normalizedTitle = title || "Unknown Title";

    // ── Primary Author ──────────────────────────────────────────────────────
    const authors: string[] = [];
    desktopLayout
      .querySelectorAll(".book-title-author-and-series p.font-body > a")
      .forEach((el) => {
        const a = this.text(el);
        if (a && !authors.includes(a)) authors.push(a);
      });

    // ── Translators ─────────────────────────────────────────────────────────
    // Every translator StoryGraph lists, in order, and nobody in another role.
    const translator = parseTranslators(
      this.text(paneEl.querySelector("span.hidden.contributor-names")),
    )
      .filter((name) => !authors.includes(name))
      .join(", ");

    // ── Edition metadata ────────────────────────────────────────────────────
    let isbn10 = "";
    let isbn13 = "";
    let publisher = "";
    let publishDate = "";
    let totalPage = "";
    let format = "";
    let language = "";
    let firstPublishDate = "";

    // Parse labels like "ISBN/UID", "Publisher", "Edition Pub Date"
    paneEl.querySelectorAll(".edition-info p").forEach((p) => {
      const text = this.text(p);
      if (!text.includes(":")) return;

      const parts = text.split(":");
      const key = parts[0].toLowerCase().trim();
      const value = parts.slice(1).join(":").trim();

      if (key.includes("isbn")) {
        const digits = value.replace(/[^0-9X]/gi, "");
        if (digits.length === 13) isbn13 = digits;
        else if (digits.length === 10) isbn10 = digits;
      } else if (key.includes("publisher")) {
        publisher = /^not specified$/i.test(value) ? "" : value;
      } else if (key.includes("original pub")) {
        firstPublishDate = parseStoryGraphDate(value);
      } else if (
        key.includes("edition pub date") ||
        key.includes("edition published") ||
        key.includes("pub date")
      ) {
        publishDate = parseStoryGraphDate(value);
      } else if (key === "format") {
        format = value;
      } else if (key === "language") {
        language = value;
      }
    });

    // ── Aggressive Fallbacks ───────────────────────────────────────────────

    // ISBN from entire pane text
    if (!isbn13 && !isbn10) {
      const paneText = paneEl.textContent || "";
      const isbnMatches = paneText.match(/\b97[89]\d{10}\b/g);
      if (isbnMatches) {
        for (const m of isbnMatches) {
          const digits = m.replace(/[^0-9]/g, "");
          if (digits.length === 13) {
            isbn13 = digits;
            break;
          }
        }
      }
    }

    // Pages from summary line (e.g. "498 pages • hardcover • 2015")
    if (!totalPage) {
      const summaryText = this.text(
        paneEl.querySelector("p.text-xs.font-light"),
      );
      const pageMatch = summaryText.match(/(\d+)\s*pages/i);
      if (pageMatch) totalPage = pageMatch[1];
    }

    // Genres, moods and pace from the tags, told apart by their colour.
    const tagEls = Array.from(
      paneEl.querySelectorAll(
        ".book-pane-tag-section span.inline-block, .book-pane-tag-section a, span.inline-block.book-pane-tag",
      ),
    );
    const { categories, moods, pace } = splitStoryGraphTags(
      tagEls.map((el) => ({
        text: this.text(el),
        className: el.getAttribute("class") || "",
      })),
    );

    // ── Cover ───────────────────────────────────────────────────────────────
    const coverWrapper = desktopLayout.querySelector(".book-cover");
    const imgNode = coverWrapper?.querySelector("img");
    let coverUrl = imgNode?.getAttribute("src") || "";
    if (
      coverWrapper?.classList.contains("placeholder-cover") ||
      coverUrl.includes("placeholder-cover")
    ) {
      coverUrl = "";
    }

    // Cover ISBN fallback
    if (!isbn13 && !isbn10 && coverUrl) {
      const olMatch = coverUrl.match(/\/isbn\/([0-9X]+)/i);
      if (olMatch) {
        const digits = olMatch[1].replace(/[^0-9X]/gi, "");
        if (digits.length === 13) isbn13 = digits;
        else if (digits.length === 10) isbn10 = digits;
      }
    }

    return {
      title: normalizedTitle,
      author: authors[0] || "Unknown Author",
      authors: authors.length > 0 ? authors : ["Unknown Author"],
      category: categories,
      categories,
      publisher,
      publishDate,
      totalPage,
      coverUrl,
      coverSmallUrl: coverUrl,
      description: "",
      link,
      previewLink: link,
      isbn10,
      isbn13,
      translator,
      format,
      language,
      firstPublishDate,
      moods,
      pace,
    };
  }
}
