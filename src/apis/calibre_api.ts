import { Book } from "@models/book.model";
import { BaseBooksApiImpl } from "@apis/base_api";
import { httpRequest } from "@utils/http";
import {
  asRecord,
  getArray,
  getNumber,
  getString,
  getStringArray,
} from "@utils/json";

interface CalibreLibraryInfo {
  tags: string[];
  series: Array<{ name: string; count: number }>;
  authors: string[];
}

export class CalibreApi implements BaseBooksApiImpl {
  static readonly API_VERSION = "2026-05-13";

  constructor(
    private readonly serverUrl: string,
    private readonly libraryId: string = "calibre",
  ) {}

  async getByQuery(query: string): Promise<Book[]> {
    try {
      // Use Calibre's AJAX search endpoint
      // GET /ajax/search?query={query}
      const validLibraryId = encodeURIComponent(this.libraryId || "calibre");
      const searchUrl = `${this.serverUrl}/ajax/search?query=${encodeURIComponent(query)}&library_id=${validLibraryId}`;

      const searchRes = await httpRequest(
        {
          url: searchUrl,
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
        {
          providerId: "calibre",
          purpose: "search",
          responseType: "json",
          cacheTtlMs: 30_000,
        },
      );

      if (searchRes.status !== 200) {
        throw new Error(`Calibre Server returned status ${searchRes.status}`);
      }

      const searchData = asRecord(searchRes.json);
      // searchData.book_ids is a list of book IDs (numbers in the JSON).
      const bookIds: string[] = getArray(searchData.book_ids)
        .filter(
          (v): v is number | string =>
            typeof v === "number" || typeof v === "string",
        )
        .map((v) => String(v));

      // Limit results to avoid overwhelming requests
      const topBookIds = bookIds.slice(0, 20);

      const results = await Promise.allSettled(
        topBookIds.map((id) => this.getBookDetails(id)),
      );
      const books = results
        .filter(
          (r): r is PromiseFulfilledResult<Book> => r.status === "fulfilled",
        )
        .map((r) => r.value);

      return books;
    } catch (error) {
      console.warn("Calibre search error", error);
      throw error;
    }
  }

  /**
   * Get library metadata including tags, series, and authors
   */
  async getLibraryInfo(): Promise<CalibreLibraryInfo> {
    try {
      // The per-category endpoints below provide the structured
      // tag/series/author data we need.
      const [tagItems, seriesItems, authorItems] = await Promise.all([
        this.getCategoryItems("tags"),
        this.getCategoryItems("series"),
        this.getCategoryItems("authors"),
      ]);

      const tags = tagItems.map((t) => t.name);
      const series = seriesItems.map((s) => ({
        name: s.name,
        count: s.count ?? 0,
      }));
      const authors = authorItems.map((a) => a.name);

      return { tags, series, authors };
    } catch (error) {
      console.warn("Failed to get library info", error);
      return { tags: [], series: [], authors: [] };
    }
  }

  /**
   * Get items for a specific category (tags, series, authors)
   */
  private async getCategoryItems(
    category: string,
  ): Promise<Array<{ name: string; count?: number }>> {
    try {
      const validLibraryId = this.libraryId || "calibre";
      const url = `${this.serverUrl}/ajax/category/${category}/${validLibraryId}`;

      const res = await httpRequest(
        {
          url,
          method: "GET",
          headers: { Accept: "application/json" },
        },
        {
          providerId: "calibre",
          purpose: `category:${category}`,
          responseType: "json",
          cacheTtlMs: 60_000,
        },
      );

      // Calibre returns { items: [...], total_num: N }
      const data = asRecord(res.json);
      const items: Array<{ name: string; count?: number }> = [];
      for (const item of getArray(data.items)) {
        const rec = asRecord(item);
        const name = getString(rec.name);
        if (name) items.push({ name, count: getNumber(rec.count) });
      }
      return items;
    } catch (error) {
      console.warn(`Failed to get ${category} items`, error);
      return [];
    }
  }

  /**
   * Get books filtered by tag, series, or author
   */
  async getBooksByFilter(
    filterType: "tags" | "series" | "authors",
    filterValue: string,
  ): Promise<Book[]> {
    try {
      // Build search query based on filter type
      let query = "";
      switch (filterType) {
        case "tags":
          query = `tags:"=${filterValue}"`;
          break;
        case "series":
          query = `series:"=${filterValue}"`;
          break;
        case "authors":
          query = `authors:"=${filterValue}"`;
          break;
      }

      return await this.getByQuery(query);
    } catch (error) {
      console.warn("Failed to get books by filter", error);
      throw error;
    }
  }

  /**
   * Get all books in a specific series
   */
  async getBooksBySeries(seriesName: string): Promise<Book[]> {
    return this.getBooksByFilter("series", seriesName);
  }

  async getBook(book: Book): Promise<Book> {
    if (!book.sourceId) return book;
    return this.getBookDetails(book.sourceId);
  }

  private async getBookDetails(id: string): Promise<Book> {
    // GET /ajax/book/{id}
    const bookUrl = `${this.serverUrl}/ajax/book/${id}`;
    const bookRes = await httpRequest(
      {
        url: bookUrl,
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
      {
        providerId: "calibre",
        purpose: "book",
        responseType: "json",
        cacheTtlMs: 30_000,
      },
    );

    const data = asRecord(bookRes.json);

    // Remove trailing slash from serverUrl if present
    const cleanServerUrl = this.serverUrl.replace(/\/$/, "");
    const validLibraryId = this.libraryId || "calibre";

    // Try to find cover in data, or construct standard URL
    let coverUrl = getString(data.cover);
    if (coverUrl) {
      if (coverUrl.startsWith("/")) {
        coverUrl = `${cleanServerUrl}${coverUrl}`;
      }
    } else {
      coverUrl = `${cleanServerUrl}/get/cover/${id}/${validLibraryId}`;
    }

    // Map metadata
    const title = getString(data.title);
    const authors = getStringArray(data.authors);
    const author = authors.join(", ");

    // Clean HTML from comments/description
    const description = getString(data.comments).replace(/<[^>]*>?/gm, "");

    // ISBN parsing
    const identifiers = asRecord(data.identifiers);
    const isbnAny = getString(identifiers["isbn"]);
    const isbn13 =
      getString(identifiers["isbn13"]) ||
      getString(identifiers["isbn-13"]) ||
      (isbnAny.length === 13 ? isbnAny : "");
    const isbn10 =
      getString(identifiers["isbn10"]) ||
      getString(identifiers["isbn-10"]) ||
      (isbnAny.length === 10 ? isbnAny : "");
    const ids = isbn13 || isbn10 || "";

    // Publisher and date
    const publisher = getString(data.publisher);
    const publishDate = getString(data.pubdate);

    // Published Date - Year only
    let publishedYear = "";
    if (publishDate) {
      const date = new Date(publishDate);
      if (!isNaN(date.getTime())) {
        publishedYear = date.getFullYear().toString();
      }
    }

    // Series information
    const seriesInfo = getString(data.series);
    const seriesIndexRaw = data.series_index;

    let series = "";
    let seriesNumber: number | undefined;
    let seriesLink = "";

    if (seriesInfo) {
      series = seriesInfo;
      seriesLink = `[[${seriesInfo}]]`;
      if (typeof seriesIndexRaw === "number") {
        seriesNumber = seriesIndexRaw;
      } else if (typeof seriesIndexRaw === "string") {
        seriesNumber = parseFloat(seriesIndexRaw);
      }
    }

    // Custom columns (if available)
    const customColumns: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(asRecord(data.user_metadata))) {
      const colData = asRecord(value);
      if (colData["#value#"] !== undefined) {
        customColumns[key] = colData["#value#"];
      }
    }

    return {
      title,
      subtitle: "",
      author,
      authors,
      category: "",
      categories: getStringArray(data.tags).join(", "),
      publisher,
      publishDate: publishedYear,
      totalPage: "",
      coverUrl,
      coverSmallUrl: coverUrl,
      description,
      link: bookUrl,
      previewLink: bookUrl,
      isbn10,
      isbn13,
      ids: ids,
      originalTitle: "",
      translator: "",
      narrator: "",
      // New fields
      series,
      seriesNumber,
      seriesLink,
      customColumns,
      sourceProvider: "calibre",
      sourceId: id,
    };
  }
}
