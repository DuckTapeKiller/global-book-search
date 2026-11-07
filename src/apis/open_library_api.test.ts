import type { RequestUrlResponse } from "obsidian";

// Mock the HTTP layer so we can feed canned OpenLibrary responses through the
// real parsing/mapping code (which was refactored away from `any`).
const httpRequestMock = jest.fn<Promise<RequestUrlResponse>, unknown[]>();
jest.mock("@utils/http", () => ({
  httpRequest: (...args: unknown[]) => httpRequestMock(...args),
}));

import {
  OpenLibraryApi,
  bookFromOpenLibraryEdition,
  chooseOpenLibraryEdition,
  openLibraryAuthorName,
  openLibraryLanguage,
  translatorsFromStatement,
} from "@apis/open_library_api";

function jsonResponse(body: unknown, status = 200): RequestUrlResponse {
  return {
    status,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
    text: JSON.stringify(body),
    json: body,
  };
}

/** Answer each URL from a table; anything else is a 404. */
function serve(table: Record<string, unknown>): void {
  httpRequestMock.mockImplementation((req: unknown) => {
    const url = (req as { url: string }).url;
    const key = Object.keys(table).find((part) => url.includes(part));
    return Promise.resolve(
      key ? jsonResponse(table[key]) : jsonResponse({ error: "notfound" }, 404),
    );
  });
}

beforeEach(() => httpRequestMock.mockReset());

// Trimmed from openlibrary.org/books/OL1089713M.json and its work and author.
const roseEdition = {
  key: "/books/OL1089713M",
  title: "The Name of the Rose",
  publishers: ["Harcourt Brace", "Harvest Books"],
  publish_date: "1994",
  number_of_pages: 536,
  isbn_10: ["0156001314"],
  isbn_13: ["9780156001311"],
  languages: [{ key: "/languages/eng" }],
  by_statement: "Umberto Eco ; translated from the Italian by William Weaver.",
  covers: [8231856],
  authors: [{ key: "/authors/OL19430A" }],
  works: [{ key: "/works/OL8996439W" }],
};
const roseWork = {
  key: "/works/OL8996439W",
  title: "Il nome della rosa",
  first_publish_date: "1980",
  description: {
    value:
      "The year is 1327. [Benedictines](https://example.org) are suspected.\n----------\nAlso contained in: …",
  },
  subjects: [
    "Novela de misterio",
    "History",
    "nyt:trade-fiction=2008",
    "Accessible book",
  ],
  authors: [{ author: { key: "/authors/OL19430A" } }],
};
const eco = { key: "/authors/OL19430A", name: "Umberto Eco" };

describe("openLibraryLanguage", () => {
  it("names an edition's language", () => {
    expect(openLibraryLanguage([{ key: "/languages/spa" }])).toBe("Spanish");
    expect(openLibraryLanguage([])).toBe("");
  });
});

describe("openLibraryAuthorName", () => {
  const murakami = {
    name: "村上春樹",
    personal_name: "Murakami, Haruki",
    alternate_names: ["春樹 村上", "HARUKI MURAKAMI"],
  };

  it("gives a Latin-script edition the Latin form of the name", () => {
    expect(openLibraryAuthorName(murakami, true)).toBe("Haruki Murakami");
  });

  it("keeps the name for an edition in another script", () => {
    expect(openLibraryAuthorName(murakami, false)).toBe("村上春樹");
    expect(openLibraryAuthorName(eco, true)).toBe("Umberto Eco");
  });
});

describe("translatorsFromStatement", () => {
  it.each([
    [
      "Umberto Eco ; translated from the Italian by William Weaver.",
      ["William Weaver"],
    ],
    [
      "by Fyodor Dostoevsky ; translated and annotated by Richard Pevear and Larissa Volokhonsky.",
      ["Richard Pevear", "Larissa Volokhonsky"],
    ],
    ["translated by the author", []],
    ["with an introduction by Harold Bloom", []],
    ["", []],
  ])("%j → %j", (statement, names) => {
    expect(translatorsFromStatement(statement)).toEqual(names);
  });
});

