import {
  mergeBookData,
  buildGoodreadsDetailRoutes,
  orderRoutesBySticky,
  waybackRawUrl,
  parseLdJsonBook,
  parseOgMetaBook,
  extractApolloSeries,
} from "@apis/goodreads_api";
import { Book } from "@models/book.model";

const searchResultBook: Book = {
  title: "The Hobbit",
  author: "J.R.R. Tolkien",
  authors: ["J.R.R. Tolkien"],
  coverUrl: "https://i.gr-assets.com/images/S/books/5907._SY475_.jpg",
  coverSmallUrl: "https://i.gr-assets.com/images/S/books/5907._SY75_.jpg",
  link: "https://www.goodreads.com/book/show/5907.The_Hobbit",
  previewLink: "https://www.goodreads.com/book/show/5907.The_Hobbit",
  description: "In a hole in the ground there lived a hobbit…",
  publisher: "",
  publishDate: "",
  totalPage: "366",
  isbn10: "",
  isbn13: "",
  categories: "",
  category: "",
  originalTitle: "",
  translator: "",
  narrator: "",
  subtitle: "",
  asin: "",
};

const blankExtraction: Book = {
  title: "",
  author: "",
  authors: [""],
  coverUrl: "",
  coverSmallUrl: "",
  link: "https://www.goodreads.com/book/show/5907.The_Hobbit",
  previewLink: "https://www.goodreads.com/book/show/5907.The_Hobbit",
  description: "",
  publisher: "",
  publishDate: "",
  totalPage: "",
  isbn10: "",
  isbn13: "",
  categories: "",
  category: "",
  originalTitle: "",
  translator: "",
  narrator: "",
  subtitle: "",
  asin: "",
};

describe("mergeBookData", () => {
  it("keeps every search-result field when the extraction is blank", () => {
    const merged = mergeBookData(searchResultBook, blankExtraction);
    expect(merged.title).toBe("The Hobbit");
    expect(merged.author).toBe("J.R.R. Tolkien");
    expect(merged.authors).toEqual(["J.R.R. Tolkien"]);
    expect(merged.coverUrl).toBe(searchResultBook.coverUrl);
    expect(merged.description).toBe(searchResultBook.description);
    expect(merged.totalPage).toBe("366");
  });

  it("prefers extracted values when they are non-empty", () => {
    const extracted: Book = {
      ...blankExtraction,
      title: "The Hobbit, or There and Back Again",
      publisher: "Houghton Mifflin",
      publishDate: "1937/09/21",
      isbn13: "9780547928227",
      categories: "Fantasy, Classics",
      authors: ["J.R.R. Tolkien", "Alan Lee"],
    };
    const merged = mergeBookData(searchResultBook, extracted);
    expect(merged.title).toBe("The Hobbit, or There and Back Again");
    expect(merged.publisher).toBe("Houghton Mifflin");
    expect(merged.publishDate).toBe("1937/09/21");
    expect(merged.isbn13).toBe("9780547928227");
    expect(merged.categories).toBe("Fantasy, Classics");
    expect(merged.authors).toEqual(["J.R.R. Tolkien", "Alan Lee"]);
    // Untouched fields keep search-result values.
    expect(merged.description).toBe(searchResultBook.description);
    expect(merged.totalPage).toBe("366");
  });

  it("does not let whitespace-only strings or empty arrays overwrite data", () => {
    const extracted: Book = {
      ...blankExtraction,
      title: "   ",
      authors: [],
    };
    const merged = mergeBookData(searchResultBook, extracted);
    expect(merged.title).toBe("The Hobbit");
    expect(merged.authors).toEqual(["J.R.R. Tolkien"]);
  });

  it("fills gaps without overwriting (cross-source top-up direction)", () => {
    // mergeBookData(crossSource, goodreads): goodreads wins, cross fills gaps.
    const goodreads = { ...searchResultBook, publisher: "" } as Book;
    const crossSource = {
      ...blankExtraction,
      publisher: "Houghton Mifflin Harcourt",
      isbn13: "9780547928227",
      categories: "Fantasy",
      author: "Someone Else",
    } as Book;
    const merged = mergeBookData(crossSource, goodreads);
    expect(merged.publisher).toBe("Houghton Mifflin Harcourt"); // filled gap
    expect(merged.isbn13).toBe("9780547928227"); // filled gap
    expect(merged.author).toBe("J.R.R. Tolkien"); // goodreads value preserved
  });
});

