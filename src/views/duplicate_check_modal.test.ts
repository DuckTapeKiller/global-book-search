jest.mock("obsidian", () => {
  const actual = jest.requireActual("../test/mock_obsidian.ts");
  return { ...actual, Modal: class {}, TFile: class {} };
});

import type { App } from "obsidian";
import { findExistingBookNote } from "./duplicate_check_modal";
import { frontmatterIsbn } from "@utils/utils";

type FileLike = { path: string; basename: string };
type FmLike = Record<string, unknown>;

function fakeApp(entries: Array<{ file: FileLike; fm: FmLike }>): App {
  return {
    vault: { getMarkdownFiles: () => entries.map((e) => e.file) },
    metadataCache: {
      getFileCache: (file: FileLike) =>
        entries.find((e) => e.file.path === file.path)?.fm
          ? { frontmatter: entries.find((e) => e.file.path === file.path)!.fm }
          : null,
    },
  } as unknown as App;
}

// Frontmatter exactly as the shipped (English) template writes it.
const pluginNote = {
  file: {
    path: "Books/The Hobbit - J.R.R. Tolkien.md",
    basename: "The Hobbit - J.R.R. Tolkien",
  },
  fm: {
    "isbn 10": "0261102214",
    "isbn 13": "9780261102217",
    Title: "The Hobbit",
  },
};

describe("frontmatterIsbn", () => {
  it("accepts every spelling of the ISBN key", () => {
    expect(frontmatterIsbn({ "isbn 13": "9780261102217" }, 13)).toBe(
      "9780261102217",
    );
    expect(frontmatterIsbn({ isbn13: "9780261102217" }, 13)).toBe(
      "9780261102217",
    );
    expect(frontmatterIsbn({ "isbn-13": "9780261102217" }, 13)).toBe(
      "9780261102217",
    );
    expect(frontmatterIsbn({ "ISBN 13": "9780261102217" }, 13)).toBe(
      "9780261102217",
    );
  });

  it("accepts a YAML number and returns an empty string when absent", () => {
    expect(frontmatterIsbn({ "isbn 13": 9780261102217 }, 13)).toBe(
      "9780261102217",
    );
    expect(frontmatterIsbn({ Title: "x" }, 13)).toBe("");
    expect(frontmatterIsbn({ "isbn 10": "" }, 10)).toBe("");
  });

  it("does not confuse isbn 10 with isbn 13", () => {
    const fm = { "isbn 10": "0261102214", "isbn 13": "9780261102217" };
    expect(frontmatterIsbn(fm, 10)).toBe("0261102214");
    expect(frontmatterIsbn(fm, 13)).toBe("9780261102217");
  });
});

describe("findExistingBookNote", () => {
  it("finds a plugin-created note by ISBN despite the spaced key", () => {
    const app = fakeApp([pluginNote]);

    expect(
      findExistingBookNote(app, "", "The Hobbit", "9780261102217"),
    ).not.toBeNull();
    expect(
      findExistingBookNote(app, "", "The Hobbit", "0261102214"),
    ).not.toBeNull();
  });

  it("still finds camelCase notes written with useDefaultFrontmatter", () => {
    const app = fakeApp([
      {
        file: { path: "x.md", basename: "x" },
        fm: { isbn13: "9780261102217" },
      },
    ]);

    expect(
      findExistingBookNote(app, "", "Whatever", "9780261102217"),
    ).not.toBeNull();
  });

  it("finds the note by its '<title> - <author>' filename", () => {
    const app = fakeApp([pluginNote]);

    expect(
      findExistingBookNote(app, "", "The Hobbit", undefined, "J.R.R. Tolkien"),
    ).not.toBeNull();
  });

  it("scopes the folder to whole path segments", () => {
    const app = fakeApp([
      { file: { path: "Books2/x.md", basename: "x" }, fm: {} },
    ]);

    expect(findExistingBookNote(app, "Books", "x")).toBeNull();
    expect(findExistingBookNote(app, "Books2", "x")).not.toBeNull();
  });

  it("does not match a different book by partial title", () => {
    const app = fakeApp([
      {
        file: { path: "It Ends with Us.md", basename: "It Ends with Us" },
        fm: {},
      },
    ]);

    expect(findExistingBookNote(app, "", "It")).toBeNull();
  });

  it("returns null when nothing matches", () => {
    const app = fakeApp([pluginNote]);

    expect(findExistingBookNote(app, "", "Dune", "9780441013593")).toBeNull();
  });
});
