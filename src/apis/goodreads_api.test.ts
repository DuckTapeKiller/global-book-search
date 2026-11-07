import {
  mergeBookData,
  buildGoodreadsDetailRoutes,
  orderRoutesBySticky,
  waybackRawUrl,
  parseLdJsonBook,
  parseOgMetaBook,
  extractApolloSeries,
  cleanGoodreadsDescription,
  extractNextDataJson,
  parseGoodreadsApollo,
  isSameAuthorSpelling,
  goodreadsWorkId,
  parseGoodreadsEditionsPage,
  printedBookAsin,
} from "@apis/goodreads_api";
import { contributorKind, hardcoverContributorKind } from "@utils/contributors";
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

  it("leaves out Goodreads' slogan, which a book without a description gets", () => {
    // Real og:description of https://www.goodreads.com/book/show/16947642
    const html = `<meta property="og:description" content="Discover and share books you love on Goodreads." />`;
    expect(parseOgMetaBook(html).description).toBeUndefined();
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

describe("contributorKind", () => {
  it.each([
    ["Author", "author"],
    ["", "author"],
    ["Pseudonym", "author"],
    ["Translator", "translator"],
    ["translator", "translator"],
    ["Translation", "translator"],
    ["Traductor", "translator"],
    ["Tradução", "translator"],
    ["Traduction", "translator"],
    ["Übersetzer", "translator"],
    ["trad.", "translator"],
    ["Translator, Introduction", "translator"],
    ["Editor, Translator", "translator"],
    ["Translator, Afterword by", "translator"],
    ["Narrator", "narrator"],
    ["Read by", "narrator"],
    ["Illustrator", "other"],
    ["Ilustração", "other"],
    ["Editor", "other"],
    ["Introduction", "other"],
    ["Adaptación", "other"],
    ["Contributor", "other"],
  ])("reads the role %j as %s", (role, kind) => {
    expect(contributorKind(role)).toBe(kind);
  });
});

describe("cleanGoodreadsDescription", () => {
  it("keeps paragraphs apart instead of gluing their words together", () => {
    expect(
      cleanGoodreadsDescription(
        "The year is 1327.<br /><br />Brother William arrives.",
      ),
    ).toBe("The year is 1327. Brother William arrives.");
  });

  it("drops a librarian note that opens the description", () => {
    expect(
      cleanGoodreadsDescription(
        '<i>Alternate cover for this ISBN can be found <a href="https://www.goodreads.com/book/show/1">here</a></i><br /><br />Un amanecer de 1945, un muchacho…',
      ),
    ).toBe("Un amanecer de 1945, un muchacho…");
    expect(
      cleanGoodreadsDescription(
        "Librarian note: An alternative cover for this ISBN can be found here.<br><br>Raskolnikov, a student…",
      ),
    ).toBe("Raskolnikov, a student…");
  });

  it("keeps a note that is all the description has, and other italic openings", () => {
    expect(
      cleanGoodreadsDescription(
        "<i>Alternate cover edition of ISBN 9780141439518</i>",
      ),
    ).toBe("Alternate cover edition of ISBN 9780141439518");
    expect(
      cleanGoodreadsDescription(
        "<i>The New York Times bestseller</i><br><br>A story.",
      ),
    ).toBe("The New York Times bestseller A story.");
  });

  it("keeps quotation marks as written and decodes entities", () => {
    expect(
      cleanGoodreadsDescription(
        'He said "hello" &amp; left &#8212; &quot;quietly&quot;.',
      ),
    ).toBe('He said "hello" & left — "quietly".');
  });
});

describe("extractNextDataJson", () => {
  it("finds the page data in either attribute order", () => {
    expect(
      extractNextDataJson(
        '<script id="__NEXT_DATA__" type="application/json">{"a":1}</script>',
      ),
    ).toBe('{"a":1}');
    expect(
      extractNextDataJson(
        '<html><script type="application/json" id="__NEXT_DATA__">{"b":2}</script></html>',
      ),
    ).toBe('{"b":2}');
    expect(extractNextDataJson("<html></html>")).toBe("");
  });
});

describe("parseGoodreadsApollo", () => {
  const link = "https://www.goodreads.com/book/show/119073";
  const page = (
    book: Record<string, unknown>,
    more: Record<string, unknown> = {},
  ): string =>
    JSON.stringify({
      props: {
        pageProps: {
          apolloState: {
            ROOT_QUERY: {
              'getBookByLegacyId({"legacyId":"119073"})': { __ref: "Book:1" },
            },
            "Book:1": book,
            "Contributor:1": { name: "Umberto Eco" },
            "Contributor:2": { name: "William  Weaver" },
            "Contributor:3": { name: "Harold Bloom" },
            "Contributor:4": { name: "Silvia Cecchini" },
            "Work:1": {
              details: {
                originalTitle: "Il nome della rosa",
                publicationTime: Date.UTC(1980, 8, 1, 12),
                places: [{ name: "Italy" }, { name: "Melk, Austria" }],
                characters: [
                  { name: "William of Baskerville" },
                  { name: "Adso of Melk" },
                ],
              },
            },
            ...more,
          },
        },
      },
    });

  const roseBook = {
    title: "The Name of the Rose",
    titleComplete: "The Name of the Rose",
    description:
      '<i>An alternative cover edition can be found here</i><br /><br />The year is 1327. "Brother William" arrives.',
    imageUrl: "https://images.gr-assets.com/books/1._SY75_.jpg",
    primaryContributorEdge: {
      role: "Author",
      node: { __ref: "Contributor:1" },
    },
    secondaryContributorEdges: [
      { role: "Translator, Introduction", node: { __ref: "Contributor:2" } },
      { role: "Introduction", node: { __ref: "Contributor:3" } },
    ],
    details: {
      isbn: "0156001314",
      isbn13: "9780156001311",
      asin: "0156001314",
      numPages: 552,
      publisher: " Houghton Mifflin Harcourt ",
      publicationTime: Date.UTC(1994, 8, 28, 12),
      format: "Paperback",
      language: { name: "Spanish; Castilian" },
    },
    work: { __ref: "Work:1" },
    bookGenres: [
      { genre: { name: "Fiction" } },
      { genre: { name: "Mystery" } },
    ],
    bookSeries: [],
  };

  it("reads every field Goodreads has for the edition", () => {
    const book = parseGoodreadsApollo(page(roseBook), link);
    expect(book).toMatchObject({
      title: "The Name of the Rose",
      author: "Umberto Eco",
      authors: ["Umberto Eco"],
      translator: "William Weaver",
      narrator: "",
      isbn10: "0156001314",
      isbn13: "9780156001311",
      asin: "0156001314",
      totalPage: "552",
      publisher: "Houghton Mifflin Harcourt",
      publishDate: "1994/09/28",
      format: "Paperback",
      language: "Spanish",
      originalTitle: "Il nome della rosa",
      firstPublishDate: "1980/09/01",
      places: "Italy; Melk, Austria",
      characters: "William of Baskerville, Adso of Melk",
      categories: "Fiction, Mystery",
      description: 'The year is 1327. "Brother William" arrives.',
      coverUrl: "https://images.gr-assets.com/books/1._SY475_.jpg",
      link,
      series: "",
    });
  });

  it("reads an audiobook's narrator and leaves its page count empty", () => {
    const book = parseGoodreadsApollo(
      page({
        ...roseBook,
        secondaryContributorEdges: [
          { role: "Narrator", node: { __ref: "Contributor:4" } },
        ],
        details: { asin: "B01BY1OLEY", format: "Audible Audio" },
      }),
      link,
    );
    expect(book?.narrator).toBe("Silvia Cecchini");
    expect(book?.translator).toBe("");
    expect(book?.totalPage).toBe("");
    expect(book?.isbn13).toBe("");
    expect(book?.asin).toBe("B01BY1OLEY");
  });

  it("names the primary contributor as author when nobody has the Author role", () => {
    const book = parseGoodreadsApollo(
      page({
        ...roseBook,
        primaryContributorEdge: {
          role: "Editor",
          node: { __ref: "Contributor:3" },
        },
        secondaryContributorEdges: [],
      }),
      link,
    );
    expect(book?.authors).toEqual(["Harold Bloom"]);
  });

  it("returns null for a page without book data", () => {
    expect(parseGoodreadsApollo("not json", link)).toBeNull();
    expect(
      parseGoodreadsApollo(
        JSON.stringify({ props: { pageProps: { apolloState: {} } } }),
        link,
      ),
    ).toBeNull();
  });

  it("reads a printed edition's ISBN from its ASIN when Goodreads has no ISBN", () => {
    // The Shadow of the Wind, Penguin (book 1232): no ISBN, ASIN 0143034901.
    const book = parseGoodreadsApollo(
      page({
        ...roseBook,
        details: {
          ...roseBook.details,
          isbn: null,
          isbn13: null,
          asin: "0143034901",
        },
      }),
      link,
    );
    expect(book?.isbn10).toBe("0143034901");
    expect(book?.isbn13).toBe("9780143034902");
    expect(book?.asin).toBe("0143034901");
  });

  it("takes no ISBN from a Kindle ASIN or an ASIN of another edition", () => {
    const kindle = parseGoodreadsApollo(
      page({
        ...roseBook,
        details: {
          ...roseBook.details,
          isbn: null,
          isbn13: null,
          asin: "B00ABCDE12",
        },
      }),
      link,
    );
    expect(kindle?.isbn10).toBe("");
    expect(kindle?.isbn13).toBe("");
    const other = parseGoodreadsApollo(
      page({
        ...roseBook,
        details: { ...roseBook.details, isbn: null, asin: "0143034901" },
      }),
      link,
    );
    expect(other?.isbn13).toBe("9780156001311");
    expect(other?.isbn10).toBe("");
  });
});

describe("isSameAuthorSpelling", () => {
  it("joins one author's spellings", () => {
    expect(
      isSameAuthorSpelling("Fyodor Dostoevsky", "Fyodor Dostoyevsky"),
    ).toBe(true);
    expect(
      isSameAuthorSpelling("Fyodor Dostoevsky", "Fiódor Dostoiévski"),
    ).toBe(true);
    expect(isSameAuthorSpelling("J.R.R. Tolkien", "J. R. R. Tolkien")).toBe(
      true,
    );
  });

  it("never merges co-authors", () => {
    expect(isSameAuthorSpelling("Neil Gaiman", "Terry Pratchett")).toBe(false);
    expect(isSameAuthorSpelling("Ann VanderMeer", "Jeff VanderMeer")).toBe(
      false,
    );
    expect(isSameAuthorSpelling("Joe Hill", "Joe Hall")).toBe(false);
    expect(isSameAuthorSpelling("刘慈欣", "劉慈欣")).toBe(false);
  });
});

describe("hardcoverContributorKind", () => {
  it.each([
    ["Author", "author"],
    ["", "author"],
    ["Co-Author", "author"],
    ["Writer", "author"],
    ["Original Author", "author"],
    ["Translator", "translator"],
    ["Translation", "translator"],
    ["Narrator", "narrator"],
    ["Narration", "narrator"],
    ["Reader", "narrator"],
    ["Reading", "narrator"],
    ["Voice Actor", "narrator"],
    ["Illustrator", "other"],
    ["Editor", "other"],
    ["Introduction", "other"],
    ["Afterword", "other"],
    ["Transliteration", "other"],
  ])("reads Hardcover's role %j as %s", (role, kind) => {
    expect(hardcoverContributorKind(role)).toBe(kind);
  });
});

describe("goodreadsWorkId", () => {
  it("reads the work of a book page", () => {
    const json = JSON.stringify({
      props: {
        pageProps: {
          apolloState: {
            ROOT_QUERY: {
              'getBookByLegacyId({"legacyId":"11297"})': { __ref: "Book:1" },
            },
            "Book:1": { work: { __ref: "Work:1" } },
            "Work:1": { legacyId: 2956680 },
          },
        },
      },
    });
    expect(goodreadsWorkId(json)).toBe("2956680");
  });

  it("gives nothing for a page without data", () => {
    expect(goodreadsWorkId("")).toBe("");
    expect(goodreadsWorkId("{not json")).toBe("");
  });
});

describe("parseGoodreadsEditionsPage", () => {
  // Shaped like goodreads.com/work/editions/2956680 (Norwegian Wood).
  const edition = (rows: string, details: string): string => `
    <div class="elementList clearFix">
      <div class="leftAlignedImage"><a href="/book/show/1"><img alt="" src="" /></a></div>
      <div class="editionData">
        ${rows}
        <div class="moreDetails hideDetails">
          <div class="dataRow"><div class="dataTitle"> Author(s): </div><div class="dataValue">Haruki Murakami</div></div>
          ${details}
        </div>
      </div>
    </div>`;
  const html = [
    edition(
      `<div class="dataRow"><a class="bookTitle" href="/book/show/11297">Norwegian Wood (Paperback)</a></div>
       <div class="dataRow"> Published September 12th 2000 by Vintage Books </div>
       <div class="dataRow"> First Edition, Paperback, 296 pages </div>`,
      `<div class="dataRow"><div class="dataTitle"> Edition language: </div><div class="dataValue"> English </div></div>`,
    ),
    edition(
      `<div class="dataRow"><a class="bookTitle" href="/book/show/243736115">Norwegian Wood (Paperback)</a></div>
       <div class="dataRow"> Published August 2025 by Vintage Books </div>
       <div class="dataRow"> Paperback, 296 pages </div>`,
      `<div class="dataRow"><div class="dataTitle"> ISBN: </div><div class="dataValue"> 9780375704024 <span class="greyText"> (ISBN10: 0375704027) </span></div></div>
       <div class="dataRow"><div class="dataTitle"> ASIN: </div><div class="dataValue"> 0375704027 </div></div>
       <div class="dataRow"><div class="dataTitle"> Edition language: </div><div class="dataValue"> English </div></div>`,
    ),
    edition(
      `<div class="dataRow"><a class="bookTitle" href="/book/show/2">Tokio Blues: Norwegian Wood (Mass Market Paperback)</a></div>
       <div class="dataRow"> Published May 6th 2007 by Tusquets Editores S.A. </div>
       <div class="dataRow"> Mass Market Paperback, 384 pages </div>`,
      `<div class="dataRow"><div class="dataTitle"> ISBN: </div><div class="dataValue"> 9788483835043 <span class="greyText"> (ISBN10: 8483835045) </span></div></div>
       <div class="dataRow"><div class="dataTitle"> Edition language: </div><div class="dataValue"> Spanish </div></div>`,
    ),
  ].join("\n");

  it("reads every edition's details", () => {
    const editions = parseGoodreadsEditionsPage(html);
    expect(editions).toHaveLength(3);
    expect(editions[0]).toMatchObject({
      title: "Norwegian Wood",
      format: "Paperback",
      publisher: "Vintage Books",
      publishDate: "2000/09/12",
      totalPage: "296",
      isbn13: "",
      isbn10: "",
      language: "English",
    });
    expect(editions[1]).toMatchObject({
      publishDate: "2025/08",
      isbn13: "9780375704024",
      isbn10: "0375704027",
    });
    expect(editions[2]).toMatchObject({
      title: "Tokio Blues: Norwegian Wood",
      format: "Mass Market Paperback",
      publisher: "Tusquets Editores S.A.",
      language: "Spanish",
    });
  });

  it("gives nothing for a page without editions", () => {
    expect(parseGoodreadsEditionsPage("<html></html>")).toEqual([]);
  });
});

describe("printedBookAsin", () => {
  it.each([
    ["B0DN8P5BQF", "Paperback", ""],
    ["B0DN8P5BQF", "Mass Market Paperback", ""],
    ["B0DN8P5BQF", "Hardcover", ""],
    ["B0DN8P5BQF", "Kindle Edition", "B0DN8P5BQF"],
    ["B0DN8P5BQF", "Audible Audio", "B0DN8P5BQF"],
    ["0156001314", "Paperback", "0156001314"],
    ["B0DN8P5BQF", "", "B0DN8P5BQF"],
  ])("%j on a %j edition → %j", (asin, format, expected) => {
    expect(printedBookAsin(asin, format)).toBe(expected);
  });
});