describe("bookFromOpenLibraryEdition", () => {
  it("makes the book from the edition, its work and its authors", () => {
    expect(
      bookFromOpenLibraryEdition(roseEdition, roseWork, [eco]),
    ).toMatchObject({
      title: "The Name of the Rose",
      author: "Umberto Eco",
      authors: ["Umberto Eco"],
      translator: "William Weaver",
      publisher: "Harcourt Brace",
      publishDate: "1994",
      totalPage: "536",
      language: "English",
      isbn13: "9780156001311",
      isbn10: "0156001314",
      description: "The year is 1327. Benedictines are suspected.",
      categories: "Novela de misterio, History",
      coverUrl: "https://covers.openlibrary.org/b/id/8231856-L.jpg",
      link: "https://openlibrary.org/books/OL1089713M",
      sourceProvider: "openlibrary",
    });
  });

  it("reads the original title, binding and translators of a translation", () => {
    const book = bookFromOpenLibraryEdition(
      {
        title: "Harry potter y la piedra filosofal",
        publish_date: "November 20, 2008",
        physical_format: "hardcover",
        translation_of: "Harry Potter and the Philosopher's Stone",
        contributors: [
          { role: "Translator", name: "Alicia Dellepiane Rawson" },
        ],
        isbn_13: ["9788478884452"],
      },
      null,
      [],
    );
    expect(book).toMatchObject({
      originalTitle: "Harry Potter and the Philosopher's Stone",
      translator: "Alicia Dellepiane Rawson",
      format: "Hardcover",
      publishDate: "2008/11/20",
    });
  });

  it("drops the notes imported titles carry in brackets", () => {
    const book = bookFromOpenLibraryEdition(
      { title: "1984 (Contemporanea (Debolsillo)) (Spanish Edition)" },
      null,
      [],
    );
    expect(book.title).toBe("1984");
  });

  it("takes no first publication date from Open Library", () => {
    expect(
      bookFromOpenLibraryEdition(roseEdition, roseWork, [eco]).firstPublishDate,
    ).toBeUndefined();
  });
});

describe("chooseOpenLibraryEdition", () => {
  const english = { ...roseEdition };
  const spanish = {
    ...roseEdition,
    key: "/books/OL2M",
    languages: [{ key: "/languages/spa" }],
    isbn_13: ["9788426411488"],
  };

  it("takes a complete edition in the reader's language", () => {
    expect(chooseOpenLibraryEdition([english, spanish], "spa")).toBe(spanish);
  });

  it("falls back to the most complete edition with an ISBN", () => {
    const bare = { title: "x", isbn_13: ["9780000000002"] };
    expect(chooseOpenLibraryEdition([bare, english], "fre")).toBe(english);
    expect(chooseOpenLibraryEdition([{ title: "no isbn" }], "eng")).toBeNull();
  });
});

describe("OpenLibraryApi.getByQuery", () => {
  it("answers an ISBN with that edition, not its work", async () => {
    serve({
      "/isbn/9780156001311.json": roseEdition,
      "/works/OL8996439W.json": roseWork,
      "/authors/OL19430A.json": eco,
    });
    const books = await new OpenLibraryApi().getByQuery("isbn:9780156001311");
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe("The Name of the Rose");
    expect(books[0].author).toBe("Umberto Eco");
    expect(books[0].translator).toBe("William Weaver");
  });

  it("refuses a record that does not list the ISBN asked for", async () => {
    // Open Library answers an ISBN it lacks with some other book.
    serve({
      "/isbn/9780000000002.json": {
        ...roseEdition,
        isbn_13: ["9781111111113"],
        isbn_10: [],
      },
    });
    expect(await new OpenLibraryApi().getByQuery("isbn:9780000000002")).toEqual(
      [],
    );
  });

  it("maps search docs into books without an edition's ISBN or date", async () => {
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
            key: "/works/OL27482W",
            subject: ["Fantasy", "Classics"],
          },
        ],
      }),
    );
    const [book] = await new OpenLibraryApi().getByQuery("the hobbit");
    expect(book).toMatchObject({
      title: "The Hobbit",
      author: "J.R.R. Tolkien",
      coverUrl: "https://covers.openlibrary.org/b/id/12345-L.jpg",
      isbn13: "",
      isbn10: "",
      publisher: "",
      publishDate: "",
      categories: "Fantasy, Classics",
      link: "https://openlibrary.org/works/OL27482W",
    });
  });

  it("tolerates missing or garbage fields and empty answers", async () => {
    httpRequestMock.mockResolvedValueOnce(
      jsonResponse({ docs: [{ title: 42, author_name: "not an array" }] }),
    );
    const [book] = await new OpenLibraryApi().getByQuery("x");
    expect(book.title).toBe("");
    expect(book.authors).toEqual([]);
    httpRequestMock.mockResolvedValueOnce(jsonResponse({}));
    expect(await new OpenLibraryApi().getByQuery("x")).toEqual([]);
  });
});

