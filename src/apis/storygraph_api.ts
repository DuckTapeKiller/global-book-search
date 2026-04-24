import { Book } from "@models/book.model";
import { BaseBooksApiImpl } from "@apis/base_api";
import { requestUrl } from "obsidian";
import * as cheerio from "cheerio";

export class StoryGraphApi implements BaseBooksApiImpl {
  private readonly baseUrl = "https://app.thestorygraph.com";

  constructor() {}

  async getByQuery(query: string): Promise<Book[]> {
    try {
      const searchUrl = `${this.baseUrl}/browse?search_term=${encodeURIComponent(query)}`;
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

      $(".book-pane").each((_, el) => {
        const pane = $(el);
        // Scope to desktop layout to avoid duplicates if present
        const desktopLayout =
          pane.find(".hidden.md\\:block").length > 0
            ? pane.find(".hidden.md\\:block")
            : pane;

        const titleNode = desktopLayout
          .find(".book-title-author-and-series h3 a")
          .first();
        const title = titleNode.text().trim();
        const relativeLink = titleNode.attr("href");

        if (!title || !relativeLink) return;

        const author = desktopLayout
          .find(".book-title-author-and-series p.font-body > a")
          .first()
          .text()
          .trim();
        const coverUrl = desktopLayout.find(".book-cover img").attr("src");
        const id = pane.attr("data-book-id");

        const fullLink = relativeLink.startsWith("http")
          ? relativeLink
          : `${this.baseUrl}${relativeLink}`;

        books.push({
          title,
          author,
          authors: [author],
          link: fullLink,
          previewLink: fullLink,
          coverUrl: coverUrl || "",
          coverSmallUrl: coverUrl || "",
          sourceId: id,
        } as Book);
      });

      return books;
    } catch (error) {
      console.warn("StoryGraph search error", error);
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

      allEditions.each((_, el) => {
        const pane = $(el);
        const currentEdition = this.extractBookData($, pane, book.link);
        const score = this.calculateEditionScore(currentEdition);

        if (score > maxScore) {
          maxScore = score;
          bestBook = currentEdition;
        }
      });

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

  private extractBookData(
    $: cheerio.Root,
    pane: cheerio.Cheerio,
    link: string,
  ): Book {
    // Scope to desktop layout as requested
    const desktopLayout =
      pane.find(".hidden.md\\:block").length > 0
        ? pane.find(".hidden.md\\:block")
        : pane;

    const titleNode = desktopLayout
      .find(".book-title-author-and-series h3 a")
      .first();
    const title = titleNode.text().trim() || "Unknown Title";

    const primaryAuthor = desktopLayout
      .find(".book-title-author-and-series p.font-body > a")
      .first()
      .text()
      .trim();

    // Contributors / Translators
    const contributorNames = desktopLayout
      .find("span.contributor-names")
      .text()
      .trim();
    let translator = "";
    if (contributorNames) {
      // Logic to strip "with" and potentially separate names
      translator = contributorNames.replace(/^with\s+/i, "").trim();
    }

    // Genres / Tags (Issue 1 fix)
    const genres: string[] = [];
    desktopLayout
      .find(".book-pane-tag-section span.inline-block")
      .each((_, el) => {
        const tag = $(el).text().trim();
        if (tag) genres.push(tag);
      });
    const categories = genres.join(", ");

    // Summary Line (Pages, Format, Year)
    const summaryText = desktopLayout
      .find("p.text-xs.font-light")
      .text()
      .trim();
    let totalPage = "";
    let publishDate = "";

    if (summaryText) {
      const parts = summaryText.split("•").map((p) => p.trim());
      parts.forEach((part) => {
        const pageMatch = part.match(/(\d+)\s*pages/i);
        if (pageMatch) {
          totalPage = pageMatch[1];
        } else if (/^\d{4}$/.test(part)) {
          publishDate = part;
        }
      });
    }

    // Detailed Edition Metadata
    let isbn10 = "";
    let isbn13 = "";
    let publisher = "";
    let language = "";

    desktopLayout.find(".edition-info p").each((_, el) => {
      const text = $(el).text();
      const splitIndex = text.indexOf(":");
      if (splitIndex !== -1) {
        const key = text.substring(0, splitIndex).trim().toLowerCase();
        const value = text.substring(splitIndex + 1).trim();

        if (value !== "None" && value !== "Not specified") {
          if (key.includes("isbn")) {
            if (value.length === 10) isbn10 = value;
            else if (value.length === 13) isbn13 = value;
            // else: discard malformed identifiers
          } else if (key.includes("publisher")) {
            publisher = value;
          } else if (key.includes("language")) {
            language = value;
          } else if (key.includes("original pub year") && !publishDate) {
            publishDate = value;
          }
        }
      }
    });

    // Cover extraction
    const coverWrapper = desktopLayout.find(".book-cover");
    const imgNode = coverWrapper.find("img");
    let coverUrl = imgNode.attr("src") || "";

    // Placeholder check
    if (
      coverWrapper.hasClass("placeholder-cover") ||
      coverUrl.includes("placeholder-cover")
    ) {
      coverUrl = ""; // Don't save placeholders
    }

    return {
      title,
      author: primaryAuthor,
      authors: [primaryAuthor],
      translator,
      totalPage,
      publishDate,
      publisher,
      category: categories,
      categories: categories,
      isbn10,
      isbn13,
      coverUrl,
      coverSmallUrl: coverUrl,
      link,
      previewLink: link,
      description: "", // StoryGraph doesn't seem to have description on editions page
    } as Book;
  }
}
