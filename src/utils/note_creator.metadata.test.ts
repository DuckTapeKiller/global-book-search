jest.mock("@settings/settings", () => ({
  DefaultFrontmatterKeyType: {
    snakeCase: "Snake Case",
    camelCase: "Camel Case",
  },
}));

import type { App, TFile } from "obsidian";
import type { BookSearchPluginSettings } from "@settings/settings";
import { Book } from "@models/book.model";
import { BookNoteCreator, unquoteYamlScalar } from "@utils/note_creator";

const settings = (frontmatter: string) =>
  ({
    folder: "",
    fileNameFormat: "{{title}} - {{author}}",
    frontmatter,
    content: "",
    useDefaultFrontmatter: false,
    templateFile: "",
    coverImageMode: "none",
    enableSeriesLinking: true,
    authorTagPrefix: "",
    titleTagPrefix: "",
  }) as unknown as BookSearchPluginSettings;

const book: Book = {
  title: "The Colour of Magic",
  author: "Terry Pratchett",
  authors: ["Terry Pratchett"],
  coverUrl: "",
  link: "",
  totalPage: "287",
  description: 'He said "hello" twice.',
  series: "Discworld",
  seriesNumber: "1",
};

/** Runs updateMetadata against an existing note's properties and returns them. */
async function update(
  frontmatter: string,
  existing: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const properties = { ...existing };
  const app = {
    fileManager: {
      processFrontMatter: (
        _file: TFile,
        edit: (fm: Record<string, unknown>) => void,
      ) => {
        edit(properties);
        return Promise.resolve();
      },
    },
  } as unknown as App;
  await new BookNoteCreator(app, settings(frontmatter)).updateMetadata(
    {} as TFile,
    { ...book },
  );
  return properties;
}

describe("unquoteYamlScalar", () => {
  it("removes the quotes a template puts round a value", () => {
    expect(unquoteYamlScalar('"287"')).toBe("287");
    expect(unquoteYamlScalar('  "The Colour of Magic" ')).toBe(
      "The Colour of Magic",
    );
  });

  it("unescapes quotes inside the value", () => {
    expect(unquoteYamlScalar('"He said \\"hi\\""')).toBe('He said "hi"');
  });

  it("leaves unquoted and non-string values alone", () => {
    expect(unquoteYamlScalar("287")).toBe("287");
    expect(unquoteYamlScalar('half "quoted')).toBe('half "quoted');
    expect(unquoteYamlScalar(287)).toBe(287);
    expect(unquoteYamlScalar(null)).toBeNull();
  });
});

describe("BookNoteCreator.updateMetadata", () => {
  it("writes the values a new note would get, not the template's quotes", async () => {
    const properties = await update(
      [
        'Title: "{{title}}"',
        'Pages: "{{totalPage}}"',
        'Summary: "{{description}}"',
        'Series: "{{seriesLink}}"',
        "Author: {{author}}",
      ].join("\n"),
      { Pages: "STALE", Rating: 5 },
    );

    expect(properties).toEqual({
      Title: "The Colour of Magic",
      Pages: "287",
      // A new note's description has its quotes turned into « », as here.
      Summary: "He said «hello» twice.",
      Series: "[[Discworld]]",
      Author: "Terry Pratchett",
      Rating: 5,
    });
  });

  it("keeps list properties as lists of bare values", async () => {
    const properties = await update("tags: {{tags}}", {});
    expect(Array.isArray(properties.tags)).toBe(true);
    for (const tag of properties.tags as string[]) {
      expect(tag).not.toMatch(/^"/);
    }
  });

  it("leaves fixed template values to the reader", async () => {
    const properties = await update(
      ["Title: {{title}}", "Read: false", "Date read:", 'Prologue: ""'].join(
        "\n",
      ),
      { Read: true, "Date read": "2026-01-05", Prologue: "Neil Gaiman" },
    );

    expect(properties).toEqual({
      Title: "The Colour of Magic",
      Read: true,
      "Date read": "2026-01-05",
      Prologue: "Neil Gaiman",
    });
  });

  it("never erases a value with one the sources left empty", async () => {
    const properties = await update(
      ["Translator: {{translator}}", "Publisher: {{publisher}}"].join("\n"),
      { Translator: "Cristina Macía" },
    );

    expect(properties.Translator).toBe("Cristina Macía");
    // A property the note lacks is added as a new note would have it.
    expect(properties).toHaveProperty("Publisher", "");
  });

  it("gives values the types a new note would give them", async () => {
    const properties = await update(
      [
        "Series number: {{seriesNumber}}",
        'Pages: "{{totalPage}}"',
        "Series: {{seriesLink}}",
      ].join("\n"),
      { "Series number": "STALE" },
    );

    expect(properties["Series number"]).toBe(1);
    expect(properties.Pages).toBe("287");
    expect(properties.Series).toBe("[[Discworld]]");
  });
});

describe("BookNoteCreator.create", () => {
  it("gives a second note of the same book a free name instead of failing", async () => {
    const existing = new Set([
      "The Colour of Magic - Terry Pratchett.md",
      "The Colour of Magic - Terry Pratchett 1.md",
    ]);
    const created: string[] = [];
    const app = {
      vault: {
        getAbstractFileByPath: (path: string) =>
          existing.has(path) ? ({ path } as TFile) : null,
        create: (path: string) => {
          if (existing.has(path)) throw new Error("File already exists.");
          created.push(path);
          return Promise.resolve({ path } as TFile);
        },
      },
    } as unknown as App;

    const file = await new BookNoteCreator(
      app,
      settings("Title: {{title}}"),
    ).create({ ...book });

    expect(file.path).toBe("The Colour of Magic - Terry Pratchett 2.md");
    expect(created).toEqual(["The Colour of Magic - Terry Pratchett 2.md"]);
  });
});
