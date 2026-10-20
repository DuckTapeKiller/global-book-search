jest.mock("@settings/settings", () => ({
  DefaultFrontmatterKeyType: {
    snakeCase: "Snake Case",
    camelCase: "Camel Case",
  },
}));

import type { App } from "obsidian";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BookNoteCreator } from "@utils/note_creator";
import { makeBook, makeSettings } from "@utils/test_utils";
import { FRONTMATTER_TEMPLATES } from "@settings/frontmatter_templates";

const arabicBook = makeBook({
  title: "موسم الهجرة إلى الشمال",
  originalTitle: "Season of Migration to the North",
  author: "الطيب صالح",
  authors: ["الطيب صالح"],
  translator: "دنيس جونسون-ديفيز",
  description: "رواية عن العودة إلى الجذور.",
  totalPage: 176,
  publisher: "دار العودة",
  categories: "رواية, أدب عربي, أدب أفريقي",
  isbn10: "0141187202",
  isbn13: "978-0141187209",
  asin: "B000X",
  publishDate: "1966",
  link: "https://example.com/book",
  localCoverImage: "[[covers/موسم.png]]",
});

async function render(template: string, book = arabicBook): Promise<string> {
  const creator = new BookNoteCreator(
    {} as unknown as App,
    makeSettings({ frontmatter: template }),
  );
  return creator.getRenderedContents(book);
}

const languageNames = Object.keys(FRONTMATTER_TEMPLATES);

/** The YAML lines inside the rendered `---` fences. */
function frontmatterLines(rendered: string): string[] {
  return rendered
    .split("---")[1]
    .split("\n")
    .filter((line) => line.trim() !== "");
}

/** The YAML keys (lines before the first ":") of a rendered frontmatter block. */
function frontmatterKeys(rendered: string): string[] {
  return frontmatterLines(rendered)
    .filter((line) => line.includes(":") && !line.trimStart().startsWith("- "))
    .map((line) => line.slice(0, line.indexOf(":")).trim())
    .filter(Boolean);
}

describe("Localized frontmatter templates", () => {
  it("ships a template for every advertised language", () => {
    expect(languageNames).toEqual(
      expect.arrayContaining([
        "Spanish",
        "English",
        "French",
        "German",
        "Italian",
        "Portuguese",
        "Dutch",
        "Russian",
        "Simplified Chinese",
        "Japanese",
        "Korean",
        "Arabic",
      ]),
    );
  });

  it.each(languageNames)(
    "renders the %s template without leaving placeholders behind",
    async (language) => {
      const output = await render(FRONTMATTER_TEMPLATES[language]);

      expect(output.startsWith("---\n")).toBe(true);
      expect(output).toContain("---");
      // No leftover {{variable}} tokens, no "[object Object]" artifacts.
      expect(output).not.toMatch(/{{\s*\w+/);
      expect(output).not.toContain("[object Object]");
      // Every frontmatter line is either "key: value" or a "- list item".
      for (const line of frontmatterLines(output)) {
        expect(line).toMatch(/^[^:\n]+:.*$|^\s*-\s/);
      }
      expect(frontmatterKeys(output).length).toBeGreaterThan(10);
    },
  );

  it("ships every template with Windows-style CRLF-free newlines", () => {
    for (const [name, template] of Object.entries(FRONTMATTER_TEMPLATES)) {
      expect(`${name}:${template.includes("\r")}`).toBe(`${name}:false`);
      expect(template.startsWith("---\n")).toBe(true);
      expect(template.endsWith("\n---")).toBe(true);
    }
  });

  it("separates Arabic categories into a dash list", async () => {
    const output = await render(FRONTMATTER_TEMPLATES.Arabic);

    expect(output).toContain("التصنيفات:\n- رواية\n- أدب عربي\n- أدب أفريقي");
    expect(output).not.toContain("رواية, أدب عربي");
  });

  it("renders categories as a dash list in the default Spanish template", async () => {
    const output = await render(FRONTMATTER_TEMPLATES.Spanish);

    expect(output).toContain("Géneros:\n- رواية\n- أدب عربي\n- أدب أفريقي");
    expect(output).not.toContain("رواية, أدب عربي");
  });

  it("uses the English template as the default for new installs", () => {
    // Read as text so the settings module (which imports Obsidian UI code) is
    // never loaded into the test runtime.
    const settingsSource = readFileSync(
      join(__dirname, "settings.ts"),
      "utf-8",
    );
    expect(settingsSource).toMatch(
      /frontmatter:\s*FRONTMATTER_TEMPLATES\.English/,
    );
  });
});

describe("Arabic frontmatter template", () => {
  it("uses Arabic field names", async () => {
    const output = await render(FRONTMATTER_TEMPLATES.Arabic);

    for (const key of [
      "العنوان",
      "العنوان الأصلي",
      "المؤلف",
      "المترجم",
      "مقدمة",
      "الوصف",
      "عدد الصفحات",
      "الناشر",
      "التصنيفات",
      "تاريخ النشر",
      "تاريخ القراءة",
      "الغلاف",
      "الرابط",
      "tags",
      "مقروء",
    ]) {
      expect(frontmatterKeys(output)).toContain(key);
    }
  });

  it("renders Arabic metadata values", async () => {
    const output = await render(FRONTMATTER_TEMPLATES.Arabic);

    expect(output).toContain("العنوان: موسم الهجرة إلى الشمال");
    expect(output).toContain("المؤلف: الطيب صالح");
    expect(output).toContain("الناشر: دار العودة");
    expect(output).toContain('عدد الصفحات: "176"');
    expect(output).toContain("مقروء: false");
  });

  it("does not crash when Arabic metadata is missing", async () => {
    const minimal = makeBook({
      title: "كتاب",
      author: "مؤلف",
      categories: undefined,
    });
    const output = await render(FRONTMATTER_TEMPLATES.Arabic, minimal);

    expect(output).toContain("العنوان: كتاب");
    expect(output).toContain('التصنيفات: ""');
  });
});
