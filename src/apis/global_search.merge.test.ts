jest.mock("@settings/settings", () => ({
  DefaultFrontmatterKeyType: {
    snakeCase: "Snake Case",
    camelCase: "Camel Case",
  },
}));

import type { BookSearchPluginSettings } from "@settings/settings";
import { BookWithSource, mergeWithConflicts } from "@apis/global_search";
import { samePerson } from "@utils/contributors";

const settings = {
  fieldSourcePreferences: {},
} as unknown as BookSearchPluginSettings;

const source = (
  id: string,
  label: string,
  extra: Partial<BookWithSource> = {},
): BookWithSource => ({
  title: "The Colour of Magic",
  author: "Terry Pratchett",
  authors: ["Terry Pratchett"],
  coverUrl: "",
  link: "",
  _sourceIds: [id],
  _sourceLabels: [label],
  ...extra,
});

describe("mergeWithConflicts: series", () => {
  it("brings the series in from Goodreads when another provider is primary", () => {
    const google = source("google", "Google Books");
    const goodreads = source("goodreads", "Goodreads", {
      series: "Discworld",
      seriesNumber: "1",
    });

    const { merged, contributingSources } = mergeWithConflicts(
      google,
      goodreads,
      [],
      settings,
      "google",
    );

    expect(merged.series).toBe("Discworld");
    expect(merged.seriesNumber).toBe("1");
    expect(contributingSources).toContain("Goodreads");
  });

  it("takes a series and its number from the same source, never mixing two", () => {
    // The primary names a series without a number; Goodreads has a different
    // series with a number. The number must not be paired with the wrong name.
    const primary = source("calibre", "Calibre", { series: "Discworld" });
    const goodreads = source("goodreads", "Goodreads", {
      series: "Discworld - Rincewind",
      seriesNumber: "1",
    });

    const { merged } = mergeWithConflicts(
      primary,
      goodreads,
      [],
      settings,
      "calibre",
    );

    expect(merged.series).toBe("Discworld");
    expect(merged.seriesNumber).toBeUndefined();
  });

  it("prefers the primary source's series over a secondary's", () => {
    const calibre = source("calibre", "Calibre", {
      series: "My Own Series Name",
      seriesNumber: 3,
    });
    const goodreads = source("goodreads", "Goodreads", {
      series: "Discworld",
      seriesNumber: "1",
    });

    const { merged } = mergeWithConflicts(
      calibre,
      goodreads,
      [],
      settings,
      "calibre",
    );

    expect(merged.series).toBe("My Own Series Name");
    expect(merged.seriesNumber).toBe(3);
  });

  it("leaves a book without any series alone", () => {
    const { merged } = mergeWithConflicts(
      source("google", "Google Books"),
      null,
      [],
      settings,
      "google",
    );
    expect(merged.series).toBeUndefined();
    expect(merged.seriesNumber).toBeUndefined();
  });

  it("falls back to a secondary source when neither primary nor Goodreads has one", () => {
    const secondary = source("storygraph", "StoryGraph", {
      series: "Discworld",
      seriesNumber: "1",
    });
    const { merged } = mergeWithConflicts(
      source("google", "Google Books"),
      null,
      [secondary],
      settings,
      "google",
    );
    expect(merged.series).toBe("Discworld");
    expect(merged.seriesNumber).toBe("1");
  });
});

describe("mergeWithConflicts: source names in conflicts", () => {
  it("names the primary source even when its book carries no search labels", () => {
    // StoryGraph's getBook returns a plain Book, as an edition chosen in the
    // edition picker does.
    const storygraph: BookWithSource = {
      ...source("storygraph", "StoryGraph"),
      _sourceIds: [],
      _sourceLabels: [],
      publisher: "Harcourt",
    };
    const goodreads = source("goodreads", "Goodreads", {
      publisher: "Houghton Mifflin Harcourt",
    });

    const { conflicts } = mergeWithConflicts(
      storygraph,
      goodreads,
      [],
      settings,
      "storygraph",
    );

    const publisher = conflicts.find((c) => c.fieldName === "publisher");
    expect(publisher?.values.map((v) => v.source)).toEqual([
      "StoryGraph",
      "Goodreads",
    ]);
  });
});

