jest.mock("@settings/settings", () => ({
  DefaultFrontmatterKeyType: {
    snakeCase: "Snake Case",
    camelCase: "Camel Case",
  },
}));
jest.mock("@apis/base_api", () => ({ factoryServiceProvider: jest.fn() }));
jest.mock("@apis/goodreads_api", () => ({ GoodreadsApi: jest.fn() }));
jest.mock("@apis/google_books_api", () => ({ GoogleBooksApi: jest.fn() }));
jest.mock("@apis/open_library_api", () => ({ OpenLibraryApi: jest.fn() }));
jest.mock("@apis/storygraph_api", () => ({
  StoryGraphApi: jest.fn(),
  storyGraphLogin: () => ({}),
}));
jest.mock("@utils/http", () => ({
  httpRequest: jest.fn(() => Promise.reject(new Error("offline"))),
  ProviderBlockedError: class ProviderBlockedError extends Error {},
}));

import type { BookSearchPluginSettings } from "@settings/settings";
import type { Book } from "@models/book.model";
import { factoryServiceProvider } from "@apis/base_api";
import { GoodreadsApi } from "@apis/goodreads_api";
import { GoogleBooksApi } from "@apis/google_books_api";
import { OpenLibraryApi } from "@apis/open_library_api";
import { StoryGraphApi } from "@apis/storygraph_api";
import {
  BookWithSource,
  datesAgree,
  enrichBookByISBN,
} from "@apis/global_search";

const nothingFound = () => ({
  getByQuery: async () => [],
  getBook: async (book: Book) => book,
});

const settings = {
  hardcoverApiToken: "tok",
  librarythingApiKey: "",
  fieldSourcePreferences: {},
} as unknown as BookSearchPluginSettings;

const picked: BookWithSource = {
  title: "The Name of the Rose",
  author: "Umberto Eco",
  authors: ["Umberto Eco"],
  coverUrl: "",
  link: "https://www.goodreads.com/book/show/119073",
  isbn13: "9780156001311",
  publisher: "Harcourt",
  description: "The year is 1327.",
  _sourceIds: ["goodreads"],
  _sourceLabels: ["Goodreads"],
};

function hardcoverAnswers(book: Partial<Book>): void {
  (factoryServiceProvider as jest.Mock).mockImplementation(
    (_settings: unknown, id: string) =>
      id === "hardcover"
        ? {
            getByQuery: async () => [
              {
                title: "",
                author: "",
                coverUrl: "",
                link: "",
                ...book,
              },
            ],
          }
        : nothingFound(),
  );
}

// The passive Fable and Library of Congress lookups fail offline and say so.
let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  for (const api of [
    GoodreadsApi,
    GoogleBooksApi,
    OpenLibraryApi,
    StoryGraphApi,
  ]) {
    (api as unknown as jest.Mock).mockImplementation(nothingFound);
  }
});

afterEach(() => warn.mockRestore());

describe("enrichBookByISBN with Hardcover", () => {
  it("brings in Hardcover's answer for the edition asked for", async () => {
    hardcoverAnswers({
      title: "The Name of the Rose",
      isbn13: "9780156001311",
      translator: "William Weaver",
    });
    const result = await enrichBookByISBN(picked, settings);
    expect(result.sources).toContain("Hardcover");
    expect(result.book.translator).toBe("William Weaver");
  });

  it("matches the edition by either ISBN form", async () => {
    hardcoverAnswers({ isbn10: "0156001314", translator: "William Weaver" });
    const result = await enrichBookByISBN(picked, settings);
    expect(result.book.translator).toBe("William Weaver");
  });

  it("asks Hardcover even when it found the book in the search too", async () => {
    hardcoverAnswers({ isbn13: "9780156001311", translator: "William Weaver" });
    const result = await enrichBookByISBN(
      {
        ...picked,
        _sourceIds: ["goodreads", "storygraph", "hardcover"],
        _sourceLabels: ["Goodreads", "StoryGraph", "Hardcover"],
      },
      settings,
    );
    expect(result.sources).toContain("Hardcover");
    expect(result.book.translator).toBe("William Weaver");
  });

  it("leaves out an answer for another edition", async () => {
    hardcoverAnswers({
      title: "El nombre de la rosa",
      isbn13: "9788497592581",
      translator: "Ricardo Pochtar",
      publisher: "Debolsillo",
    });
    const result = await enrichBookByISBN(picked, settings);
    expect(result.sources).not.toContain("Hardcover");
    expect(result.book.translator || "").toBe("");
    expect(result.conflicts.map((c) => c.fieldName)).not.toContain("title");
  });
});

