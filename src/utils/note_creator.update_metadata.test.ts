jest.mock("@settings/settings", () => ({
  DefaultFrontmatterKeyType: {
    snakeCase: "Snake Case",
    camelCase: "Camel Case",
  },
}));

import type { App } from "obsidian";
import { BookNoteCreator } from "@utils/note_creator";
import { makeBook, makeSettings } from "@utils/test_utils";

type Frontmatter = Record<string, unknown>;

/**
 * Minimal vault-backed app: processFrontMatter reads and writes the stored
 * frontmatter object exactly like Obsidian's does.
 */
function makeApp(store: Frontmatter): App {
  return {
    vault: {
      adapter: { exists: async () => true },
      createFolder: async () => {},
    },
    fileManager: {
      processFrontMatter: async (
        _file: unknown,
        fn: (fm: Frontmatter) => void,
      ) => {
        fn(store);
      },
    },
  } as unknown as App;
}

/**
 * Mirrors how the source applies the "Update Metadata" decision in main.ts:
 * the existing note is updated in place rather than re-created.
 */
async function applyDuplicateAction(
  creator: BookNoteCreator,
  action: "open" | "update" | "create" | "cancel",
  existingFile: unknown,
  book: Parameters<BookNoteCreator["updateMetadata"]>[1],
  created: string[],
): Promise<void> {
  if (action === "cancel") return;
  if (action === "open") return;
  if (action === "update") {
    await creator.updateMetadata(existingFile as never, book);
    return;
  }
  created.push("created");
}

describe("duplicate update path", () => {
  const book = makeBook({
    title: "Dune",
    author: "Frank Herbert",
    categories: "Science Fiction, Fantasy",
    isbn13: "9780441013593",
  });

  it("Update Metadata writes into the existing note instead of creating a new one", async () => {
    const store: Frontmatter = {
      Title: "Dune (old)",
      Categories: "Old",
      Read: false,
    };
    const creator = new BookNoteCreator(
      makeApp(store),
      makeSettings({
        frontmatter: "Title: {{title}}\nCategories: {{categories}}",
      }),
    );
    const created: string[] = [];

    await applyDuplicateAction(
      creator,
      "update",
      { path: "Books/Dune - Frank Herbert.md" },
      book,
      created,
    );

    expect(created).toEqual([]);
    expect(store.Title).toBe("Dune");
    expect(store.Categories).toEqual(["Science Fiction", "Fantasy"]);
    // Fields the user set by hand survive the merge.
    expect(store.Read).toBe(false);
  });

  it("Create Anyway is the only action that creates a file", async () => {
    const store: Frontmatter = {};
    const creator = new BookNoteCreator(makeApp(store), makeSettings());
    const created: string[] = [];

    await applyDuplicateAction(
      creator,
      "create",
      { path: "x.md" },
      book,
      created,
    );
    expect(created).toEqual(["created"]);
  });

  it("Cancel leaves the note untouched", async () => {
    const store: Frontmatter = { Title: "Dune (old)" };
    const creator = new BookNoteCreator(makeApp(store), makeSettings());
    const created: string[] = [];

    await applyDuplicateAction(
      creator,
      "cancel",
      { path: "x.md" },
      book,
      created,
    );

    expect(created).toEqual([]);
    expect(store.Title).toBe("Dune (old)");
  });
});
