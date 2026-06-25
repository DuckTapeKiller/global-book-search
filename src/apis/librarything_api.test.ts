import {
  parseCommonKnowledge,
  parseGenres,
  parseAuthor,
  parseWorkPage,
  parseTalpaResults,
  parseOpenLibraryData,
  pickLocalizedEdition,
  stripTags,
} from "@apis/librarything_api";

// A slice of a real archived (Wayback) LibraryThing work page — English locale,
// plain `<dt>Label</dt>` Common Knowledge, un-rewritten /author/ and /genre/ links.
const WORK_HTML = `
<meta property="og:title" content="The Trial by Franz Kafka"/>
<div id="newwork_ck_table"><dl class="loving comfort joined">
<dt>Canonical title</dt><dd>The Trial</dd>
<dt>Original title</dt><dd>Der Prozess</dd>
<dt>Alternate titles*</dt><dd>Der Proceß; Der Process</dd>
<dt>Original publication date</dt><dd>1925-04-26</dd>
<dt>People/Characters</dt><dd><a href="/character/x">Josef K.</a>; <a href="/character/y">Fräulein Bürstner</a></dd>
<dt>Important places</dt><dd>Prague, Czech Republic</dd>
<dt>Last words</dt><dd><span class="note">(Click to show.)</span><span class="hid">"Like a dog!" he said.</span></dd>
<dt>Original language</dt><dd>German</dd>
</dl></div>
<div class="ais_aname"><a href="/author/kafkafranz" >Franz Kafka</a></div>
<div id="section_classification"><dl><dt>Genres</dt><dd>
<a href="/genre/58/Fiction-and-Literature" class="" >Fiction and Literature</a>,
<a href="/genre/8/General-Fiction" class="" >General Fiction</a></dd></dl></div>`;

describe("stripTags", () => {
  it("removes tags and decodes entities", () => {
    expect(stripTags("<a>Der Proce&szlig;</a>")).toBe("Der Proceß");
  });
});

describe("parseCommonKnowledge (English labels)", () => {
  it("maps English dt labels to Book fields", () => {
    const ck = parseCommonKnowledge(WORK_HTML);
    expect(ck.title).toBe("The Trial");
    expect(ck.originalTitle).toBe("Der Prozess");
    expect(ck.publishDate).toBe("1925-04-26");
    expect(ck.characters).toBe("Josef K.; Fräulein Bürstner");
    expect(ck.places).toBe("Prague, Czech Republic");
    expect(ck.originalLanguage).toBe("German");
  });

  it("strips the spoiler prompt from last words", () => {
    const ck = parseCommonKnowledge(WORK_HTML);
    expect(ck.lastWords).toBe('"Like a dog!" he said.');
  });
});

describe("parseGenres / parseAuthor", () => {
  it("extracts genres from the classification section", () => {
    expect(parseGenres(WORK_HTML)).toBe(
      "Fiction and Literature, General Fiction",
    );
  });
  it("extracts the primary author", () => {
    expect(parseAuthor(WORK_HTML)).toBe("Franz Kafka");
  });
});

describe("parseWorkPage", () => {
  it("assembles a Book from the archived page", () => {
    const b = parseWorkPage(
      WORK_HTML,
      "https://www.librarything.com/work/2152",
    );
    expect(b.title).toBe("The Trial");
    expect(b.originalTitle).toBe("Der Prozess");
    expect(b.publishDate).toBe("1925"); // year only
    expect(b.author).toBe("Franz Kafka");
    expect(b.authors).toEqual(["Franz Kafka"]);
    expect(b.categories).toBe("Fiction and Literature, General Fiction");
    expect(b.characters).toBe("Josef K.; Fräulein Bürstner");
    expect(b.originalLanguage).toBe("German");
  });
});

describe("parseTalpaResults", () => {
  const payload = {
    response: {
      results: 161,
      resultlist: [
        {
          rank: 1,
          title: "The Trial",
          work_id: 2152,
          isbns: ["9780805209990", "9780099428657"],
        },
        { rank: 2, title: "No-ISBN Work", work_id: 99999, isbns: [] },
        { rank: 3, title: "Bad", work_id: 0 },
      ],
    },
  };

  it("maps Talpa results to Book stubs with work id + ISBN + cover", () => {
    const books = parseTalpaResults(payload);
    expect(books).toHaveLength(2); // work_id 0 skipped
    expect(books[0].title).toBe("The Trial");
    expect(books[0].sourceId).toBe("2152");
    expect(books[0].sourceProvider).toBe("librarything");
    expect(books[0].isbn13).toBe("9780805209990");
    expect(books[0].coverUrl).toContain("covers.openlibrary.org");
    expect(books[0].link).toBe("https://www.librarything.com/work/2152");
    // no-ISBN result still maps, just without a cover
    expect(books[1].sourceId).toBe("99999");
    expect(books[1].coverUrl).toBe("");
  });

  it("returns [] for an error/empty payload", () => {
    expect(parseTalpaResults({ error: { code: 2 } })).toEqual([]);
    expect(parseTalpaResults(null)).toEqual([]);
  });
});

describe("parseOpenLibraryData", () => {
  it("pulls author + pages + publisher + year + genres + work key (jscmd=details)", () => {
    const json = {
      "ISBN:9780805210408": {
        details: {
          authors: [{ name: "Franz Kafka" }],
          number_of_pages: 281,
          publishers: ["Schocken Books"],
          publish_date: "1995",
          subjects: ["Fiction", "Trials"],
          works: [{ key: "/works/OL498463W" }],
        },
      },
    };
    const d = parseOpenLibraryData(json, "9780805210408");
    expect(d.author).toBe("Franz Kafka");
    expect(d.totalPage).toBe(281);
    expect(d.publisher).toBe("Schocken Books");
    expect(d.publishDate).toBe("1995");
    expect(d.categories).toBe("Fiction, Trials");
    expect(d.workKey).toBe("/works/OL498463W");
  });

  it("returns {} when the ISBN isn't found", () => {
    expect(parseOpenLibraryData({}, "9780000000000")).toEqual({});
  });
});

describe("pickLocalizedEdition", () => {
  const editions = {
    entries: [
      { title: "The Trial", languages: [{ key: "/languages/eng" }] },
      {
        title: "Proceso",
        languages: [{ key: "/languages/spa" }],
        publishers: ["Independently Published"],
      },
      {
        title: "El proceso",
        languages: [{ key: "/languages/spa" }],
        number_of_pages: 308,
        publishers: ["Cátedra"],
        isbn_13: ["9788437608563"],
        covers: [12345],
      },
    ],
  };

  it("picks the best edition in the requested language", () => {
    const e = pickLocalizedEdition(editions, "spa");
    expect(e?.title).toBe("El proceso");
    expect(e?.totalPage).toBe(308);
    expect(e?.publisher).toBe("Cátedra");
    expect(e?.isbn13).toBe("9788437608563");
    expect(e?.coverUrl).toContain("/b/id/12345-L.jpg");
  });

  it("returns null when no edition matches the language", () => {
    expect(pickLocalizedEdition(editions, "fre")).toBeNull();
  });
});
