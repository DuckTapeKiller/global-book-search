import { Book } from "@models/book.model";
import { BaseBooksApiImpl } from "@apis/base_api";
import { requestUrl } from "obsidian";
import * as cheerio from "cheerio";

export class StoryGraphApi implements BaseBooksApiImpl {
  private readonly baseUrl = "https://app.thestorygraph.com";

  constructor() {}

  async getByQuery(query: string): Promise<Book[]> {
    const searchUrl = `${this.baseUrl}/browse?search_term=${encodeURIComponent(query)}`;
    try {
      const searchRes = await requestUrl({
        url: searchUrl,
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        },
      });

      const $ = cheerio.load(searchRes.text);
      const books: Book[] = [];

      // Detect if we got a login redirect instead of search results
      // Only treat as login if no book panes are found AND we see the explicit redirect message
      if (
        $(".book-pane").length === 0 &&
        $("[data-book-id]").length === 0 &&
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

      // Primary attempt
      $(".book-pane").each((_, el) => {
        const pane = $(el);
        const titleNode = pane.find(".book-title-author-and-series h3 a").first();
        const relativeLink = titleNode.attr("href");

        if (!relativeLink) return;

        const fullLink = relativeLink.startsWith("http")
          ? relativeLink
          : `${this.baseUrl}${relativeLink}`;

        const bookData = this.extractBookData($, pane, fullLink);
        if (bookData.title && bookData.title !== "Unknown Title") {
          bookData.sourceId = pane.attr("data-book-id");
          books.push(bookData);
        }
      });

      // If primary found nothing, try alternative selector
      if (books.length === 0) {
        $("[data-book-id]").each((_, el) => {
          const pane = $(el);
          const titleNode = pane.find("h3 a").first();
          const relativeLink = titleNode.attr("href");

          if (!relativeLink || !relativeLink.includes("/books/")) return;

          const fullLink = relativeLink.startsWith("http")
            ? relativeLink
            : `${this.baseUrl}${relativeLink}`;

          const bookData = this.extractBookData($, pane, fullLink);
          if (bookData.title && bookData.title !== "Unknown Title") {
            bookData.sourceId = pane.attr("data-book-id");
            books.push(bookData);
          }
        });
      }

      return books;
    } catch (error) {
      console.warn("StoryGraph getByQuery failed:", {
        url: searchUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getBook(book: Book): Promise<Book> {
    try {
      const editionsUrl = `${book.link}/editions`;
      const editionsRes = await requestUrl({
        url: editionsUrl,
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        },
      });

      const $ = cheerio.load(editionsRes.text);
      const allEditions = $(".book-pane");

      if (allEditions.length === 0) {
        return book;
      }

      let bestBook = book;
      let maxScore = -1;
      let exactMatchFound = false;

      allEditions.each((_, el) => {
        const pane = $(el);
        const id = pane.attr("data-book-id");
        const currentEdition = this.extractBookData($, pane, book.link);
        currentEdition.sourceId = id;

        // CRITICAL: If this is the EXACT edition ID the user selected, use it!
        if (id && book.sourceId && id === book.sourceId) {
          bestBook = currentEdition;
          exactMatchFound = true;
          return false; // Break loop
        }

        const score = this.calculateEditionScore(currentEdition);
        if (score > maxScore) {
          maxScore = score;
          bestBook = currentEdition;
        }
      });

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
      const res = await requestUrl({
        url: bookLink,
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        },
      });

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

  private extractBookData(
    $: cheerio.Root,
    pane: cheerio.Cheerio,
    link: string,
  ): Book {
    // Title, author, cover, summary come from desktopLayout
    const desktopLayout =
      pane.find(".hidden.md\\:block").length > 0
        ? pane.find(".hidden.md\\:block")
        : pane;

    const titleNode = desktopLayout
      .find(".book-title-author-and-series h3 a")
      .first();
    const title = titleNode.text().trim() || "Unknown Title";

    // ── Primary Author ──────────────────────────────────────────────────────
    const authors: string[] = [];
    desktopLayout.find(".book-title-author-and-series p.font-body > a").each((_, el) => {
      const a = $(el).text().trim();
      if (a && !authors.includes(a)) authors.push(a);
    });

    // ── Translator / Contributors ───────────────────────────────────────────
    let translator = "";
    // Check span.hidden.contributor-names (for search results)
    const contributorSpan = desktopLayout.find("span.hidden.contributor-names").first();
    if (contributorSpan.length > 0) {
      const rawContributor = contributorSpan.text().trim();
      translator = rawContributor.replace(/^with\s+/i, "").replace(/\s*\(Translator\)\s*$/i, "").trim();
    }
    // Check links directly (for /editions or details page)
    pane.find("span.hidden.contributor-names a").each((_, el) => {
      const name = $(el).text().trim();
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
    pane.find(".edition-info p").each((_, p) => {
      const text = $(p).text().trim();
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
      const paneText = pane.text();
      const isbnMatches = paneText.match(/\b(?:97[89])?\d{9}[\dX]\b/g);
      if (isbnMatches) {
        for (const m of isbnMatches) {
          const digits = m.replace(/[^0-9X]/gi, "");
          if (digits.length === 13) {
            isbn13 = digits;
            break;
          } else if (digits.length === 10 && !isbn10) {
            isbn10 = digits;
          }
        }
      }
    }

    // Pages from summary line (e.g. "498 pages • hardcover • 2015")
    if (!totalPage) {
      const summaryText = pane.find("p.text-xs.font-light").first().text();
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
      pane.find(sel).each((_, el) => {
        const cat = $(el).text().trim();
        if (cat && cat.length < 30) genreSet.add(cat);
      });
    });
    const categories = Array.from(genreSet).join(", ");

    // ── Cover ───────────────────────────────────────────────────────────────
    const coverWrapper = desktopLayout.find(".book-cover");
    const imgNode = coverWrapper.find("img");
    let coverUrl = imgNode.attr("src") || "";
    if (
      coverWrapper.hasClass("placeholder-cover") ||
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
      title,
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
