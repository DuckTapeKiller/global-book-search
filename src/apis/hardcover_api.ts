import { Book } from "@models/book.model";
import { BaseBooksApiImpl } from "@apis/base_api";
import { httpRequest } from "@utils/http";
import {
  asRecord,
  getArray,
  getNumber,
  getPath,
  getString,
  getStringArray,
} from "@utils/json";

const HARDCOVER_GRAPHQL = "https://api.hardcover.app/v1/graphql";

// Diagnostic: runs the real queries with the user's own token (which never
// leaves their machine) and reports the API's responses/errors. GraphQL errors
// name the exact bad fields, so the user can paste the report (no token in it)
// and the queries can be corrected precisely.
export async function probeHardcover(apiToken: string): Promise<string> {
  const token = (apiToken || "").trim();
  if (!token) return "No Hardcover token set (Settings → Hardcover).";
  const auth = token.toLowerCase().startsWith("bearer ")
    ? token
    : `Bearer ${token}`;

  const call = async (
    label: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<string> => {
    try {
      const res = await httpRequest(
        {
          url: HARDCOVER_GRAPHQL,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: auth,
          },
          body: JSON.stringify({ query, variables }),
        },
        { providerId: "hardcover", purpose: "probe", responseType: "json" },
      );
      const json = asRecord(res.json);
      const errors = getArray(json.errors);
      if (errors.length) {
        const msg = errors
          .map((e) => getString(getPath(e, ["message"])))
          .join(" | ");
        return `${label}: ERROR — ${msg}`;
      }
      const data = JSON.stringify(json.data ?? {});
      return `${label}: OK — ${data.slice(0, 240)}`;
    } catch (err) {
      return `${label}: request failed — ${String(err)}`;
    }
  };

  const lines: string[] = [];
  lines.push(await call("me", "query { me { username } }", {}));
  lines.push(
    await call(
      "search",
      `query S($q: String!) { search(query: $q, query_type: "Book", per_page: 3, page: 1) { results } }`,
      { q: "farewell to arms" },
    ),
  );
  lines.push(
    await call(
      "book+editions",
      `query B($id: Int!) { books(where: { id: { _eq: $id } }, limit: 1) { title pages release_year contributions { author { name } } image { url } editions(limit: 2) { isbn_13 isbn_10 pages publisher { name } } } }`,
      { id: 1 },
    ),
  );
  return lines.join("\n\n");
}

// Hardcover (https://hardcover.app) sits behind Cloudflare's JS challenge, so
// its pages can't be scraped from Obsidian. Its GraphQL API, however, is
// directly reachable and just needs a personal Bearer token (Account → API).
// This provider is therefore token-gated: with no token it returns nothing.
export class HardcoverApi implements BaseBooksApiImpl {
  // 2-letter reader language to prefer, or "" for English/no localisation.
  private readonly localeCode2: string;

  constructor(
    private readonly apiToken: string,
    locale = "en",
  ) {
    const code = (locale || "en").slice(0, 2).toLowerCase();
    this.localeCode2 = /^[a-z]{2}$/.test(code) && code !== "en" ? code : "";
  }

  private get token(): string {
    return (this.apiToken || "").trim();
  }

  private authHeader(): string {
    const t = this.token;
    return t.toLowerCase().startsWith("bearer ") ? t : `Bearer ${t}`;
  }