describe("buildGoodreadsDetailRoutes", () => {
  const canonical = "https://www.goodreads.com/book/show/5907.The_Hobbit";

  it("emits .xml, slug.xml, locale, and canonical routes in priority order", () => {
    const routes = buildGoodreadsDetailRoutes("5907", "The_Hobbit", canonical);
    const kinds = routes.map((r) => r.kind);
    expect(kinds[0]).toBe("xml");
    expect(kinds).toContain("xml-slug");
    expect(kinds).toContain("locale-en");
    expect(kinds).toContain("locale-de");
    expect(kinds[kinds.length - 1]).toBe("canonical");

    const xml = routes.find((r) => r.kind === "xml");
    expect(xml?.url).toBe("https://www.goodreads.com/book/show/5907.xml");
    const en = routes.find((r) => r.kind === "locale-en");
    expect(en?.url).toBe("https://www.goodreads.com/en/book/show/5907");
  });

  it("falls back to just the canonical route when no id is known", () => {
    const routes = buildGoodreadsDetailRoutes("", "", canonical);
    expect(routes).toEqual([{ kind: "canonical", url: canonical }]);
  });

  it("omits slug.xml when no slug is available", () => {
    const routes = buildGoodreadsDetailRoutes("5907", "", canonical);
    expect(routes.some((r) => r.kind === "xml-slug")).toBe(false);
    expect(routes.some((r) => r.kind === "xml")).toBe(true);
  });
});

describe("orderRoutesBySticky", () => {
  const routes = [
    { kind: "xml", url: "a" },
    { kind: "locale-en", url: "b" },
    { kind: "canonical", url: "c" },
  ];

  it("moves the sticky route to the front, preserving the rest", () => {
    const ordered = orderRoutesBySticky(routes, "locale-en");
    expect(ordered.map((r) => r.kind)).toEqual([
      "locale-en",
      "xml",
      "canonical",
    ]);
  });

  it("is a no-op when there is no sticky route", () => {
    expect(orderRoutesBySticky(routes, null)).toEqual(routes);
  });
});

describe("waybackRawUrl", () => {
  it("inserts the id_ raw marker and upgrades to https", () => {
    const snap =
      "http://web.archive.org/web/20250610013249/https://www.goodreads.com/book/show/5907";
    expect(waybackRawUrl(snap)).toBe(
      "https://web.archive.org/web/20250610013249id_/https://www.goodreads.com/book/show/5907",
    );
  });
});

describe("parseLdJsonBook", () => {
  const html = `
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Book","name":"The Hobbit &amp; Back",
     "image":"https://img/cover.jpg","numberOfPages":300,"isbn":"9780547928227",
     "author":[{"@type":"Person","name":"J.R.R. Tolkien"},{"@type":"Person","name":"Alan Lee"}],
     "publisher":"Houghton Mifflin Harcourt","genre":["Fantasy","Classics"]}
    </script>`;

  it("extracts schema.org Book fields", () => {
    const book = parseLdJsonBook(html);
    expect(book.title).toBe("The Hobbit & Back");
    expect(book.isbn13).toBe("9780547928227");
    expect(book.totalPage).toBe("300");
    expect(book.publisher).toBe("Houghton Mifflin Harcourt");
    expect(book.coverUrl).toBe("https://img/cover.jpg");
    expect(book.categories).toBe("Fantasy, Classics");
    expect(book.authors).toEqual(["J.R.R. Tolkien", "Alan Lee"]);
    expect(book.author).toBe("J.R.R. Tolkien");
  });

  it("returns an empty object when there is no Book JSON-LD", () => {
    expect(parseLdJsonBook("<html><body>nope</body></html>")).toEqual({});
    expect(
      parseLdJsonBook(
        '<script type="application/ld+json">{"@type":"WebSite"}</script>',
      ),
    ).toEqual({});
  });

  it("ignores malformed JSON-LD blocks without throwing", () => {
    expect(
      parseLdJsonBook('<script type="application/ld+json">{bad json}</script>'),
    ).toEqual({});
  });
});

