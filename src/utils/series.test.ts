import { Book } from "@models/book.model";
import {
  applySeriesFields,
  formatSeriesLink,
  parseSeriesFromTitle,
  seriesFromTitle,
} from "@utils/series";

describe("parseSeriesFromTitle", () => {
  it("splits a Goodreads title into title, series and number", () => {
    expect(parseSeriesFromTitle("The Colour of Magic (Discworld, #1)")).toEqual(
      {
        title: "The Colour of Magic",
        series: "Discworld",
        seriesNumber: "1",
      },
    );
  });

  it.each([
    ["Dune (Dune Chronicles #1)", "Dune", "Dune Chronicles", "1"],
    ["Novella (Some Series, #0.5)", "Novella", "Some Series", "0.5"],
    ["Omnibus (Some Series, #1-3)", "Omnibus", "Some Series", "1-3"],
    ["Omnibus (Some Series, #1 – 3)", "Omnibus", "Some Series", "1-3"],
    ["Fuzzy Nation (Fuzzy Sapiens, #7)", "Fuzzy Nation", "Fuzzy Sapiens", "7"],
    [
      "Simon vs. the Homo Sapiens Agenda (Simonverse, #1)",
      "Simon vs. the Homo Sapiens Agenda",
      "Simonverse",
      "1",
    ],
  ])("parses %s", (raw, title, series, seriesNumber) => {
    expect(parseSeriesFromTitle(raw)).toEqual({ title, series, seriesNumber });
  });

  it("keeps a comma inside the series name", () => {
    expect(
      parseSeriesFromTitle("Fellowship (Lord of the Rings, The, #1)"),
    ).toEqual({
      title: "Fellowship",
      series: "Lord of the Rings, The",
      seriesNumber: "1",
    });
  });

  it("only reads the last parenthesis and leaves earlier ones in the title", () => {
    expect(parseSeriesFromTitle("Mort (Illustrated) (Discworld, #4)")).toEqual({
      title: "Mort (Illustrated)",
      series: "Discworld",
      seriesNumber: "4",
    });
  });

  it.each([
    "Sapiens: A Brief History of Humankind",
    "Dune (Special Edition)",
    "Title (Part 2)",
    "Title (#1)",
    "(Series, #1)",
    "Title (Series, #)",
    "Title (Series, #one)",
    "Title (Series, #1) extra",
    "",
  ])("does not treat %p as a series title", (raw) => {
    expect(parseSeriesFromTitle(raw)).toBeNull();
  });

  it("tolerates a missing title", () => {
    expect(parseSeriesFromTitle(undefined as unknown as string)).toBeNull();
  });
});

describe("seriesFromTitle", () => {
  it("returns the series fields to spread into a book", () => {
    expect(seriesFromTitle("Dune (Dune Chronicles, #1)")).toEqual({
      series: "Dune Chronicles",
      seriesNumber: "1",
    });
  });

  it("returns an empty object for a title without a series", () => {
    expect(seriesFromTitle("Sapiens")).toEqual({});
  });
});

describe("formatSeriesLink", () => {
  it("wraps the series in a wikilink", () => {
    expect(formatSeriesLink("Discworld")).toBe("[[Discworld]]");
    expect(formatSeriesLink("Discworld - Rincewind")).toBe(
      "[[Discworld - Rincewind]]",
    );
  });

  it("keeps punctuation that is legal in a file name", () => {
    expect(formatSeriesLink("Dr. Seuss' Beginner Books, 2nd Series")).toBe(
      "[[Dr. Seuss' Beginner Books, 2nd Series]]",
    );
  });

  it("drops characters that would break a link or file name", () => {
    expect(formatSeriesLink('A [Bad] #Name^ | x/y\\z: *?"<>')).toBe(
      "[[A Bad Name xyz]]",
    );
  });

  it("collapses whitespace and returns nothing for an empty result", () => {
    expect(formatSeriesLink("  The   Wheel  of Time ")).toBe(
      "[[The Wheel of Time]]",
    );
    expect(formatSeriesLink("")).toBe("");
    expect(formatSeriesLink("#^[]")).toBe("");
  });
});

describe("applySeriesFields", () => {
  const bookWith = (extra: Partial<Book>): Book => ({
    title: "The Colour of Magic",
    author: "Terry Pratchett",
    authors: ["Terry Pratchett"],
    coverUrl: "",
    link: "",
    ...extra,
  });

  it("derives the link when series linking is enabled", () => {
    const book = bookWith({ series: "Discworld", seriesNumber: "1" });
    applySeriesFields(book, true);
    expect(book.series).toBe("Discworld");
    expect(book.seriesNumber).toBe("1");
    expect(book.seriesLink).toBe("[[Discworld]]");
  });

  it("leaves the link empty but keeps the series when linking is disabled", () => {
    const book = bookWith({ series: "Discworld", seriesNumber: 1 });
    applySeriesFields(book, false);
    expect(book.series).toBe("Discworld");
    expect(book.seriesNumber).toBe(1);
    expect(book.seriesLink).toBe("");
  });

  it("overrides a link a provider may have supplied", () => {
    const book = bookWith({ series: "Discworld", seriesLink: "[[Stale]]" });
    applySeriesFields(book, false);
    expect(book.seriesLink).toBe("");
    applySeriesFields(book, true);
    expect(book.seriesLink).toBe("[[Discworld]]");
  });

  it("gives a book without a series an empty series and link", () => {
    const book = bookWith({});
    applySeriesFields(book, true);
    expect(book.series).toBe("");
    expect(book.seriesLink).toBe("");
  });

  it("trims the series name", () => {
    const book = bookWith({ series: "  Discworld  " });
    applySeriesFields(book, true);
    expect(book.series).toBe("Discworld");
    expect(book.seriesLink).toBe("[[Discworld]]");
  });
});