describe("mergeWithConflicts: Goodreads edition and work details", () => {
  it("brings characters, places, language and first publication in from Goodreads", () => {
    const storygraph = source("storygraph", "StoryGraph");
    const goodreads = source("goodreads", "Goodreads", {
      characters: "Rincewind, Twoflower",
      places: "Ankh-Morpork",
      language: "English",
      firstPublishDate: "1983/11/24",
      format: "Paperback",
    });

    const { merged } = mergeWithConflicts(
      storygraph,
      goodreads,
      [],
      settings,
      "storygraph",
    );

    expect(merged).toMatchObject({
      characters: "Rincewind, Twoflower",
      places: "Ankh-Morpork",
      language: "English",
      firstPublishDate: "1983/11/24",
      format: "Paperback",
    });
  });

  it("keeps LibraryThing's Common Knowledge when LibraryThing is a secondary source", () => {
    const goodreads = source("goodreads", "Goodreads");
    const librarything = source("librarything", "LibraryThing", {
      firstWords: "The sun shone, having no alternative, on the nothing new.",
      dedication: "For my wife",
    });

    const { merged } = mergeWithConflicts(
      goodreads,
      null,
      [librarything],
      settings,
      "goodreads",
    );

    expect(merged.firstWords).toBe(
      "The sun shone, having no alternative, on the nothing new.",
    );
    expect(merged.dedication).toBe("For my wife");
  });
});

describe("mergeWithConflicts: translators credited as authors", () => {
  const potter = (id: string, label: string, extra: Partial<BookWithSource>) =>
    source(id, label, {
      title: "Harry Potter y la piedra filosofal",
      author: "J.K. Rowling",
      authors: ["J.K. Rowling"],
      ...extra,
    });

  it("drops an author another source credits only as translator", () => {
    // Goodreads book 15868 credits the translator as an author.
    const goodreads = potter("goodreads", "Goodreads", {
      authors: ["J.K. Rowling", "Alicia Dellepiane"],
    });
    const hardcover = potter("hardcover", "Hardcover", {
      translator: "Alicia Dellepiane Rawson",
    });
    const { merged } = mergeWithConflicts(
      goodreads,
      goodreads,
      [hardcover],
      settings,
      "goodreads",
    );
    expect(merged.authors).toEqual(["J.K. Rowling"]);
    expect(merged.author).toBe("J.K. Rowling");
  });

  it("keeps an author who translated their own book", () => {
    const beckett = (id: string, label: string) =>
      source(id, label, {
        title: "Waiting for Godot",
        author: "Samuel Beckett",
        authors: ["Samuel Beckett"],
        translator: "Samuel Beckett",
      });
    const { merged } = mergeWithConflicts(
      beckett("goodreads", "Goodreads"),
      null,
      [beckett("hardcover", "Hardcover")],
      settings,
      "goodreads",
    );
    expect(merged.authors).toEqual(["Samuel Beckett"]);
  });

  it("never leaves a book without an author", () => {
    const goodreads = potter("goodreads", "Goodreads", {
      author: "Alicia Dellepiane",
      authors: ["Alicia Dellepiane"],
    });
    const hardcover = potter("hardcover", "Hardcover", {
      translator: "Alicia Dellepiane",
    });
    const { merged } = mergeWithConflicts(
      goodreads,
      null,
      [hardcover],
      settings,
      "goodreads",
    );
    expect(merged.authors).toEqual(["Alicia Dellepiane"]);
  });
});

describe("samePerson", () => {
  it.each([
    ["Alicia Dellepiane", "Alicia Dellepiane Rawson", true],
    ["Gabriel García Márquez", "Gabriel Garcia Marquez", true],
    ["J.K. Rowling", "J. K. Rowling", true],
    ["A. Smith", "B. Smith", false],
    ["Gabriel", "Gabriel García Márquez", false],
    ["Richard Pevear", "Larissa Volokhonsky", false],
    ["", "Anyone", false],
  ])("%j and %j → %s", (a, b, expected) => {
    expect(samePerson(a, b)).toBe(expected);
  });
});
