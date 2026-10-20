import type { BookSearchPluginSettings } from "@settings/settings";
import { Book } from "@models/book.model";

/** Minimal settings object for exercising BookNoteCreator in tests. */
export function makeSettings(
  overrides: Partial<BookSearchPluginSettings> = {},
): BookSearchPluginSettings {
  return {
    folder: "",
    fileNameFormat: "{{title}}",
    frontmatter: `Title: {{title}}`,
    content: "",
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

export function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    title: "Dune",
    author: "Frank Herbert",
    authors: ["Frank Herbert"],
    coverUrl: "",
    link: "",
    ...overrides,
  };
}
