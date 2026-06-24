import { Notice } from "obsidian";
import { Book } from "@models/book.model";
import { BaseBooksApiImpl } from "@apis/base_api";
import { getHttpConfig, httpRequest, looksLikeBotChallenge } from "@utils/http";

/**
 * Merge detail-page data into the search-result book without ever letting an
 * empty scrape erase fields the search result already had (title, author,
 * cover, …). Goodreads serves bot-challenge pages that parse to all-blank
 * books; clobbering with those produced empty notes.
 */
export function mergeBookData(base: Partial<Book>, extracted: Book): Book {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extracted)) {
    const isEmpty =
      value === undefined ||
      value === null ||
      (typeof value === "string" && !value.trim()) ||
      (Array.isArray(value) &&
        value.filter((v) => String(v).trim()).length === 0);
    if (!isEmpty) {
      merged[key] = value;
    }
  }
  return merged as unknown as Book;
}

const GOODREADS_HOST = "https://www.goodreads.com";

// Locale-prefixed paths (`/es/book/show/<id>`) dodge the AWS WAF rule that
// blocks the canonical path, and all return the *same* English book data — the
// prefix only localises UI chrome, not the apolloState payload (verified across
// en/de/ja/ru). The sticky-last-good tracker means we normally hit just one
// route; this wider pool only fans out as a fallback when routes get blocked.
const GOODREADS_LOCALES = [
  "en",
  "es",
  "de",
  "fr",
  "it",
  "pt",
  "nl",
  "ja",
  "zh",
  "ru",
  "ko",
];

export interface GoodreadsRoute {
  kind: string;
  url: string;
}

/**
 * Tier 1 of the escalation chain: every direct Goodreads detail-page route we
 * know dodges (or is) the canonical path, in priority order. Each yields the
 * exact same Next.js page, so one parser handles all of them. The variety is
 * the point — for the WAF to kill this tier it would have to block `.xml` *and*
 * every localized path, which would also break Goodreads' own i18n site.
 */
export function buildGoodreadsDetailRoutes(
  id: string,
  slug: string,
  canonicalUrl: string,
): GoodreadsRoute[] {
  const routes: GoodreadsRoute[] = [];
  if (id) {
    routes.push({ kind: "xml", url: `${GOODREADS_HOST}/book/show/${id}.xml` });
    if (slug) {
      routes.push({
        kind: "xml-slug",
        url: `${GOODREADS_HOST}/book/show/${id}.${slug}.xml`,
      });
    }
    for (const loc of GOODREADS_LOCALES) {
      routes.push({
        kind: `locale-${loc}`,
        url: `${GOODREADS_HOST}/${loc}/book/show/${id}`,
      });
    }
  }
  if (canonicalUrl) routes.push({ kind: "canonical", url: canonicalUrl });
  return routes;
}

/** Move the last route that worked to the front so we usually fetch once. */
export function orderRoutesBySticky(
  routes: GoodreadsRoute[],
  stickyKind: string | null,
): GoodreadsRoute[] {
  if (!stickyKind) return routes;
  const preferred = routes.filter((r) => r.kind === stickyKind);
  const rest = routes.filter((r) => r.kind !== stickyKind);
  return [...preferred, ...rest];
}

/**
 * Rewrite a Wayback snapshot URL to its raw form (`/web/<ts>id_/…`) so
 * archive.org returns the original page without its toolbar/link rewriting.
 */
