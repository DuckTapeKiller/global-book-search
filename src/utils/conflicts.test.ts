import {
  comparableValue,
  displayValue,
  groupConflictValues,
} from "@utils/conflicts";

describe("displayValue", () => {
  it("renders scalars and lists, never [object Object]", () => {
    expect(displayValue("Tor Books")).toBe("Tor Books");
    expect(displayValue(399)).toBe("399");
    expect(displayValue(["Fiction", "Science Fiction"])).toBe(
      "Fiction, Science Fiction",
    );
    expect(displayValue({ a: 1 })).toBe("");
    expect(displayValue(null)).toBe("");
  });
});

describe("comparableValue", () => {
  it("ignores case and spacing only", () => {
    expect(comparableValue("  The Three-Body  Problem ")).toBe(
      "the three-body problem",
    );
    expect(comparableValue("Liu Cixin")).not.toBe(comparableValue("Cixin Liu"));
  });
});

describe("groupConflictValues", () => {
  it("shows two sources that agree as one choice naming both", () => {
    const choices = groupConflictValues([
      {
        value: "The Three-Body Problem",
        source: "Primary Source",
        isQuorum: true,
      },
      { value: "The Three-Body Problem", source: "Goodreads", isQuorum: true },
      { value: "三体", source: "OpenLibrary", isQuorum: false },
    ]);
    expect(choices).toEqual([
      {
        value: "The Three-Body Problem",
        sources: ["Primary Source", "Goodreads"],
        isQuorum: true,
      },
      { value: "三体", sources: ["OpenLibrary"], isQuorum: false },
    ]);
  });

  it("treats values that differ only in case or spacing as the same", () => {
    const choices = groupConflictValues([
      { value: "Tor Books", source: "StoryGraph", isQuorum: false },
      { value: "tor  books", source: "Goodreads", isQuorum: true },
    ]);
    expect(choices).toHaveLength(1);
    expect(choices[0].sources).toEqual(["StoryGraph", "Goodreads"]);
    expect(choices[0].isQuorum).toBe(true);
  });

  it("keeps genuinely different values apart and in their original order", () => {
    const choices = groupConflictValues([
      { value: "Cixin Liu", source: "Primary Source", isQuorum: true },
      { value: "Liu Cixin", source: "Goodreads", isQuorum: false },
    ]);
    expect(choices.map((c) => c.value)).toEqual(["Cixin Liu", "Liu Cixin"]);
  });

  it("marks as most frequent the value most sources gave, not the preferred one", () => {
    const choices = groupConflictValues([
      { value: "Liu Cixin", source: "Goodreads", isQuorum: true },
      { value: "Cixin Liu", source: "StoryGraph", isQuorum: false },
      { value: "Cixin Liu", source: "Hardcover", isQuorum: false },
    ]);
    expect(choices).toEqual([
      { value: "Liu Cixin", sources: ["Goodreads"], isQuorum: false },
      {
        value: "Cixin Liu",
        sources: ["StoryGraph", "Hardcover"],
        isQuorum: true,
      },
    ]);
  });

  it("marks nothing as most frequent on a tie", () => {
    const choices = groupConflictValues([
      { value: "2014/11/11", source: "Goodreads", isQuorum: true },
      { value: "11 Nov 2014", source: "StoryGraph", isQuorum: false },
      { value: "2006", source: "Hardcover", isQuorum: false },
    ]);
    expect(choices.map((c) => c.isQuorum)).toEqual([false, false, false]);
  });

  it("counts a source once, however often it repeats a value", () => {
    const choices = groupConflictValues([
      { value: "472", source: "Goodreads", isQuorum: true },
      { value: "472", source: "Goodreads", isQuorum: true },
      { value: "399", source: "StoryGraph", isQuorum: false },
    ]);
    expect(choices.map((c) => c.isQuorum)).toEqual([false, false]);
  });

  it("does not repeat a source", () => {
    const choices = groupConflictValues([
      { value: "399", source: "Goodreads", isQuorum: false },
      { value: "399", source: "Goodreads", isQuorum: false },
    ]);
    expect(choices[0].sources).toEqual(["Goodreads"]);
  });
});
