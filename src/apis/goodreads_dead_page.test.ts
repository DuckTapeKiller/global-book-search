import { readFileSync } from "node:fs";
import { join } from "node:path";

const deadPage = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "test",
    "fixtures",
    "goodreads_dead_book_page.html",
  ),
  "utf-8",
);

// Every route returns the same HTTP-200 "Page not found" chrome page, which is
// exactly what Goodreads serves for a dead or mistyped book id.
jest.mock("@utils/http", () => ({
  ...jest.requireActual("@utils/http"),
  httpRequest: jest.fn(async () => ({
    status: 200,
    headers: { "content-type": "text/html" },
    text: deadPage,
    json: undefined,
    arrayBuffer: new ArrayBuffer(0),
  })),
}));

import { GoodreadsApi } from "./goodreads_api";
import type { Book } from "@models/book.model";

const searchResult: Book = {
  title: "The Hobbit",
  author: "J.R.R. Tolkien",
  authors: ["J.R.R. Tolkien"],
  coverUrl: "https://i.gr-assets.com/images/hobbit.jpg",
  link: "https://www.goodreads.com/book/show/999999999.The_Hobbit",
  isbn13: "9780261102217",
};

describe("getBook against a dead Goodreads id", () => {
  it("keeps the search result instead of overwriting it with site chrome", async () => {
    const api = new GoodreadsApi();
    const result = await api.getBook({ ...searchResult });

    expect(result.title).toBe("The Hobbit");
    expect(result.author).toBe("J.R.R. Tolkien");
    expect(result.coverUrl).toBe("https://i.gr-assets.com/images/hobbit.jpg");
    expect(result.isbn13).toBe("9780261102217");

    // The chrome values that used to win:
    expect(result.title).not.toBe("Goodreads");
    expect(result.coverUrl).not.toContain("gr-assets.com/assets/");
    expect(result.description || "").not.toContain("Discover and share books");
  });
});