export function waybackRawUrl(snapshotUrl: string): string {
  return (snapshotUrl || "")
    .replace(/^http:/i, "https:")
    .replace(/\/web\/(\d+)\//, "/web/$1id_/");
}

function decodeHtmlEntities(value: string): string {
  return (value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function digitsOnly(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/[^0-9X]/gi, "");
}

/**
 * Tier 4 parser layer: schema.org `Book` JSON-LD. Structure-independent, so it
 * survives a Goodreads frontend rewrite that would break the apolloState parse.
 * Pure (regex, no DOM) so it runs in the escalation path and is unit-testable.
 */
export function parseLdJsonBook(html: string): Partial<Book> {
  const out: Partial<Book> = {};
  const blocks =
    (html || "").match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ) || [];

  for (const block of blocks) {
    const jsonText = block
      .replace(/^<script[^>]*>/i, "")
      .replace(/<\/script>\s*$/i, "");
    let data: unknown;
    try {
      data = JSON.parse(jsonText);
    } catch {
      continue;
    }

    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const type = rec["@type"];
      const isBook =
        type === "Book" || (Array.isArray(type) && type.includes("Book"));
      if (!isBook) continue;

      if (!out.title && typeof rec.name === "string") {
        out.title = decodeHtmlEntities(rec.name);
      }
      const isbn = digitsOnly(rec.isbn);
      if (isbn.length === 13 && !out.isbn13) out.isbn13 = isbn;
      if (isbn.length === 10 && !out.isbn10) out.isbn10 = isbn;
      if (
        !out.totalPage &&
        (typeof rec.numberOfPages === "number" ||
          typeof rec.numberOfPages === "string")
      ) {
        out.totalPage = String(rec.numberOfPages);
      }
      if (!out.publisher) {
        const pub = rec.publisher;
        const name =
          pub && typeof pub === "object"
            ? (pub as Record<string, unknown>).name
            : pub;
        if (typeof name === "string") out.publisher = decodeHtmlEntities(name);
      }
      if (!out.coverUrl) {
        const img: unknown = Array.isArray(rec.image)
          ? (rec.image as unknown[])[0]
          : rec.image;
        if (typeof img === "string") out.coverUrl = img;
      }
      if (!out.description && typeof rec.description === "string") {
        out.description = decodeHtmlEntities(rec.description);
      }
      if (!out.categories && rec.genre != null) {
        const genre = Array.isArray(rec.genre)
          ? (rec.genre as unknown[])
              .filter((g): g is string => typeof g === "string")
              .join(", ")
          : typeof rec.genre === "string"
            ? rec.genre
            : "";
        if (genre.trim()) {
          out.categories = genre;
          out.category = genre;
        }
      }
      const authors: string[] = [];
      const rawAuthors = Array.isArray(rec.author) ? rec.author : [rec.author];
      for (const a of rawAuthors) {
        if (typeof a === "string") authors.push(a);
        else if (a && typeof a === "object") {
          const name = (a as Record<string, unknown>).name;
          if (typeof name === "string") authors.push(name);
        }
      }
      const cleanAuthors = authors.map((a) => a.trim()).filter(Boolean);
      if (cleanAuthors.length && !out.authors) {
        out.authors = cleanAuthors;
        if (!out.author) out.author = cleanAuthors[0];
      }
    }
  }
  return out;
}

/**
 * Tier 4 parser layer (last ditch): OpenGraph/Twitter meta tags. Only title,
 * cover and description survive here, but that's enough to avoid a blank note.
 */
export function parseOgMetaBook(html: string): Partial<Book> {
  const out: Partial<Book> = {};
  const read = (prop: string): string => {
    const p = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Try both attribute orders (property-then-content and content-then-property).
    const re1 = new RegExp(
      `<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`,
      "i",
    );
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${p}["']`,
      "i",
    );
    const m = (html || "").match(re1) || (html || "").match(re2);
    return m ? decodeHtmlEntities(m[1]) : "";
  };

  const title = read("og:title") || read("twitter:title");
  if (title) out.title = title.replace(/\s*\|\s*Goodreads\s*$/i, "").trim();
  const image = read("og:image");
  if (image) out.coverUrl = image;
  const description = read("og:description");
  if (description) out.description = description;
  return out;
}

// Remembers which Tier-1 route last worked, across GoodreadsApi instances
// (the factory creates a fresh instance per call). Avoids re-probing blocked
// routes on every fetch.
let stickyRouteKind: string | null = null;

export class GoodreadsApi implements BaseBooksApiImpl {
  static readonly SCRAPER_VERSION = "2026-06-14";

  // Notify at most once per session; bulk imports would otherwise spam it.
  private static didWarnDetailBlocked = false;

  // Status of the last direct-route fetch, for the fallback diagnostic Notice.
  private lastDetailStatus?: number;

  private readonly userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";

  constructor() {}

  private parseHtml(html: string): Document {
    const parser = new DOMParser();
    return parser.parseFromString(html || "", "text/html");
  }

  private text(el: Element | null | undefined): string {
    return (el?.textContent || "").trim();
  }

  private normalizeCoverUrl(url: string): string {
    return (url || "")
      .replace(/_SY\d+_/, "_SY475_")
      .replace(/_SX\d+_/, "_SX475_");
  }

