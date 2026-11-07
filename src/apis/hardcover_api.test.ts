import type { RequestUrlResponse } from "obsidian";

const httpRequestMock = jest.fn<Promise<RequestUrlResponse>, unknown[]>();
jest.mock("@utils/http", () => ({
  httpRequest: (...args: unknown[]) => httpRequestMock(...args),
}));

import {
  HardcoverApi,
  bookFromHardcover,
  bookFromHardcoverSearchHit,
  chooseHardcoverEdition,
  hardcoverCharacters,
  hardcoverDate,
  hardcoverEditionDate,
  hardcoverSeries,
  hardcoverTags,
} from "@apis/hardcover_api";

function jsonResponse(body: unknown): RequestUrlResponse {
  return {
    status: 200,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
    text: JSON.stringify(body),
    json: body,
  };
}

function sentBody(call = 0): {
  query: string;
  variables: Record<string, unknown>;
} {
  const opts = httpRequestMock.mock.calls[call][0] as { body: string };
  return JSON.parse(opts.body) as {
    query: string;
    variables: Record<string, unknown>;
  };
}

beforeEach(() => httpRequestMock.mockReset());

// Trimmed from Hardcover's answers for The Name of the Rose (book 365331) and
// its Harcourt paperback (edition 9226998).
const roseWork = {
  id: 365331,
  slug: "the-name-of-the-rose",
  title: "The Name of the Rose",
  description:
    "The year is 1327.\r\n\r\nFranciscans in a wealthy Italian abbey are suspected of heresy.",
  release_date: "1980-01-01",
  release_year: 1980,
  image: { url: "https://assets.hardcover.app/books/365331.jpg" },
  cached_tags: {
    Genre: [
      { tag: "Mystery", count: 6 },
      { tag: "Historical Fiction", count: 5 },
      { tag: "Classics", count: 5 },
      { tag: "Literary Fiction", count: 2 },
      { tag: "Fiction:Thriller", count: 1 },
    ],
    Mood: [
      { tag: "mysterious", count: 24 },
      { tag: "Adventurous", count: 7 },
      { tag: "Crime", count: 1 },
    ],
  },
  contributions: [
    { contribution: "Translator", author: { name: "William Weaver" } },
    { contribution: "Author", author: { name: "Umberto Eco" } },
  ],
  featured_book_series: null,
  book_characters: [
    {
      spoiler: false,
      only_mentioned: false,
      character: { name: "Umberto Eco" },
    },
    {
      spoiler: false,
      only_mentioned: false,
      character: { name: "William of Baskerville" },
    },
    {
      spoiler: true,
      only_mentioned: false,
      character: { name: "Jorge of Burgos" },
    },
  ],
};

const roseHarcourt = {
  id: 9226998,
  title: "The Name of the Rose",
  subtitle: null,
  isbn_10: "0156001314",
  isbn_13: "9780156001311",
  asin: "0156001314",
  pages: 556,
  audio_seconds: null,
  release_date: "1994-01-01",
  edition_format: "Paperback",
  reading_format: { format: "Read" },
  language: { language: "English", code2: "en" },
  publisher: { name: "Houghton Mifflin Harcourt" },
  image: { url: "https://assets.hardcover.app/edition/9226998.jpg" },
  contributions: [
    { contribution: "Author", author: { name: "Umberto Eco" } },
    { contribution: "Translator", author: { name: "William Weaver" } },
  ],
};

const roseSpanish = {
  ...roseHarcourt,
  id: 30000001,
  title: "El nombre de la rosa",
  isbn_10: "8426411487",
  isbn_13: "9788426411488",
  asin: null,
  pages: 607,
  release_date: "1982-03-01",
  edition_format: "Hardcover",
  language: { language: "Spanish; Castilian", code2: "es" },
  publisher: { name: "Lumen" },
  image: { url: "https://assets.hardcover.app/edition/30000001.jpg" },
  contributions: [
    { contribution: "Translator", author: { name: "Ricardo Pochtar" } },
    { contribution: "Author", author: { name: "Umberto Eco" } },
  ],
};

describe("hardcoverDate", () => {
  it.each([
    ["2006-01-03", "2006/01/03"],
    ["1994-01-01", "1994"],
    ["", ""],
    ["not a date", ""],
  ])("writes %j as %j", (value, expected) => {
    expect(hardcoverDate(value)).toBe(expected);
  });
});

