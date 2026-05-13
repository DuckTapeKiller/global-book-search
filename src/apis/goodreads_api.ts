import { Book } from "@models/book.model";
import { BaseBooksApiImpl } from "@apis/base_api";
import { getHttpConfig, httpRequest } from "@utils/http";

export class GoodreadsApi implements BaseBooksApiImpl {
  static readonly SCRAPER_VERSION = "2026-05-13";

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
    const details = (
      this.isRecord(bookJson["details"]) ? bookJson["details"] : {}
    ) as Record<string, unknown>;

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
        { id: "autocompleteJson", run: () => this.getByAutocomplete(query) },
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
            : (bookIdRaw as string | undefined);
        if (!bookId) continue;

        const title = String(obj.title || "")
          .trim()
          .replace(/"/g, "'");
        if (!title) continue;

        const authorObj = obj.author as unknown;
        const authorName =
          (authorObj && typeof authorObj === "object"
            ? String((authorObj as { name?: unknown }).name || "")
            : "") ||
          String(obj.authorName || obj.author_name || obj.author || "")
            .trim()
            .replace(/\s+/g, " ");

        const link =
          (typeof obj.url === "string" && obj.url.startsWith("http")
            ? obj.url
            : "") || `https://www.goodreads.com/book/show/${bookId}`;

        if (seen.has(link)) continue;
        seen.add(link);

        const coverUrl =
          String(
            obj.imageUrl ||
              obj.image_url ||
              obj.bookImageUrl ||
              obj.book_image_url ||
              obj.book_small_image_url ||
              "",
          ) || "";

        books.push({
          title,
          author: authorName,
          authors: authorName ? [authorName] : [],
          link,
          previewLink: link,
          coverUrl: this.normalizeCoverUrl(coverUrl),
          coverSmallUrl: coverUrl,
          description: "",
          publisher: "",
          publishDate: "",
          totalPage: obj.numPages ? String(obj.numPages) : "",
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

  async getBook(book: Book): Promise<Book> {
    try {
      const bookRes = await httpRequest(
        {
          url: book.link,
          method: "GET",
          headers: {
            "User-Agent": this.userAgent,
          },
        },
        { providerId: "goodreads", purpose: "book" },
      );

      const doc = this.parseHtml(bookRes.text);
      return this.extractBook(doc, book.link);
    } catch (error) {
      console.warn("Goodreads getBook error", error);
      return book;
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
            if (data["@type"] === "Book" && data.numberOfPages) {
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