  private stripHtml(html: string): string {
    return (html || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private getPath(value: unknown, path: string[]): unknown {
    let current: unknown = value;
    for (const segment of path) {
      if (!this.isRecord(current)) return undefined;
      current = current[segment];
    }
    return current;
  }

  private asString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private asNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return undefined;
  }

  private extractDigits(value: unknown): string {
    return this.asString(value).replace(/[^0-9X]/gi, "");
  }

  private extractGoodreadsLegacyId(link: string): string {
    const match = (link || "").match(/\/book\/show\/(\d+)/);
    return match?.[1] || "";
  }

  private formatDateFromEpochMs(value: unknown): string {
    const n = this.asNumber(value);
    if (!n) return "";
    const date = new Date(n);
    if (Number.isNaN(date.getTime())) return "";
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${year}/${month}/${day}`;
  }

  private tryExtractApolloBookData(
    doc: Document,
    link: string,
  ): Partial<Book> & { _authors?: string[]; _translators?: string[] } {
    const nextDataRaw = doc.querySelector("#__NEXT_DATA__")?.textContent || "";
    if (!nextDataRaw) return {};

    let nextData: unknown;
    try {
      nextData = JSON.parse(nextDataRaw);
    } catch {
      return {};
    }

    const apolloState = this.getPath(nextData, [
      "props",
      "pageProps",
      "apolloState",
    ]);
    if (!this.isRecord(apolloState)) return {};

    const rootQuery = apolloState["ROOT_QUERY"];
    if (!this.isRecord(rootQuery)) return {};

    const legacyId = this.extractGoodreadsLegacyId(link);
    const explicitKey = legacyId
      ? `getBookByLegacyId({"legacyId":"${legacyId}"})`
      : "";
    const refKey =
      (explicitKey && this.isRecord(rootQuery[explicitKey])
        ? explicitKey
        : Object.keys(rootQuery).find((k) =>
            k.startsWith("getBookByLegacyId("),
          )) || "";
    if (!refKey) return {};

    const ref = rootQuery[refKey];
    const bookRef = this.asString(this.getPath(ref, ["__ref"]));
    if (!bookRef || !this.isRecord(apolloState[bookRef])) return {};

    const bookJson = apolloState[bookRef] as Record<string, unknown>;
    const details: Record<string, unknown> = this.isRecord(bookJson["details"])
      ? bookJson["details"]
      : {};

    // Contributors (role-aware): prefer real Authors over Translators/Editors/etc.
    const authors: string[] = [];
    const translators: string[] = [];

    const pushContributor = (roleRaw: unknown, nodeRefRaw: unknown) => {
      const role = this.asString(roleRaw);
      const nodeRef = this.asString(nodeRefRaw);
      if (!role || !nodeRef || !this.isRecord(apolloState[nodeRef])) return;
      const name = this.asString(this.getPath(apolloState[nodeRef], ["name"]));
      if (!name || name.toLowerCase() === "unknown author") return;

      const normalizedRole = role.toLowerCase();
      if (normalizedRole === "translator") {
        if (!translators.includes(name)) translators.push(name);
        return;
      }
      if (normalizedRole === "author" || normalizedRole === "pseudonym") {
        if (!authors.includes(name)) authors.push(name);
      }
    };

    const primary = bookJson["primaryContributorEdge"];
    if (this.isRecord(primary)) {
      pushContributor(
        primary["role"],
        this.getPath(primary, ["node", "__ref"]),
      );
    }

    const secondary = bookJson["secondaryContributorEdges"];
    if (Array.isArray(secondary)) {
      for (const edge of secondary) {
        if (!this.isRecord(edge)) continue;
        pushContributor(edge["role"], this.getPath(edge, ["node", "__ref"]));
      }
    }

    // Genres from apolloState (more robust than UI-only "Top genres")
    const genreNames: string[] = [];
    const genresRaw = bookJson["bookGenres"];
    if (Array.isArray(genresRaw)) {
      for (const item of genresRaw) {
        if (!this.isRecord(item)) continue;
        const name = this.asString(this.getPath(item, ["genre", "name"]));
        if (name && !genreNames.includes(name)) genreNames.push(name);
      }
    }

    // Identifiers
    const isbnRaw = this.extractDigits(details["isbn"]);
    const isbn13Raw = this.extractDigits(details["isbn13"]);
    const asin = this.asString(details["asin"]);
    const numPages = this.asNumber(details["numPages"]);
    const publisher = this.asString(details["publisher"]);
    const publishDate = this.formatDateFromEpochMs(details["publicationTime"]);

    const isbn10 =
      isbnRaw.length === 10
        ? isbnRaw
        : isbn13Raw.length === 10
          ? isbn13Raw
          : "";
    const isbn13 =
      isbn13Raw.length === 13
        ? isbn13Raw
        : isbnRaw.length === 13
          ? isbnRaw
          : "";

    // Cover
    const coverUrl = this.normalizeCoverUrl(
      this.asString(bookJson["imageUrl"]),
    );

    // Work details (original title)
    let originalTitle = "";
    const workRef = this.asString(this.getPath(bookJson, ["work", "__ref"]));
    if (workRef && this.isRecord(apolloState[workRef])) {
      originalTitle = this.asString(
        this.getPath(apolloState[workRef], ["details", "originalTitle"]),
      );
    }

    const partial: Partial<Book> & {
      _authors?: string[];
      _translators?: string[];
    } = {
      publisher,
      publishDate,
      totalPage: numPages ? String(numPages) : "",
      categories: genreNames.join(", "),
      category: genreNames.join(", "),
      isbn10,
      isbn13,
      asin,
      coverUrl,
      originalTitle,
      _authors: authors,
      _translators: translators,
    };

    return partial;
  }

  async getByQuery(query: string): Promise<Book[]> {
    try {
      // The autocomplete JSON endpoint is the only one Goodreads currently
      // serves without an AWS WAF bot challenge, so try it before touching
      // the HTML search page at all.
      const autocompleteBooks = await this.getByAutocomplete(query);
      if (autocompleteBooks.length > 0) {
        if (getHttpConfig().diagnosticsEnabled) {
          console.debug(
            `[goodreads] strategy=autocompleteJson results=${autocompleteBooks.length}`,
          );
        }
        return autocompleteBooks;
      }

      // Use the explicit books search to reduce layout variance.
      const encodedQuery = encodeURIComponent(query);
      const searchUrl = `https://www.goodreads.com/search?utf8=%E2%9C%93&search_type=books&q=${encodedQuery}&query=${encodedQuery}`;
      const searchRes = await httpRequest(
        {
          url: searchUrl,
          method: "GET",
          headers: {
            "User-Agent": this.userAgent,
          },
        },
        { providerId: "goodreads", purpose: "search" },
      );

      const doc = this.parseHtml(searchRes.text);
      const strategies: Array<{
        id: string;
        run: () => Promise<Book[]> | Book[];
      }> = [
        {
          id: "direct-book-page",
          run: () => this.tryParseDirectBookPage(doc, searchUrl),
        },
        { id: "tableList", run: () => this.tryParseTableList(doc) },
        { id: "looseBookTitleLinks", run: () => this.tryParseLooseLinks(doc) },
      ];

      for (const strategy of strategies) {
        const books = await strategy.run();
        if (books.length > 0) {
          if (getHttpConfig().diagnosticsEnabled) {
            console.debug(
              `[goodreads] strategy=${strategy.id} results=${books.length}`,
            );
          }
          return books;
        }
      }

      console.warn("Goodreads: no results", {
        url: searchUrl,
        status: (searchRes as unknown as { status?: number }).status,
        htmlLength: searchRes.text?.length || 0,
        title: doc.title,
      });

      return [];
    } catch (error) {
      console.warn("Goodreads scraping error", error);
      return [];
    }
  }

