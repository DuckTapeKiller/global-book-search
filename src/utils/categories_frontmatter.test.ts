// utils.ts transitively imports the real settings module (and therefore Obsidian
// UI code), so stub the one runtime value it needs.
jest.mock("@settings/settings", () => ({
  DefaultFrontmatterKeyType: {
    snakeCase: "Snake Case",
    camelCase: "Camel Case",
  },
}));

import type { App } from "obsidian";
import { BookNoteCreator } from "@utils/note_creator";
import { makeBook, makeSettings } from "@utils/test_utils";

function render(
  frontmatter: string,
  book = makeBook({ categories: "Science Fiction, Fantasy, Adventure" }),
): Promise<string> {
  const creator = new BookNoteCreator(
    {} as unknown as App,
    makeSettings({ frontmatter }),
  );
  return creator.getRenderedContents(book);
}

describe("Categories frontmatter", () => {
  it("renders an unquoted {{categories}} as a dash-separated YAML list", async () => {
    const output = await render("Categories: {{categories}}");
    expect(output).toContain(
      "Categories:\n- Science Fiction\n- Fantasy\n- Adventure",
    );
  });

  it("renders a quoted {{categories}} as a dash-separated YAML list", async () => {
    const output = await render('Categories: "{{categories}}"');
    expect(output).toContain(
      "Categories:\n- Science Fiction\n- Fantasy\n- Adventure",
    );
  });

  it("never leaves the comma-joined string behind", async () => {
    for (const template of [
      "Categories: {{categories}}",
      'Categories: "{{categories}}"',
      "Categories: '{{categories}}'",
    ]) {
      const output = await render(template);
      expect(output).not.toContain("Science Fiction, Fantasy");
      expect(output).toContain("- Science Fiction");
    }
  });

  it("keeps each category as its own entry when opened by Obsidian", async () => {
    const output = await render("Categories: {{categories}}");
    // The malformed single-sentence value is what made Obsidian treat every
    // genre as one tag; the block sequence gives one tag per line.
    const entries = output
      .split("\n")
      .filter((line) => line.trim().startsWith("- "))
      .map((line) => line.trim().slice(2));
    expect(entries).toEqual(["Science Fiction", "Fantasy", "Adventure"]);
  });

  it("handles a single category", async () => {
    const output = await render(
      "Categories: {{categories}}",
      makeBook({ categories: "Fantasy" }),
    );
    expect(output).toContain("Categories:\n- Fantasy");
  });

  it("falls back to an empty value when there are no categories", async () => {
    const output = await render(
      "Categories: {{categories}}",
      makeBook({ categories: "" }),
    );
    expect(output).toContain('Categories: ""');
    expect(output).not.toContain("- ");
  });

  it("trims whitespace around each category", async () => {
    const output = await render(
      "Categories: {{categories}}",
      makeBook({ categories: "  Fantasy ,,  Classics , " }),
    );
    expect(output).toContain("Categories:\n- Fantasy\n- Classics");
  });

  it("accepts an array-valued categories field", async () => {
    const output = await render(
      "Categories: {{categories}}",
      makeBook({
        categories: ["Fantasy", "Classics"] as unknown as string,
      }),
    );
    expect(output).toContain("Categories:\n- Fantasy\n- Classics");
  });

  it("splits on commas even when a category resolves with a colon", async () => {
    const output = await render(
      "Categories: {{categories}}",
      makeBook({ categories: "Science Fiction: Space Opera, Fantasy" }),
    );
    // The colon makes a bare YAML scalar ambiguous, so it gets quoted; the split
    // itself is unaffected.
    expect(output).toContain(
      'Categories:\n- "Science Fiction: Space Opera"\n- Fantasy',
    );
  });

  it("still renders {{tags}} as a dash-separated list", async () => {
    const output = await render("Tags: {{tags}}");
    expect(output).toContain("Tags:\n- frank_herbert\n- dune");
  });

  it("leaves unrelated comma-containing fields alone", async () => {
    const output = await render("Publisher: {{publisher}}", {
      ...makeBook({ publisher: "Baen, Inc." }),
    });
    expect(output).toContain("Publisher: Baen, Inc.");
  });

  it("keeps the flat value when an explicit modifier is used", async () => {
    const output = await render("Categories: {{categories:raw}}");
    expect(output).toContain("Categories: Science Fiction, Fantasy, Adventure");
  });

  it("does not turn other quoted single-variable fields into lists", async () => {
    const output = await render(
      'Description: "{{description}}"\nisbn 13: "{{isbn13}}"',
      makeBook({
        description: "A single sentence, with a comma.",
        isbn13: "9780141187209",
      }),
    );

    expect(output).toContain('Description: "A single sentence, with a comma."');
    expect(output).toContain('isbn 13: "9780141187209"');
    expect(output).not.toContain("- A single sentence");
    expect(output).not.toContain("- 9780141187209");
  });

  it("keeps array-valued fields as lists only when the template asks for them", async () => {
    const output = await render(
      'Authors: "{{authors}}"',
      makeBook({ authors: ["Frank Herbert", "Kevin J. Anderson"] }),
    );
    expect(output).toContain("Authors:\n- Frank Herbert\n- Kevin J. Anderson");
  });
});
