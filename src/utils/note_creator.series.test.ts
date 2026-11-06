jest.mock("@settings/settings", () => ({
  DefaultFrontmatterKeyType: {
    snakeCase: "Snake Case",
    camelCase: "Camel Case",
  },
}));

import type { App } from "obsidian";
import type { BookSearchPluginSettings } from "@settings/settings";
import { Book } from "@models/book.model";
import { BookNoteCreator } from "@utils/note_creator";

function makeSettings(
  overrides: Partial<BookSearchPluginSettings> = {},
): BookSearchPluginSettings {
  return {
    folder: "",
    fileNameFormat: "{{title}} - {{author}}",
    frontmatter: [
      `Title: "{{title}}"`,
      `Series: "{{seriesLink}}"`,
      `Series name: "{{series}}"`,
      `Series number: "{{seriesNumber}}"`,
    ].join("\n"),
    content: "",
    useDefaultFrontmatter: false,
    defaultFrontmatterKeyType: "Camel Case",
    templateFile: "",
    coverImageMode: "none",
    coverImageFileExtension: "jpg",
    enableSeriesLinking: true,
    authorTagPrefix: "",
    titleTagPrefix: "",
    ...overrides,
  } as unknown as BookSearchPluginSettings;
}

const discworldBook = (): Book => ({
  title: "The Colour of Magic",
  author: "Terry Pratchett",
  authors: ["Terry Pratchett"],
  coverUrl: "",
  link: "",
  series: "Discworld",
  seriesNumber: "1",
});

const render = (settings: BookSearchPluginSettings, book: Book) =>
  new BookNoteCreator({} as unknown as App, settings).getRenderedContents(book);

describe("series variables in a rendered note", () => {
  it("fills {{series}}, {{seriesNumber}} and a wikilinked {{seriesLink}}", async () => {
    const output = await render(makeSettings(), discworldBook());
    expect(output).toContain('Series: "[[Discworld]]"');
    expect(output).toContain('Series name: "Discworld"');
    expect(output).toContain('Series number: "1"');
  });

  it("drops only the wikilink when series linking is disabled", async () => {
    const output = await render(
      makeSettings({ enableSeriesLinking: false }),
      discworldBook(),
    );
    expect(output).toContain('Series: ""');
    expect(output).toContain('Series name: "Discworld"');
    expect(output).toContain('Series number: "1"');
  });

  it("leaves the series properties empty for a book without a series", async () => {
    const book = discworldBook();
    delete book.series;
    delete book.seriesNumber;
    const output = await render(makeSettings(), book);
    expect(output).toContain('Series: ""');
    expect(output).toContain('Series name: ""');
    expect(output).toContain('Series number: ""');
  });

  it("renders a numeric series number such as Calibre's", async () => {
    const book = { ...discworldBook(), seriesNumber: 2.5 };
    const output = await render(makeSettings(), book);
    expect(output).toContain('Series number: "2.5"');
  });

  it("quotes a bare {{seriesLink}} so the property stays valid YAML", async () => {
    const output = await render(
      makeSettings({ frontmatter: `Series: {{seriesLink}}` }),
      discworldBook(),
    );
    expect(output).toContain('Series: "[[Discworld]]"');
    expect(output).not.toMatch(/^Series: \[\[/m);
  });

  it("works in the note body as well as the frontmatter", async () => {
    const output = await render(
      makeSettings({
        frontmatter: "",
        content: "Part {{seriesNumber}} of {{seriesLink}}",
      }),
      discworldBook(),
    );
    expect(output).toBe("Part 1 of [[Discworld]]");
  });

  it("makes the link available to inline scripts too", async () => {
    const output = await render(
      makeSettings({
        frontmatter: "",
        content: "<%= book.seriesLink %>",
      }),
      discworldBook(),
    );
    expect(output).toBe("[[Discworld]]");
  });
});
