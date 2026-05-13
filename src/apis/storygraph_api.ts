import { Book } from "@models/book.model";
import { BaseBooksApiImpl } from "@apis/base_api";
import { getHttpConfig, httpRequest } from "@utils/http";

export class StoryGraphApi implements BaseBooksApiImpl {
  static readonly SCRAPER_VERSION = "2026-05-13";

  private readonly baseUrl = "https://app.thestorygraph.com";

  constructor() {}

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
        {
          url: searchUrl,
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
          },
        },
        { providerId: "storygraph", purpose: "search" },
      );

      const doc = this.parseHtml(searchRes.text);
      const books: Book[] = [];

      // Detect if we got a login redirect instead of search results
      // Only treat as login if no book panes are found AND we see the explicit redirect message
      if (
        doc.querySelectorAll(".book-pane").length === 0 &&
        doc.querySelectorAll("[data-book-id]").length === 0 &&
        (searchRes.text.includes("You need to sign in") ||
          searchRes.text.includes("You are being redirected") ||
          searchRes.text.includes("<title>Sign In"))
      ) {
        console.warn(
          "StoryGraph: search requires authentication. " +
            "Please ensure you are logged in or try a different service.",
        );
        return [];
      }

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
      console.warn("StoryGraph getByQuery failed:", {
        url: searchUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async getBook(book: Book): Promise<Book> {
    try {
      const editionsUrl = `${book.link}/editions`;
      const editionsRes = await httpRequest(
        {
          url: editionsUrl,
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
          },
        },
        { providerId: "storygraph", purpose: "editions" },
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
      console.warn("StoryGraph getBook error", error);
      return book;
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
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
          },
        },
        { providerId: "storygraph", purpose: "book-fallback" },
      );

      const html: string = res.text;
      if (!html) return { isbn10, isbn13 };

      // Try JSON-LD structured data
      const jsonLdMatches = html.matchAll(
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
      );
      for (const match of jsonLdMatches) {
        try {
          const data = JSON.parse(match[1]);
          const entries = Array.isArray(data) ? data : [data];
          for (const entry of entries) {
            const rawIsbn =
              entry?.isbn ||
              entry?.isbn13 ||
              entry?.isbn10 ||
              entry?.["@graph"]?.[0]?.isbn;
            if (rawIsbn) {
              const digits = String(rawIsbn).replace(/[^0-9X]/gi, "");
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
      console.warn("StoryGraph fetchIsbnFromBookPage failed:", err);
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

    // ── Translator / Contributors ───────────────────────────────────────────
    let translator = "";
    // Check span.hidden.contributor-names (for search results)
    const contributorSpan = desktopLayout.querySelector(
      "span.hidden.contributor-names",
    );
    if (contributorSpan) {
      const rawContributor = this.text(contributorSpan);
      translator = rawContributor
        .replace(/^with\s+/i, "")
        .replace(/\s*\(Translator\)\s*$/i, "")
        .trim();
    }
    // Check links directly (for /editions or details page)
    paneEl.querySelectorAll("span.hidden.contributor-names a").forEach((el) => {
      const name = this.text(el);
      if (name && !authors.includes(name)) {
        translator = name;
      }
    });

    // ── Edition metadata ────────────────────────────────────────────────────
    let isbn10 = "";
    let isbn13 = "";
    let publisher = "";
    let publishDate = "";
    let totalPage = "";

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
        publisher = value;
      } else if (
        key.includes("edition pub date") ||
        key.includes("edition published") ||
        key.includes("pub date")
      ) {
        publishDate = value;
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

    // Genre/Categories from tags
    const genreSet = new Set<string>();
    const genreSelectors = [
      ".book-pane-tag-section span.inline-block",
      ".book-pane-tag-section a",
      "span.inline-block.book-pane-tag",
    ];
    genreSelectors.forEach((sel) => {
      paneEl.querySelectorAll(sel).forEach((el) => {
        const cat = this.text(el);
        if (cat && cat.length < 30) genreSet.add(cat);
      });
    });
    const categories = Array.from(genreSet).join(", ");

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
    } as Book;
  }
}
