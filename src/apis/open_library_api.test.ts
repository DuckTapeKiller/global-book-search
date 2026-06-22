import type { RequestUrlResponse } from "obsidian";

// Mock the HTTP layer so we can feed canned OpenLibrary responses through the
// real parsing/mapping code (which was refactored away from `any`).
const httpRequestMock = jest.fn();
jest.mock("@utils/http", () => ({
  httpRequest: (...args: unknown[]) => httpRequestMock(...args),
}));

import { OpenLibraryApi } from "@apis/open_library_api";

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

describe("OpenLibraryApi.getByQuery", () => {
  it("maps search docs into books (string/number fields narrowed safely)", async () => {
    httpRequestMock.mockResolvedValueOnce(
      jsonResponse({
        docs: [
          {
            title: "The Hobbit",
            author_name: ["J.R.R. Tolkien"],
            cover_i: 12345,
            isbn: ["054792822X", "9780547928227"],
            first_publish_year: 1937,
            publisher: ["Houghton Mifflin"],
            number_of_pages_median: 366,
            key: "/works/OL27482W",
            subject: ["Fantasy", "Classics"],
          },
        ],
      }),
    );

    const books = await new OpenLibraryApi().getByQuery("the hobbit");
    expect(books).toHaveLength(1);
    const b = books[0];
    expect(b.title).toBe("The Hobbit");
    expect(b.author).toBe("J.R.R. Tolkien");
    expect(b.authors).toEqual(["J.R.R. Tolkien"]);
    expect(b.coverUrl).toBe("https://covers.openlibrary.org/b/id/12345-L.jpg");
    expect(b.isbn10).toBe("054792822X");
    expect(b.isbn13).toBe("9780547928227");
    expect(b.publishDate).toBe("1937");
    expect(b.publisher).toBe("Houghton Mifflin");
    expect(b.totalPage).toBe(366);
    expect(b.categories).toBe("Fantasy, Classics");
    expect(b.link).toBe("https://openlibrary.org/works/OL27482W");
  });

  it("tolerates missing/garbage fields without throwing", async () => {
    httpRequestMock.mockResolvedValueOnce(
      jsonResponse({
        docs: [{ title: "Untitled", author_name: "not-an-array" }],
      }),
    );
    const books = await new OpenLibraryApi().getByQuery("x");
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe("Untitled");
    expect(books[0].author).toBe("");
    expect(books[0].authors).toEqual([]);
  });

  it("returns [] when the response has no docs", async () => {
    httpRequestMock.mockResolvedValueOnce(jsonResponse({}));
    expect(await new OpenLibraryApi().getByQuery("x")).toEqual([]);
  });
});

describe("OpenLibraryApi.getBook", () => {
  it("enriches a /works/ book from its best edition", async () => {
    const book = {
      title: "The Hobbit",
      author: "J.R.R. Tolkien",
      authors: ["J.R.R. Tolkien"],
      coverUrl: "",
      link: "https://openlibrary.org/works/OL27482W",
      isbn10: "",
      isbn13: "",
    };
    httpRequestMock.mockResolvedValueOnce(
      jsonResponse({
        entries: [
          {
            isbn_13: ["9780547928227"],
            number_of_pages: 300,
            publishers: ["HM"],
          },
        ],
      }),
    );
    const enriched = await new OpenLibraryApi().getBook(book);
    expect(enriched.isbn13).toBe("9780547928227");
    expect(enriched.totalPage).toBe(300);
    expect(enriched.publisher).toBe("HM");
  });
});
