jest.mock("@settings/settings", () => ({}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const YAML = require("yaml") as { parse: (text: string) => unknown };
import type { App } from "obsidian";
import { BookNoteCreator } from "@utils/note_creator";
import { makeBook, makeSettings } from "@utils/test_utils";
import { FRONTMATTER_TEMPLATES } from "@settings/frontmatter_templates";

describe("end-to-end: Arabic note with a multi-paragraph description", () => {
  it("produces frontmatter Obsidian can parse, with a dash-separated category list", async () => {
    const creator = new BookNoteCreator(
      {} as unknown as App,
      makeSettings({ frontmatter: FRONTMATTER_TEMPLATES.Arabic }),
    );

    const output = await creator.getRenderedContents(
      makeBook({
        title: "موسم الهجرة إلى الشمال",
        author: "الطيب صالح",
        translator: "دنيس جونسون-ديفيز",
        publisher: "دار العودة",
        totalPage: 176,
        isbn13: "9780141187209",
        publishDate: "1966",
        categories: "رواية, أدب عربي, أدب أفريقي",
        description:
          "الفقرة الأولى: تعريف بالرواية.\n\nالفقرة الثانية تبدأ هنا.",
      }),
    );

    const fmText = output.split("---")[1];
    const parsed = YAML.parse(fmText) as Record<string, unknown>;

    expect(parsed["التصنيفات"]).toEqual(["رواية", "أدب عربي", "أدب أفريقي"]);
    expect(parsed["الوصف"]).toBe(
      "الفقرة الأولى: تعريف بالرواية.\n\nالفقرة الثانية تبدأ هنا.",
    );
    expect(parsed["عدد الصفحات"]).toBe("176");
    expect(parsed["isbn 13"]).toBe("9780141187209");
    expect(parsed["العنوان"]).toBe("موسم الهجرة إلى الشمال");
    expect(parsed["مقروء"]).toBe(false);
  });
});