describe("hardcoverEditionDate", () => {
  const work = { release_date: "2001-01-01", release_year: 2001 };

  it("keeps an edition's own date", () => {
    expect(
      hardcoverEditionDate({ release_date: "2006-01-03" }, work, true),
    ).toBe("2006/01/03");
  });

  it("gives just the year Hardcover stores as 1 January", () => {
    expect(
      hardcoverEditionDate({ release_date: "2014-01-01" }, work, true),
    ).toBe("2014");
  });

  it("drops the book's first publication date copied onto an edition", () => {
    const orwell = { release_date: "1949-06-08", release_year: 1949 };
    expect(
      hardcoverEditionDate({ release_date: "1949-06-08" }, orwell, true),
    ).toBe("");
    const ferrante = { release_date: "2011-10-19", release_year: 2011 };
    expect(
      hardcoverEditionDate({ release_date: "2011-10-19" }, ferrante, false),
    ).toBe("");
  });

  it("drops a date from before ISBNs existed or before the book did", () => {
    const salinger = { release_date: "1951-01-01", release_year: 1951 };
    expect(
      hardcoverEditionDate({ release_date: "1951-07-16" }, salinger, false),
    ).toBe("");
    expect(
      hardcoverEditionDate({ release_date: "1999-05-01" }, work, false),
    ).toBe("");
  });

  it("drops a translation's date in the year the original came out", () => {
    expect(
      hardcoverEditionDate({ release_date: "2001-05-01" }, work, true),
    ).toBe("");
    expect(
      hardcoverEditionDate({ release_date: "2001-05-01" }, work, false),
    ).toBe("2001/05/01");
  });

  it("gives nothing for an edition without a date", () => {
    expect(hardcoverEditionDate({ release_date: null }, work, false)).toBe("");
  });
});

describe("hardcoverTags", () => {
  it("keeps the voted tags, most voted first, without one-vote noise", () => {
    expect(hardcoverTags(roseWork.cached_tags, "Genre", 5)).toEqual([
      "Mystery",
      "Historical Fiction",
      "Classics",
      "Literary Fiction",
    ]);
  });

  it("stops at the limit and skips repeats in another case", () => {
    const tags = {
      Mood: [
        { tag: "dark", count: 9 },
        { tag: "Dark", count: 3 },
        { tag: "tense", count: 4 },
        { tag: "sad", count: 2 },
      ],
    };
    expect(hardcoverTags(tags, "Mood", 2)).toEqual(["dark", "tense"]);
  });

  it("keeps single votes when no tag has more", () => {
    const tags = { Genre: [{ tag: "Poetry", count: 1 }] };
    expect(hardcoverTags(tags, "Genre", 5)).toEqual(["Poetry"]);
  });

  it("gives nothing for a missing category", () => {
    expect(hardcoverTags({}, "Genre", 5)).toEqual([]);
    expect(hardcoverTags(null, "Genre", 5)).toEqual([]);
  });
});

describe("hardcoverCharacters", () => {
  it("leaves out spoilers, characters only mentioned, the author and real people", () => {
    const characters = [
      { character: { name: "Fyodor Dostoyevsky (1821-1881)" } },
      { character: { name: "Juan Rulfo (1918-)" } },
      { character: { name: "Holden Caulfield (Fictitious character)" } },
      { character: { name: "Marianne Sheridan (fictional character)" } },
      { character: { name: "Don Quixote" } },
      { character: { name: "Quixote Don" } },
      { only_mentioned: true, character: { name: "Phoebe" } },
      { spoiler: true, character: { name: "Rocky" } },
      { character: { name: "J. D. Salinger" } },
    ];
    expect(hardcoverCharacters(characters, ["J. D. Salinger"])).toEqual([
      "Holden Caulfield",
      "Marianne Sheridan",
      "Don Quixote",
    ]);
  });

  it("stops at the limit", () => {
    const characters = ["A", "B", "C"].map((name) => ({ character: { name } }));
    expect(hardcoverCharacters(characters, [], 2)).toEqual(["A", "B"]);
  });
});