  private async graphql(
    query: string,
    variables: Record<string, unknown>,
    purpose: string,
  ): Promise<unknown> {
    const res = await httpRequest(
      {
        url: HARDCOVER_GRAPHQL,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "obsidian-global-book-search",
          Authorization: this.authHeader(),
        },
        body: JSON.stringify({ query, variables }),
      },
      { providerId: "hardcover", purpose, responseType: "json" },
    );
    return res.json;
  }

  private coverUrl(image: unknown): string {
    if (typeof image === "string") return image;
    return getString(getPath(image, ["url"]));
  }

  private pickIsbns(values: string[]): { isbn10: string; isbn13: string } {
    let isbn10 = "";
    let isbn13 = "";
    for (const raw of values) {
      const digits = raw.replace(/[^0-9X]/gi, "");
      if (digits.length === 13 && !isbn13) isbn13 = digits;
      else if (digits.length === 10 && !isbn10) isbn10 = digits;
    }
    return { isbn10, isbn13 };
  }

  async getByQuery(query: string): Promise<Book[]> {
    if (!this.token) return [];
    try {
      const json = await this.graphql(
        `query SearchBooks($query: String!) {
          search(query: $query, query_type: "Book", per_page: 20, page: 1) {
            results
          }
        }`,
        { query },
        "search",
      );

      const hits = getArray(
        getPath(json, ["data", "search", "results", "hits"]),
      );
      const books: Book[] = [];
      for (const hit of hits) {
        const doc = asRecord(getPath(hit, ["document"]));
        const title = getString(doc.title);
        if (!title) continue;

        const authors = getStringArray(doc.author_names);
        const genres = getStringArray(doc.genres);
        const isbns = getStringArray(doc.isbns);
        const { isbn10, isbn13 } = this.pickIsbns(isbns);
        const slug = getString(doc.slug);
        // The Typesense search document's `id` can be a string; fall back so
        // the book id (and therefore getBook enrichment) isn't lost.
        const idNum = getNumber(doc.id);
        const bookId = idNum !== undefined ? String(idNum) : getString(doc.id);
        const year = getNumber(doc.release_year);
        const pages = getNumber(doc.pages);
        const cover = this.coverUrl(doc.image);
        const link = slug ? `https://hardcover.app/books/${slug}` : "";

        books.push({
          title,
          author: authors[0] || "",
          authors,
          coverUrl: cover,
          coverSmallUrl: cover,
          description: getString(doc.description),
          publisher: "",
          publishDate: year ? String(year) : "",
          totalPage: pages ? String(pages) : "",
          categories: genres.join(", "),
          category: genres[0] || "",
          isbn10,
          isbn13,
          asin: "",
          originalTitle: "",
          translator: "",
          narrator: "",
          subtitle: "",
          link,
          previewLink: link,
          sourceProvider: "hardcover",
          sourceId: bookId,
        });
      }
      return books;
    } catch (error) {
      console.warn("Hardcover search error", error);
      return [];
    }
  }

  async getBook(book: Book): Promise<Book> {
    if (!this.token || !book.sourceId) return book;
    const id = Number(book.sourceId);
    if (!Number.isFinite(id)) return book;

    // When the reader isn't English, also fetch the best edition in their
    // language so the note shows e.g. "El proceso", not "The Trial".
    const localize = this.localeCode2
      ? `localized: editions(
            where: { language: { code2: { _eq: $lang } }, title: { _is_null: false } }
            order_by: { users_count: desc_nulls_last }
            limit: 5
          ) {
            title subtitle pages isbn_10 isbn_13
            publisher { name }
            image { url }
          }`
      : "";

    try {
      const json = await this.graphql(
        `query BookEditions($id: Int!${this.localeCode2 ? ", $lang: String!" : ""}) {
          books(where: { id: { _eq: $id } }, limit: 1) {
            id
            description
            pages
            editions(limit: 15, order_by: { users_count: desc_nulls_last }) {
              isbn_10
              isbn_13
              asin
              pages
              edition_format
              release_date
              publisher { name }
              image { url }
            }
            ${localize}
          }
        }`,
        this.localeCode2 ? { id, lang: this.localeCode2 } : { id },
        "book",
      );

      const books = getArray(getPath(json, ["data", "books"]));
      if (books.length === 0) return book;
      const bookNode = asRecord(books[0]);

      const editions = getArray(bookNode.editions).map((e) => asRecord(e));
      const hasIsbn = (e: Record<string, unknown>): boolean =>
        !!getString(e.isbn_13) || !!getString(e.isbn_10);
      const best =
        editions.find((e) => hasIsbn(e) && getNumber(e.pages)) ||
        editions.find((e) => hasIsbn(e)) ||
        editions[0] ||
        {};

      const isbn13 = getString(best.isbn_13);
      const isbn10 = getString(best.isbn_10);
      const asin = getString(best.asin);
      const publisher = getString(getPath(best, ["publisher", "name"]));
      const pages = getNumber(best.pages) ?? getNumber(bookNode.pages);
      const cover = this.coverUrl(best.image);
      const description = getString(bookNode.description);

      const result: Book = {
        ...book,
        isbn13: isbn13 || book.isbn13,
        isbn10: isbn10 || book.isbn10,
        asin: asin || book.asin,
        publisher: publisher || book.publisher,
        totalPage: pages ? String(pages) : book.totalPage,
        coverUrl: book.coverUrl || cover,
        coverSmallUrl: book.coverSmallUrl || cover,
        description: book.description || description,
      };

      // Localised edition wins for the display fields (title, pages, publisher,
      // ISBN, cover) so the note is in the reader's language.
      const localized = getArray(bookNode.localized).map((e) => asRecord(e));
      const loc =
        localized.find(
          (e) =>
            getString(e.title) &&
            getNumber(e.pages) &&
            hasIsbn(e) &&
            getString(getPath(e, ["publisher", "name"])),
        ) ||
        localized.find((e) => getString(e.title) && hasIsbn(e)) ||
        localized.find((e) => getString(e.title)) ||
        null;
      if (loc) {
        const locCover = this.coverUrl(loc.image);
        result.title = getString(loc.title) || result.title;
        const locPages = getNumber(loc.pages);
        if (locPages) result.totalPage = String(locPages);
        result.publisher =
          getString(getPath(loc, ["publisher", "name"])) || result.publisher;
        result.isbn13 = getString(loc.isbn_13) || result.isbn13;
        result.isbn10 = getString(loc.isbn_10) || result.isbn10;
        if (getString(loc.subtitle)) result.subtitle = getString(loc.subtitle);
        if (locCover) {
          result.coverUrl = locCover;
          result.coverSmallUrl = locCover;
        }
      }

      return result;
    } catch (error) {
      console.warn("Hardcover getBook error", error);
      return book;
    }
  }
}
