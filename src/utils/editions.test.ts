import {
  formatFamily,
  isSameEdition,
  pickSameEdition,
  publisherKey,
  sameTitle,
  titleKey,
} from "@utils/editions";

describe("titleKey", () => {
  it.each([
    [
      "The Shadow of the Wind (The Cemetery of Forgotten Books, #1)",
      "the shadow of the wind",
    ],
    ["The Hobbit, or There and Back Again", "the hobbit"],
    ["Tokio Blues: Norwegian Wood", "tokio blues"],
    ["Cien años de soledad", "cien anos de soledad"],
  ])("%j → %j", (title, key) => {
    expect(titleKey(title)).toBe(key);
  });

  it("does not take one book for another that starts the same", () => {
    expect(sameTitle("Dune", "Dune Messiah")).toBe(false);
  });
});

describe("publisherKey", () => {
  it("treats ways of writing one publisher alike", () => {
    expect(publisherKey("Faber & Faber")).toBe(
      publisherKey("Faber and Faber Limited"),
    );
    expect(publisherKey("Tusquets Editores, S.A.")).toBe(
      publisherKey("Tusquets Editores"),
    );
  });

  it("keeps different imprints apart", () => {
    expect(publisherKey("Vintage Books")).not.toBe(publisherKey("Vintage"));
    expect(publisherKey("Houghton Mifflin")).not.toBe(
      publisherKey("Houghton Mifflin Harcourt"),
    );
  });
});

describe("formatFamily", () => {
  it.each([
    ["Paperback", "paperback"],
    ["Mass Market Paperback", "paperback"],
    ["Trade Paperback", "paperback"],
    ["Hardcover", "hardcover"],
    ["Kindle Edition", "ebook"],
    ["Audible Audio", "audio"],
    ["Library Binding", "library binding"],
    ["", ""],
  ])("%j → %j", (format, family) => {
    expect(formatFamily(format)).toBe(family);
  });
});

describe("isSameEdition", () => {
  // Goodreads book 11297: Norwegian Wood without an ISBN.
  const wanted = {
    title: "Norwegian Wood",
    publisher: "Vintage Books",
    totalPage: "296",
    format: "Paperback",
    language: "English",
  };

  it("matches its twin, a page either way", () => {
    expect(isSameEdition(wanted, { ...wanted, totalPage: "297" })).toBe(true);
  });

  it.each([
    ["another publisher", { publisher: "Vintage" }],
    ["another length", { totalPage: "389" }],
    ["another binding", { format: "Library Binding" }],
    ["another language", { language: "Spanish" }],
    ["another title", { title: "Tokio blues" }],
  ])("rejects %s", (_reason, change) => {
    expect(isSameEdition(wanted, { ...wanted, ...change })).toBe(false);
  });

  it("needs two of publisher, pages and binding on both sides", () => {
    expect(
      isSameEdition(wanted, {
        title: "Norwegian Wood",
        publisher: "Vintage Books",
      }),
    ).toBe(false);
    expect(
      isSameEdition(wanted, {
        title: "Norwegian Wood",
        publisher: "Vintage Books",
        totalPage: 296,
      }),
    ).toBe(true);
  });
});

describe("pickSameEdition", () => {
  const wanted = {
    title: "Norwegian Wood",
    publisher: "Vintage Books",
    totalPage: "296",
    format: "Paperback",
  };
  const twin = { ...wanted, isbn13: "9780375704024" };

  it("picks the one twin with an ISBN", () => {
    expect(
      pickSameEdition(wanted, [
        { ...wanted },
        twin,
        { ...wanted, publisher: "Vintage", isbn13: "9780307950628" },
      ]),
    ).toBe(twin);
  });

  it("counts both ISBN forms of one edition once", () => {
    expect(
      pickSameEdition(wanted, [twin, { ...wanted, isbn10: "0375704027" }]),
    ).toBe(twin);
  });

  it("gives up when two editions with different ISBNs could be it", () => {
    expect(
      pickSameEdition(wanted, [twin, { ...wanted, isbn13: "9780307950628" }]),
    ).toBeNull();
  });
});