describe("hardcoverSeries", () => {
  it("reads the series and the book's place in it", () => {
    expect(
      hardcoverSeries({ position: 1, series: { name: "Harry Potter" } }),
    ).toEqual({ series: "Harry Potter", seriesNumber: "1" });
    expect(
      hardcoverSeries({ position: 2.5, series: { name: "Discworld" } }),
    ).toEqual({ series: "Discworld", seriesNumber: "2.5" });
  });

  it("ignores a series without a position (often a wrong match)", () => {
    expect(
      hardcoverSeries({
        position: null,
        series: { name: "Southwestern and Mexican Photography Series" },
      }),
    ).toEqual({ series: "", seriesNumber: "" });
    expect(hardcoverSeries(null)).toEqual({ series: "", seriesNumber: "" });
  });
});

describe("bookFromHardcover", () => {
  it("makes the note's book from one edition and its book", () => {
    const book = bookFromHardcover(roseHarcourt, roseWork);
    expect(book).toMatchObject({
      title: "The Name of the Rose",
      author: "Umberto Eco",
      authors: ["Umberto Eco"],
      translator: "William Weaver",
      narrator: "",
      publisher: "Houghton Mifflin Harcourt",
      publishDate: "1994",
      firstPublishDate: "1980",
      totalPage: "556",
      format: "Paperback",
      language: "English",
      isbn13: "9780156001311",
      isbn10: "0156001314",
      asin: "0156001314",
      categories: "Mystery, Historical Fiction, Classics, Literary Fiction",
      category: "Mystery",
      moods: "mysterious, adventurous",
      characters: "William of Baskerville",
      series: "",
      seriesNumber: "",
      coverUrl: "https://assets.hardcover.app/edition/9226998.jpg",
      link: "https://hardcover.app/books/the-name-of-the-rose/editions/9226998",
      sourceProvider: "hardcover",
      sourceId: "365331",
    });
    expect(book.description).toBe(
      "The year is 1327. Franciscans in a wealthy Italian abbey are suspected of heresy.",
    );
  });

  it("keeps translators, editors and writers of afterwords out of the authors", () => {
    const orwell = {
      id: 2,
      slug: "1984",
      release_date: "1949-06-08",
      release_year: 1949,
      contributions: [
        { contribution: "Author", author: { name: "George Orwell" } },
      ],
    };
    const debolsillo = {
      id: 24909295,
      title: "1984",
      isbn_13: "9788499890944",
      pages: 350,
      release_date: "1949-06-08",
      language: { language: "Spanish; Castilian", code2: "es" },
      publisher: { name: "National Geographic Books" },
      contributions: [
        { contribution: "Author", author: { name: "George Orwell" } },
        {
          contribution: "Translator",
          author: { name: "Miguel Temprano García" },
        },
        { contribution: "Afterword", author: { name: "Thomas Pynchon" } },
      ],
    };
    const book = bookFromHardcover(debolsillo, orwell);
    expect(book.authors).toEqual(["George Orwell"]);
    expect(book.translator).toBe("Miguel Temprano García");
    // Not this edition's publisher or date: Hardcover's copies.
    expect(book.publisher).toBe("");
    expect(book.publishDate).toBe("");
    expect(book.firstPublishDate).toBe("1949/06/08");
    expect(book.language).toBe("Spanish");
  });

  it("takes the book's authors when the edition credits nobody", () => {
    const book = bookFromHardcover(
      { ...roseHarcourt, contributions: [] },
      roseWork,
    );
    expect(book.authors).toEqual(["Umberto Eco"]);
    // Another edition's translator is not this one's.
    expect(book.translator).toBe("");
  });

  it("reads an audiobook's narrator and gives it no page count", () => {
    const audio = {
      ...roseHarcourt,
      pages: 1,
      audio_seconds: 72000,
      edition_format: "",
      reading_format: { format: "Listened" },
      contributions: [
        { contribution: null, author: { name: "Umberto Eco" } },
        { contribution: "Narrator", author: { name: "Sean Barrett" } },
        { contribution: "Translator", author: { name: "William Weaver" } },
      ],
    };
    const book = bookFromHardcover(audio, roseWork);
    expect(book.narrator).toBe("Sean Barrett");
    expect(book.authors).toEqual(["Umberto Eco"]);
    expect(book.totalPage).toBe("");
    expect(book.format).toBe("Audiobook");
  });

  it("writes names in composed Unicode", () => {
    const book = bookFromHardcover(
      { ...roseSpanish, publisher: { name: "Cátedra" } },
      roseWork,
    );
    expect(book.publisher).toBe("Cátedra");
    expect(book.publisher).toHaveLength(7);
  });
});