describe("datesAgree", () => {
  it.each([
    [["1994", "1994/09/28"], true],
    [["1994/09", "1994-09-28", "1994"], true],
    [["2001/05/01", "2001/05/01"], true],
    [["1994/01", "1994/09/28"], false],
    [["1994", "1995/01/01"], false],
    [["Sep 28, 1994", "1994"], false],
  ])("%j → %s", (values, expected) => {
    expect(datesAgree(values)).toBe(expected);
  });
});

describe("enrichBookByISBN: publish dates", () => {
  it("does not call dates a conflict when they differ only in precision", async () => {
    hardcoverAnswers({ isbn13: "9780156001311", publishDate: "1994" });
    const result = await enrichBookByISBN(
      { ...picked, publishDate: "1994/09/28" },
      settings,
    );
    expect(result.conflicts.map((c) => c.fieldName)).not.toContain(
      "publishDate",
    );
    expect(result.book.publishDate).toBe("1994/09/28");
  });

  it("still shows dates that disagree", async () => {
    hardcoverAnswers({ isbn13: "9780156001311", publishDate: "2001/05/01" });
    const result = await enrichBookByISBN(
      { ...picked, publishDate: "1994/09/28" },
      settings,
    );
    expect(result.conflicts.map((c) => c.fieldName)).toContain("publishDate");
  });
});

describe("enrichBookByISBN: a chosen result without an ISBN", () => {
  const goodreadsEdition = {
    ...picked,
    title: "Norwegian Wood",
    author: "Haruki Murakami",
    authors: ["Haruki Murakami"],
    isbn13: "",
    publisher: "Vintage Books",
    totalPage: "296",
    format: "Paperback",
    language: "English",
  };
  const edition = (extra: Partial<Book>): Book => ({
    title: "Norwegian Wood",
    author: "Haruki Murakami",
    authors: ["Haruki Murakami"],
    coverUrl: "",
    link: "",
    language: "English",
    format: "Paperback",
    ...extra,
  });

  beforeEach(() => {
    (factoryServiceProvider as jest.Mock).mockImplementation(nothingFound);
  });

  it("borrows the ISBN of its one twin in another catalogue", async () => {
    (OpenLibraryApi as unknown as jest.Mock).mockImplementation(() => ({
      ...nothingFound(),
      editionsLike: async () => [
        edition({
          publisher: "Vintage Books",
          totalPage: "296",
          isbn13: "9780375704024",
          sourceProvider: "openlibrary",
        }),
        // Another edition by another publisher: not a twin.
        edition({
          publisher: "Vintage",
          totalPage: "389",
          isbn13: "9780099448822",
          sourceProvider: "openlibrary",
        }),
      ],
    }));
    const progress: string[] = [];
    const result = await enrichBookByISBN(
      goodreadsEdition,
      settings,
      (message) => progress.push(message),
    );
    expect(result.book.isbn13).toBe("9780375704024");
    expect(result.book.isbn10).toBe("0375704027");
    expect(progress).toContain("ISBN found on Open Library ✓");
  });

  it("takes no ISBN when two editions could be it", async () => {
    (OpenLibraryApi as unknown as jest.Mock).mockImplementation(() => ({
      ...nothingFound(),
      editionsLike: async () => [
        edition({
          publisher: "Vintage Books",
          totalPage: "296",
          isbn13: "9780375704024",
        }),
        edition({
          publisher: "Vintage Books",
          totalPage: "296",
          isbn13: "9780307950628",
        }),
      ],
    }));
    const result = await enrichBookByISBN(goodreadsEdition, settings);
    expect(result.book.isbn13).toBe("");
    expect(result.sources).toEqual(["Goodreads"]);
  });

  it("lets a book that is not an edition take the edition a source knows", async () => {
    (factoryServiceProvider as jest.Mock).mockImplementation(
      (_settings: unknown, id: string) => ({
        getByQuery: async () =>
          id === "openlibrary"
            ? [edition({ title: "Norwegian Wood", isbn13: "9780375704024" })]
            : [],
        getBook: async (book: Book) => book,
      }),
    );
    const progress: string[] = [];
    const result = await enrichBookByISBN(
      {
        ...picked,
        title: "Norwegian Wood",
        author: "Haruki Murakami",
        isbn13: "",
        publisher: "",
        _sourceIds: ["hardcover"],
        _sourceLabels: ["Hardcover"],
      },
      settings,
      (message) => progress.push(message),
    );
    expect(result.book.isbn13).toBe("9780375704024");
    expect(progress).toContain("ISBN found on Open Library ✓");
  });
});
