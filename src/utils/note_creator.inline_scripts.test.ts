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
    frontmatter: `Title: "{{title}}"\nDescription: "{{description}}"`,
    content: "Body:\n{{description}}",
    useDefaultFrontmatter: false,
    defaultFrontmatterKeyType: "Camel Case",
    templateFile: "",
    serviceProvider: "google",
    localePreference: "default",
    apiKey: "",
    openPageOnCompletion: false,
    showCoverImageInSearch: false,
    enableCoverImageEdgeCurl: true,
    coverImagePath: "",
    coverImageMode: "none",
    coverImageFileExtension: "jpg",
    askForLocale: false,
    calibreServerUrl: "http://localhost:8080",
    calibreLibraryId: "calibre",
    warnOnDuplicate: true,
    searchHistory: [],
    maxSearchHistory: 10,
    enableSeriesLinking: false,
    showTemplatePreview: false,
    showIndividualServiceButtons: false,
    authorTagPrefix: "",
    titleTagPrefix: "",
    ...overrides,
  } as unknown as BookSearchPluginSettings;
}

describe("Inline scripts templates (<%= %>)", () => {
  it("does not execute <%= %> blocks originating from substituted metadata", async () => {
    const globalState = globalThis as unknown as { __pwned?: string };
    globalState.__pwned = "no";

    const creator = new BookNoteCreator({} as unknown as App, makeSettings());
    const book: Book = {
      title: "Test",
      author: "Author",
      authors: ["Author"],
      coverUrl: "",
      link: "",
      description: `<%= (globalThis as unknown as { __pwned?: string }).__pwned = "yes" %>`,
    };

    const output = await creator.getRenderedContents(book);

    expect(globalState.__pwned).toBe("no");
    expect(output).toContain(
      `<%= (globalThis as unknown as { __pwned?: string }).__pwned = "yes" %>`,
    );
  });

  it("still executes <%= %> blocks that are present in the user template text", async () => {
    const creator = new BookNoteCreator(
      {} as unknown as App,
      makeSettings({
        frontmatter: `Title: <%= book.title %>`,
        content: `Hello <%= book.author %>`,
      }),
    );

    const book: Book = {
      title: "My Book",
      author: "Someone",
      authors: ["Someone"],
      coverUrl: "",
      link: "",
    };

    const output = await creator.getRenderedContents(book);

    expect(output).toContain("Title: My Book");
    expect(output).toContain("Hello Someone");
  });
});