describe("bookFromHardcoverSearchHit", () => {
  const hit = {
    id: "365331",
    title: "The Name of the Rose",
    slug: "the-name-of-the-rose",
    author_names: ["Umberto Eco", "William Weaver"],
    contributions: [
      { author: { name: "Umberto Eco" }, contribution: null },
      { author: { name: "William Weaver" }, contribution: "Translator" },
    ],
    // Every edition's ISBNs, a Polish one first.
    isbns: ["8373927182", "9788373927186", "0156001314", "9780156001311"],
    image: { url: "https://assets.hardcover.app/edition/9226998.jpg" },
    release_date: "1980-01-01",
    release_year: 1980,
    pages: 556,
    genres: ["Mystery", "Historical Fiction"],
    featured_series: {},
    description: "The year is 1327.",
  };

  it("lists the authors only, not the translator", () => {
    const book = bookFromHardcoverSearchHit(hit);
    expect(book?.authors).toEqual(["Umberto Eco"]);
    expect(book?.author).toBe("Umberto Eco");
  });

  it("takes no ISBN, page count or date from the book's mix of editions", () => {
    const book = bookFromHardcoverSearchHit(hit);
    expect(book?.isbn13).toBe("");
    expect(book?.isbn10).toBe("");
    expect(book?.totalPage).toBe("");
    expect(book?.publishDate).toBe("");
    expect(book?.firstPublishDate).toBe("1980");
    expect(book?.sourceId).toBe("365331");
    expect(book?.link).toBe("https://hardcover.app/books/the-name-of-the-rose");
  });

  it("reads the series", () => {
    const book = bookFromHardcoverSearchHit({
      ...hit,
      featured_series: { position: 1, series: { name: "Harry Potter" } },
    });
    expect(book?.series).toBe("Harry Potter");
    expect(book?.seriesNumber).toBe("1");
  });

  it("falls back to the first name when contributions are missing", () => {
    const book = bookFromHardcoverSearchHit({
      ...hit,
      contributions: undefined,
    });
    expect(book?.authors).toEqual(["Umberto Eco"]);
  });

  it("skips a hit without a title", () => {
    expect(bookFromHardcoverSearchHit({ id: 1 })).toBeNull();
  });
});

describe("chooseHardcoverEdition", () => {
  const english = roseHarcourt;
  const spanish = roseSpanish;

  it("takes the default edition when it is in the reader's language", () => {
    const work = {
      default_physical_edition: english,
      in_language: [],
      popular: [],
    };
    expect(chooseHardcoverEdition(work, "en")).toBe(english);
  });

  it("takes an edition in the reader's language over the default", () => {
    const work = {
      default_physical_edition: english,
      in_language: [spanish],
      popular: [english],
    };
    expect(chooseHardcoverEdition(work, "es")).toBe(spanish);
  });

  it("prefers a complete edition in the reader's language", () => {
    const bare = { ...spanish, id: 3, pages: null, publisher: null };
    const work = {
      default_physical_edition: english,
      in_language: [bare, spanish],
      popular: [],
    };
    expect(chooseHardcoverEdition(work, "es")).toBe(spanish);
  });

  it("falls back to the default, then the most read edition with an ISBN", () => {
    expect(
      chooseHardcoverEdition(
        { default_physical_edition: english, in_language: [], popular: [] },
        "es",
      ),
    ).toBe(english);
    expect(
      chooseHardcoverEdition(
        { default_physical_edition: null, in_language: [], popular: [spanish] },
        "fr",
      ),
    ).toBe(spanish);
    expect(chooseHardcoverEdition({}, "en")).toBeNull();
  });
});

