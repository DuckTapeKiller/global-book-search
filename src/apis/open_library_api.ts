import { Book } from "@models/book.model";
import { BaseBooksApiImpl } from "@apis/base_api";
import { requestUrl } from "obsidian";

interface OpenLibraryDoc {
  title: string;
  author_name?: string[];
  cover_i?: number;
  isbn?: string[];
  first_publish_year?: number;
  publish_date?: string[];
  publisher?: string[];
  number_of_pages_median?: number;
  number_of_pages?: number;
  key?: string;
  subject?: string[];
  original_title?: string;
}

interface OpenLibraryEdition {
  isbn_10?: string[];
  isbn_13?: string[];
  isbn?: string[];
  number_of_pages?: number;
  publish_date?: string;
  publishers?: string[];
  description?: string | { value: string };
}

export class OpenLibraryApi implements BaseBooksApiImpl {
  async getByQuery(query: string): Promise<Book[]> {
    try {
      // Use general search for better results: https://openlibrary.org/dev/docs/api/search
      const searchUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=20`;

      const searchRes = await requestUrl({
        url: searchUrl,
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (searchRes.status !== 200) {
        return [];
      }

      const results = searchRes.json;
      if (!results.docs || !Array.isArray(results.docs)) {
        return [];
      }

      return results.docs.map((doc: OpenLibraryDoc) =>
        this.mapResultToBook(doc),
      );
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
        const editionsRes = await requestUrl({
          url: editionsUrl,
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (editionsRes.status === 200 && editionsRes.json.entries) {
          const entries = editionsRes.json.entries;
          // Find an edition with ISBN or pages
          const bestEdition =
            entries.find(
              (e: OpenLibraryEdition) =>
                (e.isbn_10 || e.isbn_13 || e.isbn) && e.number_of_pages,
            ) ||
            entries.find(
              (e: OpenLibraryEdition) => e.isbn_10 || e.isbn_13 || e.isbn,
            ) ||
            entries[0];

          if (bestEdition) {
            // Update book with edition info
            book.isbn10 =
              bestEdition.isbn_10?.[0] ||
              (Array.isArray(bestEdition.isbn)
                ? bestEdition.isbn.find((id: string) => id.length === 10)
                : "") ||
              book.isbn10;
            book.isbn13 =
              bestEdition.isbn_13?.[0] ||
              (Array.isArray(bestEdition.isbn)
                ? bestEdition.isbn.find((id: string) => id.length === 13)
                : "") ||
              book.isbn13;
            book.totalPage = bestEdition.number_of_pages || book.totalPage;
            if (bestEdition.publish_date) {
              book.publishDate = bestEdition.publish_date;
            }
            if (bestEdition.publishers && bestEdition.publishers.length > 0) {
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
        const detailRes = await requestUrl({
          url: detailUrl,
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (detailRes.status === 200) {
          const detail = detailRes.json;
          book.isbn10 = detail.isbn_10?.[0] || book.isbn10;
          book.isbn13 = detail.isbn_13?.[0] || book.isbn13;
          book.totalPage = detail.number_of_pages || book.totalPage;
          if (detail.publish_date) book.publishDate = detail.publish_date;
          if (detail.publishers?.[0]) book.publisher = detail.publishers[0];
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

  private mapResultToBook(doc: OpenLibraryDoc): Book {
    const title = doc.title || "";
    const author = doc.author_name ? doc.author_name[0] : "";
    const authors = doc.author_name || [];

    // Cover Image
    let coverUrl = "";
    if (doc.cover_i) {
      coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
    } else if (doc.isbn && doc.isbn[0]) {
      coverUrl = `https://covers.openlibrary.org/b/isbn/${doc.isbn[0]}-L.jpg`;
    }

    // Publish Date - OpenLibrary gives multiple, pick first valid
    let publishDate = "";
    if (doc.first_publish_year) {
      publishDate = doc.first_publish_year.toString();
    } else if (doc.publish_date && doc.publish_date.length > 0) {
      publishDate = doc.publish_date[0];
    }

    // Publisher
    const publisher = doc.publisher ? doc.publisher[0] : "";

    // ISBN
    const isbn10 =
      (doc.isbn || []).find((id: string) => id.length === 10) || "";
    const isbn13 =
      (doc.isbn || []).find((id: string) => id.length === 13) || "";

    // Pages
    const totalPage =
      doc.number_of_pages_median ||
      (doc.number_of_pages ? doc.number_of_pages : "");

    // Link
    const key = doc.key;
    const link = key ? `https://openlibrary.org${key}` : "";

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
      categories: doc.subject?.join(", ") || "",
      category: doc.subject ? doc.subject[0] : "",
      asin: "", // OpenLibrary doesn't use ASIN usually
      originalTitle: doc.original_title || "",
      translator: "",
      tags: [], // Initialize tags empty, main.ts populates them
    };
  }
}
