import type { RequestUrlResponse } from "obsidian";

const httpRequestMock = jest.fn();
jest.mock("@utils/http", () => ({
  httpRequest: (...args: unknown[]) => httpRequestMock(...args),
}));

import { HardcoverApi } from "@apis/hardcover_api";

function jsonResponse(body: unknown): RequestUrlResponse {
  return {
    status: 200,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
    text: JSON.stringify(body),
    json: body,
  };
}

beforeEach(() => httpRequestMock.mockReset());

describe("HardcoverApi.getByQuery", () => {
  it("returns [] without a token (no network call)", async () => {
    const books = await new HardcoverApi("").getByQuery("criacuervo");
    expect(books).toEqual([]);
    expect(httpRequestMock).not.toHaveBeenCalled();
  });

  it("maps Typesense search hits into books", async () => {
    httpRequestMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          search: {
            results: {
              hits: [
                {
                  document: {
                    id: 331816,
                    title: "Criacuervo",
                    slug: "criacuervo",
                    author_names: ["Orlando Echeverri Benedetti"],
                    image: {
                      url: "https://assets.hardcover.app/books/331816/10153010-L.jpg",
                    },
                    release_year: 2017,
                    pages: 200,
                    genres: ["Fiction", "Literary"],
                    isbns: ["9585965267", "9789585965263"],
                    description: "A novel.",
                  },
                },
              ],
            },
          },
        },
      }),
    );

    const books = await new HardcoverApi("tok").getByQuery("criacuervo");
    expect(books).toHaveLength(1);
    const b = books[0];
    expect(b.title).toBe("Criacuervo");
    expect(b.author).toBe("Orlando Echeverri Benedetti");
    expect(b.coverUrl).toContain("assets.hardcover.app/books/331816");
    expect(b.publishDate).toBe("2017");
    expect(b.totalPage).toBe("200");
    expect(b.categories).toBe("Fiction, Literary");
    expect(b.isbn10).toBe("9585965267");
    expect(b.isbn13).toBe("9789585965263");
    expect(b.link).toBe("https://hardcover.app/books/criacuervo");
    expect(b.sourceProvider).toBe("hardcover");
    expect(b.sourceId).toBe("331816");

    // Authorization header carries the token as a Bearer.
    const opts = httpRequestMock.mock.calls[0][0] as {
      headers: Record<string, string>;
    };
    expect(opts.headers.Authorization).toBe("Bearer tok");
  });

  it("tolerates an empty / malformed search payload", async () => {
    httpRequestMock.mockResolvedValueOnce(jsonResponse({ data: {} }));
    expect(await new HardcoverApi("tok").getByQuery("x")).toEqual([]);
  });
});

describe("HardcoverApi.getBook", () => {
  const base = {
    title: "Criacuervo",
    author: "Orlando Echeverri Benedetti",
    authors: ["Orlando Echeverri Benedetti"],
    coverUrl: "",
    link: "https://hardcover.app/books/criacuervo",
    isbn10: "",
    isbn13: "",
    sourceProvider: "hardcover",
    sourceId: "331816",
  };

  it("enriches from the best edition (publisher, isbn, pages)", async () => {
    httpRequestMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          books: [
            {
              id: 331816,
              description: "A novel.",
              pages: null,
              editions: [
                {
                  isbn_10: "9585965267",
                  isbn_13: "9789585965263",
                  asin: null,
                  pages: 208,
                  publisher: { name: "Seix Barral" },
                  image: { url: "https://assets.hardcover.app/x-L.jpg" },
                },
              ],
            },
          ],
        },
      }),
    );

    const enriched = await new HardcoverApi("tok").getBook(base);
    expect(enriched.isbn13).toBe("9789585965263");
    expect(enriched.isbn10).toBe("9585965267");
    expect(enriched.publisher).toBe("Seix Barral");
    expect(enriched.totalPage).toBe("208");
  });

  it("returns the input book unchanged when there is no token or id", async () => {
    expect(await new HardcoverApi("").getBook(base)).toBe(base);
    expect(httpRequestMock).not.toHaveBeenCalled();
  });
});
