import { Book } from "@models/book.model";
import { BaseBooksApiImpl } from "@apis/base_api";
import { httpRequest } from "@utils/http";
import {
  asRecord,
  getArray,
  getNumber,
  getString,
  getStringArray,
  isRecord,
} from "@utils/json";

interface OpenLibraryEdition {
  isbn_10: string[];
  isbn_13: string[];
  isbn: string[];
  number_of_pages?: number;
  publish_date?: string;
  publishers: string[];
  description?: string | { value: string };
}

export class OpenLibraryApi implements BaseBooksApiImpl {
  static readonly API_VERSION = "2026-05-13";

  async getByQuery(query: string): Promise<Book[]> {
    try {
      // Use general search for better results: https://openlibrary.org/dev/docs/api/search
      const searchUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=20`;

      const searchRes = await httpRequest(
        {
          url: searchUrl,
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
        {
          providerId: "openlibrary",
          purpose: "search",
          responseType: "json",
          cacheTtlMs: 60_000,
        },
      );

      if (searchRes.status !== 200) {
        return [];
      }

      const results = asRecord(searchRes.json);
      return getArray(results.docs).map((doc) => this.mapResultToBook(doc));
    } catch (error) {
      console.warn("OpenLibrary search error", error);
      return [];
    }
  }

  async getBook(book: Book): Promise<Book> {
    try {
      if (!book.link) return book;

      // Extract the key from the link (e.g., /works/OL40456409W)
      const keyMatch = book.link.match(/\/(works|books|editions)\/OL\w+/);
      if (!keyMatch) return book;

      const key = keyMatch[0];

      if (key.startsWith("/works/")) {
        // Fetch editions of this work to get ISBN and pages
        const editionsUrl = `https://openlibrary.org${key}/editions.json?limit=5`;
        const editionsRes = await httpRequest(
          {
            url: editionsUrl,
            method: "GET",
            headers: { Accept: "application/json" },
          },
          {
            providerId: "openlibrary",
            purpose: "editions",
            responseType: "json",
            cacheTtlMs: 300_000,
          },
        );

        if (editionsRes.status === 200) {
          const data = asRecord(editionsRes.json);
          const entries = getArray(data.entries).map((e) => this.toEdition(e));
          const hasIsbn = (e: OpenLibraryEdition): boolean =>
            e.isbn_10.length > 0 || e.isbn_13.length > 0 || e.isbn.length > 0;
          // Find an edition with ISBN or pages
          const bestEdition =
            entries.find((e) => hasIsbn(e) && e.number_of_pages) ||
            entries.find((e) => hasIsbn(e)) ||
            entries[0];

          if (bestEdition) {
            // Update book with edition info
            book.isbn10 =
              bestEdition.isbn_10[0] ||
              bestEdition.isbn.find((id) => id.length === 10) ||
              book.isbn10;
            book.isbn13 =
              bestEdition.isbn_13[0] ||
              bestEdition.isbn.find((id) => id.length === 13) ||
              book.isbn13;
            book.totalPage = bestEdition.number_of_pages || book.totalPage;
            if (bestEdition.publish_date) {
              book.publishDate = bestEdition.publish_date;
            }
            if (bestEdition.publishers.length > 0) {
              book.publisher = bestEdition.publishers[0];
            }
            // Sometimes description is only in editions
            if (!book.description && bestEdition.description) {
              book.description =
                typeof bestEdition.description === "string"
                  ? bestEdition.description
                  : bestEdition.description.value || "";
            }
          }
        }
      } else {
        // Fetch specific book/edition detail
        const detailUrl = `https://openlibrary.org${key}.json`;
        const detailRes = await httpRequest(
          {
            url: detailUrl,
            method: "GET",
            headers: { Accept: "application/json" },
          },
          {
            providerId: "openlibrary",
            purpose: "detail",
            responseType: "json",
            cacheTtlMs: 300_000,
          },
        );

        if (detailRes.status === 200) {
          const detail = this.toEdition(detailRes.json);
          book.isbn10 = detail.isbn_10[0] || book.isbn10;
          book.isbn13 = detail.isbn_13[0] || book.isbn13;
          book.totalPage = detail.number_of_pages || book.totalPage;
          if (detail.publish_date) book.publishDate = detail.publish_date;
          if (detail.publishers[0]) book.publisher = detail.publishers[0];
          if (!book.description && detail.description) {
            book.description =
              typeof detail.description === "string"
                ? detail.description
                : detail.description.value || "";
          }
        }
      }

      return book;
    } catch (error) {
      console.warn("OpenLibrary enrichment error", error);
      return book;
    }
  }

  /** Normalise a raw edition/detail JSON object into a typed edition. */
  private toEdition(raw: unknown): OpenLibraryEdition {
    const r = asRecord(raw);
    const desc = r.description;
    return {
      isbn_10: getStringArray(r.isbn_10),
      isbn_13: getStringArray(r.isbn_13),
      isbn: getStringArray(r.isbn),
      number_of_pages: getNumber(r.number_of_pages),
      publish_date: getString(r.publish_date) || undefined,
      publishers: getStringArray(r.publishers),
      description:
        typeof desc === "string"
          ? desc
          : isRecord(desc)
            ? { value: getString(desc.value) }
            : undefined,
    };
  }

  private mapResultToBook(raw: unknown): Book {
    const doc = asRecord(raw);
    const title = getString(doc.title);
    const authors = getStringArray(doc.author_name);
    const author = authors[0] || "";
    const isbns = getStringArray(doc.isbn);

    // Cover Image
    const coverId = getNumber(doc.cover_i);
    let coverUrl = "";
    if (coverId) {
      coverUrl = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
    } else if (isbns[0]) {
      coverUrl = `https://covers.openlibrary.org/b/isbn/${isbns[0]}-L.jpg`;
    }

    // Publish Date - OpenLibrary gives multiple, pick first valid
    const firstPublishYear = getNumber(doc.first_publish_year);
    const publishDates = getStringArray(doc.publish_date);
    const publishDate = firstPublishYear
      ? firstPublishYear.toString()
      : publishDates[0] || "";

    // Publisher
    const publisher = getStringArray(doc.publisher)[0] || "";

    // ISBN
    const isbn10 = isbns.find((id) => id.length === 10) || "";
    const isbn13 = isbns.find((id) => id.length === 13) || "";

    // Pages
    const totalPage: number | string =
      getNumber(doc.number_of_pages_median) ??
      getNumber(doc.number_of_pages) ??
      "";

    // Link
    const key = getString(doc.key);
    const link = key ? `https://openlibrary.org${key}` : "";

    const subjects = getStringArray(doc.subject);

    return {
      title,
      author,
      authors,
      coverUrl,
      coverSmallUrl: coverUrl, // OpenLibrary covers are usually high enough res or scalable
      publishDate,
      publisher,
      isbn10,
      isbn13,
      totalPage,
      link,
      previewLink: link,
      description: "", // Search API doesn't always return full description
      categories: subjects.join(", "),
      category: subjects[0] || "",
      asin: "", // OpenLibrary doesn't use ASIN usually
      originalTitle: getString(doc.original_title),
      translator: "",
      tags: [], // Initialize tags empty, main.ts populates them
    };
  }
}
