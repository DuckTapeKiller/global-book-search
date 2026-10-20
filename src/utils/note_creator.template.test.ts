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

function appWithTemplate(template: string): App {
  return {
    metadataCache: { getFirstLinkpathDest: () => ({ path: "TPL Book.md" }) },
    vault: { cachedRead: () => Promise.resolve(template) },
  } as unknown as App;
}

function makeSettings(
  overrides: Partial<BookSearchPluginSettings> = {},
): BookSearchPluginSettings {
  return {
    frontmatter: "",
    content: "",
    useDefaultFrontmatter: false,
    defaultFrontmatterKeyType: "Camel Case",
    templateFile: "TPL Book.md",
    coverImageMode: "none",
    authorTagPrefix: "",
    titleTagPrefix: "",
    ...overrides,
  } as unknown as BookSearchPluginSettings;
}

const book: Book = {
  title: "Snow Crash",
  author: "Neal Stephenson",
  authors: ["Neal Stephenson"],
  coverUrl: "",
  link: "",
  description: "A novel",
} as Book;

describe("Templates whose frontmatter is written by Templater", () => {
  // Templates written for anpigon/obsidian-book-search-plugin often emit the
  // frontmatter delimiters through Templater, so the `---` only exists after
  // Templater has run. Splitting such a template on "---" cuts through
  // `<%"---"%>` and leaves fragments that make Templater abort.
  const template = [
    '<%"---"%>',
    'title: "{{title}}"',
    'rating: <% await tp.system.suggester((i) => i, ["", "★★★★★"], false, "Rate") %>',
    "tags:",
    "  - type/book",
    '<%"---"%>',
    "# {{title}}",
    "- Author(s): {{author}}",
  ].join("\n");

  it("renders the template as text with only the variables substituted", async () => {
    const creator = new BookNoteCreator(
      appWithTemplate(template),
      makeSettings(),
    );

    const rendered = await creator.getRenderedContents(book);

    expect(rendered).toBe(
      [
        '<%"---"%>',
        'title: "Snow Crash"',
        'rating: <% await tp.system.suggester((i) => i, ["", "★★★★★"], false, "Rate") %>',
        "tags:",
        "  - type/book",
        '<%"---"%>',
        "# Snow Crash",
        "- Author(s): Neal Stephenson",
      ].join("\n"),
    );
  });
});

describe("Templates that start with a frontmatter block", () => {
  it("still have their frontmatter parsed and rewritten", async () => {
    const template = '---\ntitle: "{{title}}"\n---\n# {{title}}';
    const creator = new BookNoteCreator(
      appWithTemplate(template),
      makeSettings(),
    );

    const rendered = await creator.getRenderedContents(book);

    expect(rendered).toMatch(/^---\ntitle: "Snow Crash"\n---\n/);
    expect(rendered).toContain("# Snow Crash");
  });
});
