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
  it("writes bare values, not the template's quotes (Update Metadata)", async () => {
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
      Summary: 'He said "hello" twice.',
      Series: "[[Discworld]]",
      Author: "Terry Pratchett",
      Rating: 5,
    });
  });

  it("keeps list properties as lists of bare values", async () => {
    const properties = await update("tags: {{tags}}", {});
    expect(Array.isArray(properties.tags)).toBe(true);
    for (const tag of properties.tags as unknown[]) {
      expect(String(tag)).not.toMatch(/^"/);
    }
  });
});