describe("OpenLibraryApi.getBook", () => {
  const work = {
    title: "The Hobbit",
    author: "J.R.R. Tolkien",
    authors: ["J.R.R. Tolkien"],
    coverUrl: "",
    link: "https://openlibrary.org/works/OL27482W",
    isbn10: "",
    isbn13: "",
  };

  it("makes a picked book's note from one edition in the reader's language", async () => {
    serve({
      "/works/OL27482W/editions.json": {
        entries: [
          {
            key: "/books/OL1M",
            title: "The Hobbit",
            isbn_13: ["9780547928227"],
            number_of_pages: 300,
            publishers: ["HM"],
            languages: [{ key: "/languages/eng" }],
          },
          {
            key: "/books/OL2M",
            title: "El hobbit",
            isbn_13: ["9788445073728"],
            number_of_pages: 312,
            publishers: ["Minotauro"],
            languages: [{ key: "/languages/spa" }],
          },
        ],
      },
    });
    const book = await new OpenLibraryApi("es").getBook(work);
    expect(book).toMatchObject({
      title: "El hobbit",
      isbn13: "9788445073728",
      totalPage: "312",
      publisher: "Minotauro",
      language: "Spanish",
      // The edition lists no authors and its work is unknown: the search
      // result's are kept.
      author: "J.R.R. Tolkien",
    });
  });

  it("costs nothing after an ISBN search", async () => {
    serve({
      "/isbn/9780156001311.json": roseEdition,
      "/works/OL8996439W.json": roseWork,
      "/authors/OL19430A.json": eco,
    });
    const api = new OpenLibraryApi();
    const [found] = await api.getByQuery("9780156001311");
    const calls = httpRequestMock.mock.calls.length;
    const full = await api.getBook(found);
    expect(full.publisher).toBe("Harcourt Brace");
    expect(httpRequestMock.mock.calls.length).toBe(calls);
  });
});

describe("OpenLibraryApi.editionsLike", () => {
  it("lists the book's editions with an ISBN", async () => {
    serve({
      "/search.json": {
        docs: [{ key: "/works/OL5W", title: "Norwegian Wood" }],
      },
      "/works/OL5W/editions.json": {
        entries: [
          {
            key: "/books/OL7M",
            title: "Norwegian Wood",
            publishers: ["Vintage Books"],
            number_of_pages: 296,
            physical_format: "Paperback",
            isbn_13: ["9780375704024"],
          },
          { key: "/books/OL8M", title: "Norwegian Wood" },
        ],
      },
    });
    const editions = await new OpenLibraryApi().editionsLike({
      title: "Norwegian Wood",
      author: "Haruki Murakami",
      authors: [],
      coverUrl: "",
      link: "",
    });
    expect(editions).toHaveLength(1);
    expect(editions[0]).toMatchObject({
      publisher: "Vintage Books",
      totalPage: "296",
      format: "Paperback",
      isbn13: "9780375704024",
    });
  });
});