describe("parseOgMetaBook", () => {
  it("extracts og:title (stripping the Goodreads suffix), image and description", () => {
    const html = `
      <meta property="og:title" content="The Hobbit | Goodreads" />
      <meta property="og:image" content="https://img/cover.jpg" />
      <meta property="og:description" content="In a hole in the ground&hellip;" />`;
    const book = parseOgMetaBook(html);
    expect(book.title).toBe("The Hobbit");
    expect(book.coverUrl).toBe("https://img/cover.jpg");
    expect(book.description).toContain("In a hole in the ground");
  });

  it("handles content-before-property attribute order", () => {
    const html = `<meta content="My Title" property="og:title">`;
    expect(parseOgMetaBook(html).title).toBe("My Title");
  });

  it("reads the series from an og:title that carries one", () => {
    // Real og:title of https://www.goodreads.com/book/show/601238
    const html = `<meta property="og:title" content="The Colour of Magic (Discworld, #1)" />`;
    const book = parseOgMetaBook(html);
    expect(book.title).toBe("The Colour of Magic (Discworld, #1)");
    expect(book.series).toBe("Discworld");
    expect(book.seriesNumber).toBe("1");
  });

  it("sets no series for a standalone book", () => {
    const html = `<meta property="og:title" content="Sapiens: A Brief History of Humankind | Goodreads" />`;
    const book = parseOgMetaBook(html);
    expect(book.series).toBeUndefined();
    expect(book.seriesNumber).toBeUndefined();
  });
});

// Modelled on the Apollo state of https://www.goodreads.com/book/show/601238
// (The Colour of Magic), keeping only what the series parser reads and with the
// reference ids shortened.
const colourOfMagicApolloState = {
  "Series:kca://series/discworld": {
    __typename: "Series",
    title: "Discworld",
    webUrl: "https://www.goodreads.com/series/40650-discworld",
  },
  "Series:kca://series/rincewind": {
    __typename: "Series",
    title: "Discworld - Rincewind",
    webUrl: "https://www.goodreads.com/series/109518-discworld---rincewind",
  },
  "Series:kca://series/polish": {
    __typename: "Series",
    title: "Kolekcja \u015awiat Dysku",
    webUrl: "https://www.goodreads.com/series/208816-kolekcja-wiat-dysku",
  },
};

const colourOfMagicBook = {
  title: "The Colour of Magic",
  titleComplete: "The Colour of Magic (Discworld, #1)",
  bookSeries: [
    {
      __typename: "BookSeries",
      userPosition: "1",
      series: { __ref: "Series:kca://series/discworld" },
    },
    {
      __typename: "BookSeries",
      userPosition: "1",
      series: { __ref: "Series:kca://series/rincewind" },
    },
    {
      __typename: "BookSeries",
      userPosition: "10",
      series: { __ref: "Series:kca://series/polish" },
    },
  ],
};

