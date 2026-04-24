import { Book } from "@models/book.model";
import { BaseBooksApiImpl } from "@apis/base_api";
import { requestUrl } from "obsidian";

interface CalibreLibraryInfo {
  tags: string[];
  series: Array<{ name: string; count: number }>;
  authors: string[];
}

export class CalibreApi implements BaseBooksApiImpl {
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

      const searchRes = await requestUrl({
        url: searchUrl,
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (searchRes.status !== 200) {
        throw new Error(`Calibre Server returned status ${searchRes.status}`);
      }

      const searchData = searchRes.json;
      // searchData.book_ids is a list of book IDs
      const bookIds: string[] = searchData.book_ids || [];

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
      const validLibraryId = this.libraryId || "calibre";

      // Get categories/tags
      const categoriesUrl = `${this.serverUrl}/ajax/categories/${validLibraryId}`;
      const categoriesRes = await requestUrl({
        url: categoriesUrl,
        method: "GET",
        headers: { Accept: "application/json" },
      });

      const categories = categoriesRes.json || [];

      // Parse out tags, series, authors from categories
      let tags: string[] = [];
      let series: Array<{ name: string; count: number }> = [];
      let authors: string[] = [];

      const [tagItems, seriesItems, authorItems] = await Promise.all([
        this.getCategoryItems("tags"),
        this.getCategoryItems("series"),
        this.getCategoryItems("authors"),
      ]);

      tags = tagItems.map((t: { name: string }) => t.name);
      series = seriesItems.map((s: { name: string; count?: number }) => ({
        name: s.name,
        count: s.count || 0,
      }));
      authors = authorItems.map((a: { name: string }) => a.name);

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

      const res = await requestUrl({
        url,
        method: "GET",
        headers: { Accept: "application/json" },
      });

      const data = res.json;
      // Calibre returns { items: [...], total_num: N }
      return data.items || [];
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
    const bookRes = await requestUrl({
      url: bookUrl,
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    const data = bookRes.json;

    // Remove trailing slash from serverUrl if present
    const cleanServerUrl = this.serverUrl.replace(/\/$/, "");
    const validLibraryId = this.libraryId || "calibre";

    // Try to find cover in data, or construct standard URL
    let coverUrl = "";
    if (data.cover) {
      coverUrl = data.cover;
      if (coverUrl.startsWith("/")) {
        coverUrl = `${cleanServerUrl}${coverUrl}`;
      }
    } else {
      coverUrl = `${cleanServerUrl}/get/cover/${id}/${validLibraryId}`;
    }

    // Map metadata
    const title = data.title;
    const authors = data.authors || [];
    const author = authors.join(", ");

    // Clean HTML from comments/description
    const rawDescription = data.comments || "";
    const description = rawDescription.replace(/<[^>]*>?/gm, "");

    // ISBN parsing
    const identifiers = data.identifiers || {};
    const isbn13 =
      identifiers["isbn13"] ||
      identifiers["isbn-13"] ||
      (identifiers["isbn"]?.length === 13 ? identifiers["isbn"] : "") ||
      "";
    const isbn10 =
      identifiers["isbn10"] ||
      identifiers["isbn-10"] ||
      (identifiers["isbn"]?.length === 10 ? identifiers["isbn"] : "") ||
      "";
    const ids = isbn13 || isbn10 || "";

    // Publisher and date
    const publisher = data.publisher || "";
    const publishDate = data.pubdate || "";

    // Published Date - Year only
    let publishedYear = "";
    if (publishDate) {
      try {
        const date = new Date(publishDate);
        if (!isNaN(date.getTime())) {
          publishedYear = date.getFullYear().toString();
        }
      } catch {
        console.warn("Failed to parse date", publishDate);
      }
    }

    // Series information
    const seriesInfo = data.series || null;
    const seriesIndex = data.series_index || null;

    let series = "";
    let seriesNumber: number | undefined;
    let seriesLink = "";

    if (seriesInfo) {
      series = seriesInfo;
      seriesLink = `[[${seriesInfo}]]`;
      if (seriesIndex !== null && seriesIndex !== undefined) {
        seriesNumber =
          typeof seriesIndex === "number"
            ? seriesIndex
            : parseFloat(seriesIndex);
      }
    }

    // Custom columns (if available)
    const customColumns: Record<string, unknown> = {};
    if (data.user_metadata) {
      for (const [key, value] of Object.entries(data.user_metadata)) {
        const colData = value as { "#value#"?: unknown; name?: string };
        if (colData && colData["#value#"] !== undefined) {
          customColumns[key] = colData["#value#"];
        }
      }
    }

    return {
      title,
      subtitle: "",
      author,
      authors,
      category: "",
      categories: (data.tags || []).join(", "),
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
