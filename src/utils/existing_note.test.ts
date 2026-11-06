import {
  findExistingBookNote,
  frontmatterIsbns,
  isInFolder,
  normalizeIsbn,
  toIsbn13,
} from "@utils/existing_note";

// A textbook ISBN pair: 0-306-40615-2 is 978-0-306-40615-7.
const ISBN10 = "0306406152";
const ISBN13 = "9780306406157";

describe("normalizeIsbn", () => {
  it("keeps only the digits of a 10- or 13-character ISBN", () => {
    expect(normalizeIsbn("978-0-306-40615-7")).toBe(ISBN13);
    expect(normalizeIsbn(" 0-306-40615-2 ")).toBe(ISBN10);
    expect(normalizeIsbn("080442957x")).toBe("080442957X");
  });

  it("accepts a YAML number", () => {
    expect(normalizeIsbn(9780306406157)).toBe(ISBN13);
  });

  it("rejects anything that is not an ISBN", () => {
    for (const value of ["", "abc", "12345", null, undefined, {}, []]) {
      expect(normalizeIsbn(value)).toBe("");
    }
  });
});

describe("toIsbn13", () => {
  it("converts an ISBN-10 with the correct check digit", () => {
    expect(toIsbn13(ISBN10)).toBe(ISBN13);
    expect(toIsbn13("0552124753")).toBe("9780552124751");
  });

  it("keeps an ISBN-13 and rejects other lengths", () => {
    expect(toIsbn13(ISBN13)).toBe(ISBN13);
    expect(toIsbn13("123")).toBe("");
  });
});

describe("frontmatterIsbns", () => {
  it("reads the spellings the shipped templates and users write", () => {
    for (const key of [
      "isbn 13",
      "isbn13",
      "isbn_13",
      "ISBN-13",
      "ISBN 13",
      "isbn",
    ]) {
      expect(frontmatterIsbns({ [key]: ISBN13 })).toEqual([ISBN13]);
    }
    expect(frontmatterIsbns({ "isbn 10": ISBN10 })).toEqual([ISBN10]);
    expect(frontmatterIsbns({ ids: ISBN13 })).toEqual([ISBN13]);
  });

  it("normalises values, reads lists and ignores other keys", () => {
    expect(
      frontmatterIsbns({
        Title: "9780000000002",
        "isbn 13": "978-0-306-40615-7",
        isbn: [ISBN13, "0-306-40615-2", "junk"],
        Pages: 399,
      }),
    ).toEqual([ISBN13, ISBN10]);
  });
});

describe("isInFolder", () => {
  it("respects folder boundaries", () => {
    expect(isInFolder("Books/A.md", "Books")).toBe(true);
    expect(isInFolder("Books/Sub/A.md", "Books/")).toBe(true);
    expect(isInFolder("Books2/A.md", "Books")).toBe(false);
    expect(isInFolder("A.md", "Books")).toBe(false);
  });

  it("matches everything when no folder is set", () => {
    expect(isInFolder("anywhere/A.md", "")).toBe(true);
  });
});

describe("findExistingBookNote", () => {
  type FakeFile = { path: string; basename: string };
  const note = (path: string): FakeFile => ({
    path,
    basename: path.split("/").pop()!.replace(/\.md$/, ""),
  });

  function vault(entries: Array<[string, Record<string, unknown>?]>) {
    const files = entries.map(([path]) => note(path));
    const frontmatter = new Map(entries.map(([path, fm]) => [path, fm]));
    return {
      vault: { getMarkdownFiles: () => files },
      metadataCache: {
        getFileCache: (file: { path: string }) => {
          const fm = frontmatter.get(file.path);
          return fm ? { frontmatter: fm } : null;
        },
      },
    };
  }

  const book = {
    title: "The Colour of Magic",
    isbns: [ISBN13],
    fileName: "The Colour of Magic - Terry Pratchett",
  };

  it("finds a note made from a shipped template (isbn 13 with a space)", () => {
    const app = vault([["Books/Renamed by me.md", { "isbn 13": ISBN13 }]]);
    expect(findExistingBookNote(app, "Books", book)?.path).toBe(
      "Books/Renamed by me.md",
    );
  });

  it("matches an ISBN-10 note to an ISBN-13 book and the other way round", () => {
    const app = vault([["Books/X.md", { "isbn 10": ISBN10 }]]);
    expect(findExistingBookNote(app, "Books", book)?.path).toBe("Books/X.md");
    const app13 = vault([["Books/Y.md", { isbn13: ISBN13 }]]);
    expect(
      findExistingBookNote(app13, "Books", { ...book, isbns: [ISBN10] })?.path,
    ).toBe("Books/Y.md");
  });

  it("finds a note by the file name a new note would get", () => {
    const app = vault([["Books/The Colour of Magic - Terry Pratchett.md", {}]]);
    expect(
      findExistingBookNote(app, "Books", { ...book, isbns: [] })?.path,
    ).toBe("Books/The Colour of Magic - Terry Pratchett.md");
  });

  it("still finds a note named after the bare title", () => {
    const app = vault([["Books/the colour of magic.md"]]);
    expect(
      findExistingBookNote(app, "Books", { ...book, isbns: [] })?.path,
    ).toBe("Books/the colour of magic.md");
  });

  it("prefers an ISBN match over a name match", () => {
    const app = vault([
      ["Books/The Colour of Magic - Terry Pratchett.md", {}],
      ["Books/Other edition.md", { isbn: ISBN13 }],
    ]);
    expect(findExistingBookNote(app, "Books", book)?.path).toBe(
      "Books/Other edition.md",
    );
  });

  it("ignores notes outside the notes folder, including look-alike folders", () => {
    const app = vault([
      ["Books2/A.md", { isbn13: ISBN13 }],
      ["Elsewhere/The Colour of Magic - Terry Pratchett.md", {}],
    ]);
    expect(findExistingBookNote(app, "Books", book)).toBeNull();
  });

  it("does not match a different book or a partial title", () => {
    const app = vault([
      ["Books/It.md", { isbn13: "9781501142970" }],
      ["Books/The Colour of Magic and more.md", {}],
    ]);
    expect(findExistingBookNote(app, "Books", book)).toBeNull();
  });
});