describe("extractApolloSeries", () => {
  it("picks the main series of a real book, not its sub-series or collections", () => {
    expect(
      extractApolloSeries(colourOfMagicApolloState, colourOfMagicBook),
    ).toEqual({ series: "Discworld", seriesNumber: "1" });
  });

  it("picks the series named in the full title even when it is not listed first", () => {
    const reordered = {
      ...colourOfMagicBook,
      bookSeries: [...colourOfMagicBook.bookSeries].reverse(),
    };
    expect(extractApolloSeries(colourOfMagicApolloState, reordered)).toEqual({
      series: "Discworld",
      seriesNumber: "1",
    });
  });

  it("takes the first listed series when the title names none", () => {
    const bare = { ...colourOfMagicBook, titleComplete: "The Colour of Magic" };
    expect(extractApolloSeries(colourOfMagicApolloState, bare)).toEqual({
      series: "Discworld",
      seriesNumber: "1",
    });
  });

  it("trusts the listed series over a different one named in the title (real omnibus)", () => {
    // https://www.goodreads.com/book/show/33: the title says "The Lord of the
    // Rings, #1-3" but Goodreads lists only "Middle Earth", positions 2-4.
    const state = {
      "Series:kca://series/middle-earth": { title: "Middle Earth" },
    };
    const omnibus = {
      titleComplete: "The Lord of the Rings (The Lord of the Rings, #1-3)",
      bookSeries: [
        {
          userPosition: "2-4",
          series: { __ref: "Series:kca://series/middle-earth" },
        },
      ],
    };
    expect(extractApolloSeries(state, omnibus)).toEqual({
      series: "Middle Earth",
      seriesNumber: "2-4",
    });
  });

  it("accepts a numeric position", () => {
    const book = {
      titleComplete: "X",
      bookSeries: [
        { userPosition: 2, series: { __ref: "Series:kca://series/discworld" } },
      ],
    };
    expect(extractApolloSeries(colourOfMagicApolloState, book)).toEqual({
      series: "Discworld",
      seriesNumber: "2",
    });
  });

  it("returns an empty number for a series without a position", () => {
    const book = {
      titleComplete: "Short Story",
      bookSeries: [
        {
          userPosition: null,
          series: { __ref: "Series:kca://series/discworld" },
        },
      ],
    };
    expect(extractApolloSeries(colourOfMagicApolloState, book)).toEqual({
      series: "Discworld",
      seriesNumber: "",
    });
  });

  it("falls back to the series in the full title when bookSeries is empty", () => {
    const book = {
      titleComplete: "Fuzzy Nation (Fuzzy Sapiens, #7)",
      bookSeries: [],
    };
    expect(extractApolloSeries({}, book)).toEqual({
      series: "Fuzzy Sapiens",
      seriesNumber: "7",
    });
  });

  it("returns nothing for a standalone book", () => {
    const book = {
      titleComplete: "Sapiens: A Brief History of Humankind",
      bookSeries: [],
    };
    expect(extractApolloSeries({}, book)).toEqual({
      series: "",
      seriesNumber: "",
    });
  });

  it("skips entries whose series cannot be resolved and survives malformed data", () => {
    const book = {
      titleComplete: "X",
      bookSeries: [
        null,
        "junk",
        { userPosition: "1" },
        { userPosition: "2", series: { __ref: "Series:kca://series/missing" } },
        {
          userPosition: "3",
          series: { __ref: "Series:kca://series/discworld" },
        },
      ],
    };
    expect(extractApolloSeries(colourOfMagicApolloState, book)).toEqual({
      series: "Discworld",
      seriesNumber: "3",
    });
    expect(extractApolloSeries(undefined, undefined)).toEqual({
      series: "",
      seriesNumber: "",
    });
  });
});

describe("mergeBookData with series", () => {
  const withSeries: Book = {
    ...searchResultBook,
    series: "Discworld",
    seriesNumber: "1",
  };

  it("keeps the series from the search result when the detail page has none", () => {
    const merged = mergeBookData(withSeries, {
      ...blankExtraction,
      series: "",
      seriesNumber: "",
    });
    expect(merged.series).toBe("Discworld");
    expect(merged.seriesNumber).toBe("1");
  });

  it("never pairs one source's series with another source's number", () => {
    // The detail page names a series without a position; the search result's
    // number belongs to a different series and must not be carried over.
    const merged = mergeBookData(withSeries, {
      ...blankExtraction,
      series: "Middle Earth",
      seriesNumber: "",
    });
    expect(merged.series).toBe("Middle Earth");
    expect(merged.seriesNumber).toBe("");
  });

  it("lets the detail page's series replace the search result's", () => {
    const merged = mergeBookData(withSeries, {
      ...blankExtraction,
      series: "Discworld - Rincewind",
      seriesNumber: "1",
    });
    expect(merged.series).toBe("Discworld - Rincewind");
  });
});