describe("HardcoverApi.getByQuery", () => {
  it("returns [] without a token (no network call)", async () => {
    const books = await new HardcoverApi("").getByQuery("pedro paramo");
    expect(books).toEqual([]);
    expect(httpRequestMock).not.toHaveBeenCalled();
  });

  it("answers an ISBN with that exact edition", async () => {
    httpRequestMock.mockResolvedValueOnce(
      jsonResponse({
        data: { editions: [{ ...roseHarcourt, book: roseWork }] },
      }),
    );
    const books = await new HardcoverApi("tok", "es").getByQuery(
      "978-0-15-600131-1",
    );
    expect(books).toHaveLength(1);
    // The English edition asked for, not the reader's language.
    expect(books[0].title).toBe("The Name of the Rose");
    expect(books[0].isbn13).toBe("9780156001311");
    expect(books[0].translator).toBe("William Weaver");
    const { query, variables } = sentBody();
    expect(query).toContain("editions(");
    expect(variables).toEqual({
      isbn13: "9780156001311",
      isbn10: "0156001314",
    });
    const opts = httpRequestMock.mock.calls[0][0] as {
      headers: Record<string, string>;
    };
    expect(opts.headers.Authorization).toBe("Bearer tok");
  });

  it("looks an ISBN-10 up in both forms", async () => {
    httpRequestMock.mockResolvedValueOnce(
      jsonResponse({ data: { editions: [] } }),
    );
    expect(await new HardcoverApi("tok").getByQuery("isbn:0156001314")).toEqual(
      [],
    );
    expect(sentBody().variables).toEqual({
      isbn13: "9780156001311",
      isbn10: "0156001314",
    });
  });

  it("fills the other ISBN form when Hardcover filed only one", async () => {
    httpRequestMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          editions: [{ ...roseHarcourt, isbn_13: null, book: roseWork }],
        },
      }),
    );
    const [book] = await new HardcoverApi("tok").getByQuery("0156001314");
    expect(book.isbn13).toBe("9780156001311");
    expect(book.isbn10).toBe("0156001314");
  });

  it("searches a title, giving books without an edition's ISBN", async () => {
    httpRequestMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          search: {
            results: {
              hits: [
                {
                  document: {
                    id: 284001,
                    title: "Pedro Páramo",
                    slug: "pedro-paramo",
                    author_names: ["Juan Rulfo"],
                    contributions: [
                      { author: { name: "Juan Rulfo" }, contribution: null },
                    ],
                    image: {
                      url: "https://assets.hardcover.app/books/284001.jpg",
                    },
                    release_year: 2017,
                    genres: ["Fiction", "Literary"],
                    isbns: ["9585965267", "9789585965263"],
                  },
                },
              ],
            },
          },
        },
      }),
    );
    const books = await new HardcoverApi("tok").getByQuery("pedro paramo");
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      title: "Pedro Páramo",
      author: "Juan Rulfo",
      firstPublishDate: "2017",
      categories: "Fiction, Literary",
      isbn13: "",
      link: "https://hardcover.app/books/pedro-paramo",
      sourceId: "284001",
    });
    expect(sentBody().query).toContain("search(");
  });

  it("tolerates an empty or failed answer", async () => {
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      httpRequestMock.mockResolvedValueOnce(jsonResponse({ data: {} }));
      expect(await new HardcoverApi("tok").getByQuery("x")).toEqual([]);
      httpRequestMock.mockResolvedValueOnce(
        jsonResponse({ errors: [{ message: "field 'nope' not found" }] }),
      );
      expect(await new HardcoverApi("tok").getByQuery("9780156001311")).toEqual(
        [],
      );
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("HardcoverApi.getBook", () => {
  const searchResult = {
    title: "The Name of the Rose",
    author: "Umberto Eco",
    authors: ["Umberto Eco"],
    coverUrl: "https://assets.hardcover.app/books/365331.jpg",
    link: "https://hardcover.app/books/the-name-of-the-rose",
    firstPublishDate: "1980",
    isbn10: "",
    isbn13: "",
    sourceProvider: "hardcover",
    sourceId: "365331",
  };

  it("returns the input book unchanged without a token", async () => {
    expect(await new HardcoverApi("").getBook(searchResult)).toBe(searchResult);
    expect(httpRequestMock).not.toHaveBeenCalled();
  });

  it("costs no second request after an ISBN search", async () => {
    httpRequestMock.mockResolvedValueOnce(
      jsonResponse({
        data: { editions: [{ ...roseHarcourt, book: roseWork }] },
      }),
    );
    const api = new HardcoverApi("tok");
    const [found] = await api.getByQuery("9780156001311");
    const full = await api.getBook(found);
    expect(full.publisher).toBe("Houghton Mifflin Harcourt");
    expect(httpRequestMock).toHaveBeenCalledTimes(1);
  });

  it("makes a picked book's note from one edition in the reader's language", async () => {
    httpRequestMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          books: [
            {
              ...roseWork,
              default_physical_edition: roseHarcourt,
              in_language: [roseSpanish],
              popular: [roseHarcourt],
            },
          ],
        },
      }),
    );
    const book = await new HardcoverApi("tok", "es").getBook(searchResult);
    expect(sentBody().variables).toEqual({ id: 365331, language: "es" });
    // Every edition field from the Spanish edition, none from another one.
    expect(book).toMatchObject({
      title: "El nombre de la rosa",
      isbn13: "9788426411488",
      isbn10: "8426411487",
      publisher: "Lumen",
      publishDate: "1982/03/01",
      totalPage: "607",
      translator: "Ricardo Pochtar",
      language: "Spanish",
      format: "Hardcover",
      coverUrl: "https://assets.hardcover.app/edition/30000001.jpg",
      link: "https://hardcover.app/books/the-name-of-the-rose/editions/30000001",
      firstPublishDate: "1980",
    });
    // The English edition's ASIN does not come along.
    expect(book.asin || "").toBe("");
  });

  it("reads the edition an ISBN names, whatever the reader's language", async () => {
    httpRequestMock.mockResolvedValueOnce(
      jsonResponse({
        data: { editions: [{ ...roseHarcourt, book: roseWork }] },
      }),
    );
    const book = await new HardcoverApi("tok", "es").getBook({
      ...searchResult,
      isbn13: "9780156001311",
    });
    expect(book.title).toBe("The Name of the Rose");
    expect(book.translator).toBe("William Weaver");
  });

  it("returns the book unchanged when Hardcover has no such edition", async () => {
    httpRequestMock.mockResolvedValueOnce(
      jsonResponse({ data: { editions: [] } }),
    );
    const input = { ...searchResult, isbn13: "9780000000002" };
    expect(await new HardcoverApi("tok").getBook(input)).toBe(input);
  });
});