  private tryParseDirectBookPage(doc: Document, fallbackUrl: string): Book[] {
    if (
      doc.querySelector('h1[data-testid="bookTitle"]') ||
      doc.querySelector("#bookTitle")
    ) {
      const canonical =
        doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ||
        fallbackUrl;
      const book = this.extractBook(doc, canonical);
      book.link = canonical;
      book.previewLink = canonical;
      return [book];
    }
    return [];
  }

  private tryParseTableList(doc: Document): Book[] {
    const tableRows = Array.from(doc.querySelectorAll("table.tableList tr"));
    if (tableRows.length === 0) return [];

    const books: Book[] = [];
    tableRows.forEach((row) => {
      const titleLink = row.querySelector("a.bookTitle");
      const title = this.text(titleLink).replace(/"/g, "'");
      const href = titleLink?.getAttribute("href");

      if (!title || !href) return;

      const author = this.text(row.querySelector("a.authorName"));
      const coverUrl =
        row.querySelector("img.bookCover")?.getAttribute("src") || "";
      const smallCoverUrl = coverUrl;

      const fullLink = href.startsWith("http")
        ? href
        : `https://www.goodreads.com${href}`;

      books.push({
        title,
        author,
        authors: [author],
        link: fullLink,
        previewLink: fullLink,
        coverUrl: this.normalizeCoverUrl(coverUrl) || "", // Try to get higher res
        coverSmallUrl: smallCoverUrl || "",
        description: "",
        publisher: "",
        publishDate: "",
        totalPage: "",
        isbn10: "",
        isbn13: "",
        categories: "",
        category: "",
        originalTitle: "",
        translator: "",
        narrator: "",
        subtitle: "",
        asin: "",
      });
    });

    return books;
  }

  private tryParseLooseLinks(doc: Document): Book[] {
    const looseTitleLinks = Array.from(doc.querySelectorAll("a.bookTitle"));
    if (looseTitleLinks.length === 0) return [];

    const books: Book[] = [];
    const seen = new Set<string>();

    for (const titleLink of looseTitleLinks) {
      const title = this.text(titleLink).replace(/"/g, "'");
      const href = titleLink.getAttribute("href");
      if (!title || !href) continue;

      const fullLink = href.startsWith("http")
        ? href
        : `https://www.goodreads.com${href}`;
      if (seen.has(fullLink)) continue;
      seen.add(fullLink);

      const container =
        titleLink.closest("tr") ||
        titleLink.closest("li") ||
        titleLink.closest("div") ||
        titleLink.parentElement;

      const author =
        this.text(container?.querySelector("a.authorName")) ||
        this.text(container?.querySelector(".authorName")) ||
        "";

      const coverUrl = (
        container?.querySelector("img")?.getAttribute("src") || ""
      ).trim();

      books.push({
        title,
        author,
        authors: author ? [author] : [],
        link: fullLink,
        previewLink: fullLink,
        coverUrl: this.normalizeCoverUrl(coverUrl),
        coverSmallUrl: coverUrl,
        description: "",
        publisher: "",
        publishDate: "",
        totalPage: "",
        isbn10: "",
        isbn13: "",
        categories: "",
        category: "",
        originalTitle: "",
        translator: "",
        narrator: "",
        subtitle: "",
        asin: "",
      });
    }

    return books;
  }

  private async getByAutocomplete(query: string): Promise<Book[]> {
    const url = `https://www.goodreads.com/book/auto_complete?format=json&q=${encodeURIComponent(query)}`;

    try {
      const res = await httpRequest(
        {
          url,
          method: "GET",
          headers: {
            "User-Agent": this.userAgent,
            Accept: "application/json",
          },
        },
        {
          providerId: "goodreads",
          purpose: "autocomplete",
          responseType: "json",
          cacheTtlMs: 60_000,
        },
      );

      const payload: unknown =
        (res as unknown as { json?: unknown }).json ??
        JSON.parse(res.text || "[]");

      const items: unknown[] = Array.isArray(payload)
        ? payload
        : // Some wrappers may return `{ results: [...] }`
          (payload as { results?: unknown[] })?.results || [];

      const books: Book[] = [];
      const seen = new Set<string>();

      for (const item of items.slice(0, 25)) {
        const obj = item as Record<string, unknown>;

        const bookIdRaw = obj.bookId ?? obj.book_id ?? obj.id;
        const bookId =
          typeof bookIdRaw === "number"
            ? String(bookIdRaw)
            : typeof bookIdRaw === "string"
              ? bookIdRaw
              : "";
        if (!bookId) continue;

        const title = this.asString(obj.title).replace(/"/g, "'");
        if (!title) continue;

        const authorName = (
          this.asString(this.getPath(obj, ["author", "name"])) ||
          this.asString(obj.authorName) ||
          this.asString(obj.author_name) ||
          this.asString(obj.author)
        ).replace(/\s+/g, " ");

        const link =
          (typeof obj.url === "string" && obj.url.startsWith("http")
            ? obj.url
            : "") || `https://www.goodreads.com/book/show/${bookId}`;

        if (seen.has(link)) continue;
        seen.add(link);

        const coverUrl =
          this.asString(obj.imageUrl) ||
          this.asString(obj.image_url) ||
          this.asString(obj.bookImageUrl) ||
          this.asString(obj.book_image_url) ||
          this.asString(obj.book_small_image_url);

        const descriptionHtml =
          this.asString(this.getPath(obj, ["description", "html"])) ||
          this.asString(obj.description);
        const description = this.stripHtml(descriptionHtml).replace(/"/g, "'");

        books.push({
          title,
          author: authorName,
          authors: authorName ? [authorName] : [],
          link,
          previewLink: link,
          coverUrl: this.normalizeCoverUrl(coverUrl),
          coverSmallUrl: coverUrl,
          description,
          publisher: "",
          publishDate: "",
          totalPage: this.asNumber(obj.numPages)
            ? String(this.asNumber(obj.numPages))
            : "",
          isbn10: "",
          isbn13: "",
          categories: "",
          category: "",
          originalTitle: "",
          translator: "",
          narrator: "",
          subtitle: "",
          asin: "",
        });
      }

      return books;
    } catch (error) {
      console.warn("Goodreads autocomplete failed:", {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private extractSlug(link: string): string {
    const m = (link || "").match(/\/book\/show\/\d+[.-]([^/?#]+)/);
    return (m?.[1] || "").replace(/\.xml$/i, "");
  }

  /**
   * Fetch full book metadata using a tiered escalation chain. Each tier is an
   * independent way to reach the data, so one breaking falls through to the
   * next instead of producing a blank note:
   *
   *   Tier 1  Direct Goodreads routes (`.xml`, locale prefixes, canonical)
   *   Tier 2  ISBN→id resolver (`isbn_to_id`) when the link carries no id
   *   Tier 3  Independent archives (Wayback Machine, archive.today)
   *   Tier 4  Layered parsing (apolloState → JSON-LD → OpenGraph) per fetch
   *   Tier 5  Cross-source top-up (Google Books, Open Library)
   *   Tier 6  Search-result data only (never blank)
   */
  async getBook(book: Book): Promise<Book> {
    const canonicalLink = book.link || "";
    this.lastDetailStatus = undefined;

    // Tiers 1–4: get a parsed detail page from Goodreads or an archive.
    const detail = await this.fetchDetail(book);
    let result = detail ? mergeBookData(book, detail) : { ...book };

    // Tier 5: top up still-missing core fields from independent sources. Only
    // fires when a tier above couldn't supply them, so successful Goodreads
    // fetches don't pay for redundant network calls.
    const missingCore =
      !result.publisher ||
      (!result.isbn13 && !result.isbn10) ||
      !result.categories;
    if (missingCore) {
      try {
        const cross = await this.fetchCrossSource(result);
        if (cross) {
          // result (Goodreads) wins where present; cross-source fills the gaps.
          result = mergeBookData(cross, result);
        }
      } catch (error) {
        console.warn("Goodreads cross-source enrichment failed", error);
      }
    }

    // Always present the canonical reader-facing link, not an .xml/archive URL.
    if (canonicalLink) {
      result.link = canonicalLink;
      result.previewLink = canonicalLink;
    }

    // Tier 6: if nothing beyond the search result could be recovered, say so.
    const recoveredDetail =
      !!result.publisher ||
      !!result.isbn13 ||
      !!result.isbn10 ||
      !!result.categories;
    if (!recoveredDetail) {
      this.warnDetailPageBlocked(this.lastDetailStatus);
    }

    return result;
  }

  /** Tiers 1–4: a parsed Book from a direct route or archive, or null. */
  private async fetchDetail(book: Book): Promise<Book | null> {
    let id = this.extractGoodreadsLegacyId(book.link);

    // Tier 2: recover the Goodreads id from an ISBN when the link has none.
    if (!id) {
      const isbn = book.isbn13 || book.isbn10 || "";
      if (isbn) id = await this.resolveIsbnToId(isbn);
    }

    const slug = this.extractSlug(book.link);
    const canonical =
      book.link || (id ? `${GOODREADS_HOST}/book/show/${id}` : "");

    // Tier 1: direct routes, sticky-last-good first so we usually fetch once.
    const routes = orderRoutesBySticky(
      buildGoodreadsDetailRoutes(id, slug, canonical),
      stickyRouteKind,
    );
    for (const route of routes) {
      const parsed = await this.tryFetchAndParse(route.url, canonical);
      if (parsed) {
        stickyRouteKind = route.kind;
        if (getHttpConfig().diagnosticsEnabled) {
          console.debug(`[goodreads] detail via route=${route.kind}`);
        }
        return parsed;
      }
    }

    // Tier 3: independent archives (a different host the WAF can't touch).
    if (canonical) {
      const archives: Array<{
        id: string;
        run: () => Promise<{ html: string } | null>;
      }> = [
        { id: "wayback", run: () => this.fetchViaWayback(canonical) },
        {
          id: "archive.today",
          run: () => this.fetchViaArchiveToday(canonical),
        },
      ];
      for (const archive of archives) {
        try {
          const snap = await archive.run();
          if (!snap) continue;
          const parsed = this.parseDetailHtml(snap.html, canonical);
          if (parsed.title.trim()) {
            if (getHttpConfig().diagnosticsEnabled) {
              console.debug(`[goodreads] detail via archive=${archive.id}`);
            }
            return parsed;
          }
        } catch (error) {
          console.warn(`Goodreads archive ${archive.id} failed`, error);
        }
      }
    }

    return null;
  }

  private async tryFetchAndParse(
    url: string,
    canonicalLink: string,
  ): Promise<Book | null> {
    try {
      const res = await httpRequest(
        { url, method: "GET", headers: { "User-Agent": this.userAgent } },
        { providerId: "goodreads", purpose: "book" },
      );
      this.lastDetailStatus = res.status;
      if (looksLikeBotChallenge(res.status, res.text)) return null;

      const parsed = this.parseDetailHtml(res.text, canonicalLink || url);
      return parsed.title.trim() ? parsed : null;
    } catch (error) {
      console.warn(`Goodreads route failed: ${url}`, error);
      return null;
    }
  }

  /** Tier 4: layered parse — apolloState/DOM, then JSON-LD, then OpenGraph. */
  private parseDetailHtml(html: string, link: string): Book {
    const doc = this.parseHtml(html);
    let parsed = this.extractBook(doc, link);
    // Structure-independent layers fill any gaps the primary parse left.
    parsed = mergeBookData(parseLdJsonBook(html), parsed);
    parsed = mergeBookData(parseOgMetaBook(html), parsed);
    return parsed;
  }

  /**
   * Tier 2: resolve a Goodreads numeric id from an ISBN via `isbn_to_id`,
   * which 301-redirects to the canonical book URL. Best-effort: depends on the
   * HTTP layer exposing the redirect Location (some clients auto-follow).
   */
  private async resolveIsbnToId(isbn: string): Promise<string> {
    const clean = digitsOnly(isbn);
    if (!clean) return "";
    try {
      const res = await httpRequest(
        {
          url: `${GOODREADS_HOST}/book/isbn_to_id/${clean}`,
          method: "GET",
          headers: { "User-Agent": this.userAgent },
        },
        { providerId: "goodreads", purpose: "isbn_to_id", cacheTtlMs: 600_000 },
      );
      const headers = res.headers || {};
      const location = headers["location"] || headers["Location"] || "";
      // Pull the id from the redirect target, or from the body if one wasn't
      // exposed (a numeric id is sometimes returned as plain text).
      return (
        this.extractGoodreadsLegacyId(location) ||
        (/^\d+$/.test((res.text || "").trim()) ? (res.text || "").trim() : "")
      );
    } catch (error) {
      console.warn("Goodreads isbn_to_id failed", error);
      return "";
    }
  }

  /** Tier 3a: latest Wayback Machine snapshot of the canonical page. */
  private async fetchViaWayback(
    canonicalUrl: string,
  ): Promise<{ html: string } | null> {
    try {
      const availRes = await httpRequest(
        {
          url: `https://archive.org/wayback/available?url=${encodeURIComponent(canonicalUrl)}`,
          method: "GET",
        },
        {
          providerId: "goodreads-archive",
          purpose: "wayback-available",
          responseType: "json",
          cacheTtlMs: 600_000,
        },
      );
      const snapUrl = this.asString(
        this.getPath(availRes.json, ["archived_snapshots", "closest", "url"]),
      );
      if (!snapUrl) return null;

      const snapRes = await httpRequest(
        {
          url: waybackRawUrl(snapUrl),
          method: "GET",
          headers: { "User-Agent": this.userAgent },
        },
        { providerId: "goodreads-archive", purpose: "wayback-snapshot" },
      );
      if (snapRes.status >= 400 || !snapRes.text) return null;
      return { html: snapRes.text };
    } catch (error) {
      console.warn("Goodreads Wayback fetch failed", error);
      return null;
    }
  }

  /** Tier 3b: archive.today snapshot — a second, independent archive operator. */
  private async fetchViaArchiveToday(
    canonicalUrl: string,
  ): Promise<{ html: string } | null> {
    try {
      const res = await httpRequest(
        {
          url: `https://archive.ph/newest/${canonicalUrl}`,
          method: "GET",
          headers: { "User-Agent": this.userAgent },
        },
        { providerId: "goodreads-archive", purpose: "archive-today" },
      );
      if (res.status >= 400 || !res.text) return null;
      // Only accept a snapshot that actually carries parseable book data.
      if (!/__NEXT_DATA__|application\/ld\+json/i.test(res.text)) return null;
      return { html: res.text };
    } catch (error) {
      console.warn("Goodreads archive.today fetch failed", error);
      return null;
    }
  }

  /** Tier 5: fill missing fields from sources that don't block scraping. */
  private async fetchCrossSource(book: Book): Promise<Partial<Book> | null> {
    const title = (book.title || "").trim();
    if (!title) return null;
    const author = (book.author || book.authors?.[0] || "").trim();
    const isbn = book.isbn13 || book.isbn10 || "";

    const google = await this.fetchGoogleBooks(
      isbn ? `isbn:${isbn}` : `${title} ${author}`.trim(),
    );
    if (google && (google.publisher || google.isbn13 || google.categories)) {
      return google;
    }

    const openLibrary = await this.fetchOpenLibrary(title, author);
    return openLibrary;
  }

  private async fetchGoogleBooks(query: string): Promise<Partial<Book> | null> {
    try {
      const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5&printType=books`;
      const res = await httpRequest(
        { url, method: "GET", headers: { Accept: "application/json" } },
        {
          providerId: "google",
          purpose: "goodreads-crosssource",
          responseType: "json",
          cacheTtlMs: 600_000,
        },
      );
      const items = this.getPath(res.json, ["items"]);
      if (!Array.isArray(items)) return null;

      for (const item of items) {
        const vi = this.getPath(item, ["volumeInfo"]);
        if (!this.isRecord(vi)) continue;

        let isbn13 = "";
        let isbn10 = "";
        const ids = vi["industryIdentifiers"];
        if (Array.isArray(ids)) {
          for (const idObj of ids) {
            const type = this.asString(this.getPath(idObj, ["type"]));
            const value = digitsOnly(this.getPath(idObj, ["identifier"]));
            if (type === "ISBN_13" && value.length === 13) isbn13 = value;
            if (type === "ISBN_10" && value.length === 10) isbn10 = value;
          }
        }
        const cats = vi["categories"];
        const categories = Array.isArray(cats) ? cats.join(", ") : "";
        const pageCount = this.asNumber(vi["pageCount"]);

        const out: Partial<Book> = {
          publisher: this.asString(vi["publisher"]),
          publishDate: this.asString(vi["publishedDate"]),
          totalPage: pageCount ? String(pageCount) : "",
          categories,
          category: categories,
          isbn13,
          isbn10,
          description: this.stripHtml(this.asString(vi["description"])),
        };
        if (out.publisher || out.isbn13 || out.categories || out.totalPage) {
          return out;
        }
      }
      return null;
    } catch (error) {
      console.warn("Goodreads cross-source (Google Books) failed", error);
      return null;
    }
  }

  private async fetchOpenLibrary(
    title: string,
    author: string,
  ): Promise<Partial<Book> | null> {
    try {
      const url =
        `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}` +
        (author ? `&author=${encodeURIComponent(author)}` : "") +
        "&limit=1&fields=isbn,publisher,number_of_pages_median,subject";
      const res = await httpRequest(
        { url, method: "GET", headers: { Accept: "application/json" } },
        {
          providerId: "openlibrary",
          purpose: "goodreads-crosssource",
          responseType: "json",
          cacheTtlMs: 600_000,
        },
      );
      const docs = this.getPath(res.json, ["docs"]);
      if (!Array.isArray(docs) || docs.length === 0) return null;
      const doc: unknown = (docs as unknown[])[0];

      let isbn13 = "";
      let isbn10 = "";
      const isbns = this.getPath(doc, ["isbn"]);
      if (Array.isArray(isbns)) {
        for (const raw of isbns) {
          const value = digitsOnly(raw);
          if (value.length === 13 && !isbn13) isbn13 = value;
          if (value.length === 10 && !isbn10) isbn10 = value;
        }
      }
      const publishers = this.getPath(doc, ["publisher"]);
      const subjects = this.getPath(doc, ["subject"]);
      const pages = this.asNumber(
        this.getPath(doc, ["number_of_pages_median"]),
      );
      const categories = Array.isArray(subjects)
        ? subjects
            .slice(0, 4)
            .map((s) => this.asString(s))
            .filter(Boolean)
            .join(", ")
        : "";

      const out: Partial<Book> = {
        publisher: Array.isArray(publishers)
          ? this.asString(publishers[0])
          : "",
        totalPage: pages ? String(pages) : "",
        categories,
        category: categories,
        isbn13,
        isbn10,
      };
      if (out.publisher || out.categories || out.isbn13 || out.totalPage) {
        return out;
      }
      return null;
    } catch (error) {
      console.warn("Goodreads cross-source (Open Library) failed", error);
      return null;
    }
  }

  private warnDetailPageBlocked(status?: number): void {
    console.warn(
      `Goodreads: book page blocked or unparseable (HTTP ${status ?? "?"}, scraper ${GoodreadsApi.SCRAPER_VERSION}); falling back to search-result data.`,
    );
    if (!GoodreadsApi.didWarnDetailBlocked) {
      GoodreadsApi.didWarnDetailBlocked = true;
      new Notice(
        "Goodreads is blocking detailed metadata requests (bot protection). Notes will be created with basic search data only — publisher, ISBN and genres may be missing.",
        10_000,
      );
    }
  }

  private extractBook(doc: Document, link: string): Book {
    // 1. Título
    const title =
      this.text(doc.querySelector('h1[data-testid="bookTitle"]')) ||
      this.text(doc.querySelector("#bookTitle")).replace(/"/g, "'");

    // 3. Resumen
    const description = this.text(doc.querySelector("span.Formatted")).replace(
      /"/g,
      "'",
    );

    // 2/4/6. Structured extraction from __NEXT_DATA__ (role-aware + stable)
    const apollo = this.tryExtractApolloBookData(doc, link);

    // 2. Autor (a) + Traductor (a)
    const authors: string[] = [...(apollo._authors || [])];
    const translator = (apollo._translators || []).join(", ");

    if (authors.length === 0) {
      // Fallback for older pages / missing apolloState
      doc
        .querySelectorAll('.ContributorLink__name[data-testid="name"]')
        .forEach((el) => {
          const a = this.text(el);
          if (a) authors.push(a);
        });
      if (authors.length === 0) {
        doc.querySelectorAll("a.authorName").forEach((el) => {
          const a = this.text(el);
          if (a) authors.push(a);
        });
      }
    }
    const authorString = authors[0] || "";

    // 4. Género
    let category = apollo.categories || apollo.category || "";
    if (!category) {
      const categories: string[] = [];
      doc
        .querySelectorAll(
          'ul[aria-label="Top genres for this book"] a.Button--tag',
        )
        .forEach((el) => {
          const c = this.text(el);
          if (c) categories.push(c);
        });
      category = categories.join(", ");
    }

    // 5. ASIN (User selector: {{selector:span[data-testid="asin"]|first|trim}})
    const asin =
      apollo.asin || this.text(doc.querySelector('span[data-testid="asin"]'));

    const originalTitle = apollo.originalTitle || "";
    const publisher = apollo.publisher || "";
    const isbn10 = apollo.isbn10 || "";
    const isbn13 = apollo.isbn13 || "";
    const publishDate = apollo.publishDate || "";

    // Pages
    let totalPage =
      typeof apollo.totalPage === "number"
        ? String(apollo.totalPage)
        : apollo.totalPage || "";
    if (!totalPage) {
      doc
        .querySelectorAll('script[type="application/ld+json"]')
        .forEach((el) => {
          try {
            const data = JSON.parse(el.textContent || "{}") as {
              ["@type"]?: unknown;
              isbn?: unknown;
              numberOfPages?: unknown;
              image?: unknown;
            };
            if (
              data["@type"] === "Book" &&
              (typeof data.numberOfPages === "number" ||
                typeof data.numberOfPages === "string")
            ) {
              totalPage = String(data.numberOfPages);
            }
          } catch {
            // ignore schema parse errors
          }
        });
      if (!totalPage) {
        const pagesText = this.text(
          doc.querySelector('p[data-testid="pagesFormat"]'),
        );
        if (pagesText) totalPage = pagesText.split(" ")[0];
      }
    }

    // Cover Image
    let coverUrl = apollo.coverUrl || "";
    if (!coverUrl) {
      coverUrl =
        doc.querySelector("img.ResponsiveImage")?.getAttribute("src") ||
        doc.querySelector("#coverImage")?.getAttribute("src") ||
        "";
      coverUrl = this.normalizeCoverUrl(coverUrl);
    }

    return {
      title,
      subtitle: "",
      author: authorString,
      authors: authors.length ? authors : [authorString],
      category,
      categories: category,
      publisher,
      publishDate,
      totalPage,
      coverUrl,
      coverSmallUrl: coverUrl,
      description,
      link,
      previewLink: link,
      isbn10,
      isbn13,
      originalTitle,
      translator,
      narrator: "",
      asin,
    };
  }
}