describe("HardcoverApi.editionsLike", () => {
  const goodreadsEdition = {
    title: "The Hobbit, or There and Back Again",
    author: "J.R.R. Tolkien",
    authors: ["J.R.R. Tolkien"],
    coverUrl: "",
    link: "",
    publisher: "Houghton Mifflin",
    totalPage: "366",
    format: "Paperback",
  };

  it("lists the editions of the matching book of about the same length", async () => {
    httpRequestMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            search: {
              results: {
                hits: [
                  // A study guide first, as Hardcover ranks them.
                  {
                    document: {
                      id: 9,
                      title: "The Hobbit Study Guide",
                      author_names: ["BookRags"],
                    },
                  },
                  {
                    document: {
                      id: 1683808,
                      title: "The Hobbit",
                      author_names: ["J.R.R. Tolkien"],
                      users_count: 9000,
                    },
                  },
                ],
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            editions: [
              {
                ...roseHarcourt,
                id: 77,
                title: "The Hobbit",
                isbn_13: "9780618260300",
                isbn_10: "0618260307",
                pages: 366,
                release_date: "2002-08-15",
                publisher: { name: "Houghton Mifflin" },
                contributions: [],
                book: { id: 1683808, slug: "the-hobbit", release_year: 1937 },
              },
            ],
          },
        }),
      );
    const editions = await new HardcoverApi("tok").editionsLike(
      goodreadsEdition,
    );
    expect(sentBody(1).variables).toEqual({
      where: {
        book_id: { _in: [1683808] },
        isbn_13: { _is_null: false },
        pages: { _gte: 365, _lte: 367 },
      },
    });
    expect(editions).toHaveLength(1);
    expect(editions[0]).toMatchObject({
      isbn13: "9780618260300",
      publisher: "Houghton Mifflin",
      totalPage: "366",
      sourceProvider: "hardcover",
    });
  });

  it("asks nothing without a token or a matching book", async () => {
    expect(await new HardcoverApi("").editionsLike(goodreadsEdition)).toEqual(
      [],
    );
    httpRequestMock.mockResolvedValueOnce(
      jsonResponse({ data: { search: { results: { hits: [] } } } }),
    );
    expect(
      await new HardcoverApi("tok").editionsLike(goodreadsEdition),
    ).toEqual([]);
    expect(httpRequestMock).toHaveBeenCalledTimes(1);
  });
});
