jest.mock("@settings/settings", () => ({
  DefaultFrontmatterKeyType: {
    snakeCase: "Snake Case",
    camelCase: "Camel Case",
  },
}));

// Real YAML parser (transitive dep) so this suite asserts Obsidian-readability,
// not just string shape.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const YAML = require("yaml") as { parse: (text: string) => unknown };

import * as utils from "@utils/utils";

function parseRendered(frontmatter: Record<string, unknown>): unknown {
  return YAML.parse(utils.toStringFrontMatter(frontmatter));
}

describe("toStringFrontMatter YAML safety", () => {
  it("keeps a multi-paragraph description parseable", () => {
    const parsed = parseRendered({
      Description: "Para one is long.\n\nPara two starts here.",
    }) as Record<string, string>;

    expect(parsed.Description).toBe(
      "Para one is long.\n\nPara two starts here.",
    );
  });

  it("keeps single newlines as newlines rather than running words together", () => {
    const parsed = parseRendered({
      Description: "line one\nline two",
    }) as Record<string, string>;

    expect(parsed.Description).toBe("line one\nline two");
  });

  it("quotes values that would otherwise change meaning", () => {
    const cases: Array<[string, string]> = [
      ["Title", "- not a list"],
      ["Title", "? not a key"],
      ["Title", "#not a comment"],
      ["Title", "{not a map}"],
      ["Title", "[not a seq]"],
      ["Title", "Book #1"],
      ["Title", "ends with colon:"],
      ["Title", "a: b"],
      ["Title", "*anchor"],
      ["Title", "&anchor"],
      ["Title", "!tag"],
      ["Title", "|block"],
      ["Title", ">folded"],
      ["Title", "@reserved"],
      ["Title", "%directive"],
    ];

    for (const [key, value] of cases) {
      const parsed = parseRendered({ [key]: value }) as Record<string, string>;
      expect(`${value} -> ${String(parsed[key])}`).toBe(`${value} -> ${value}`);
    }
  });

  it("does not mis-parse a value whose text merely contains those characters", () => {
    const parsed = parseRendered({
      Title: "A - B: the sequel #2 [deluxe]",
    }) as Record<string, string>;

    expect(parsed.Title).toBe("A - B: the sequel #2 [deluxe]");
  });

  it("preserves a Windows line ending without emitting a literal CR", () => {
    const output = utils.toStringFrontMatter({
      Description: "first\r\n\r\nsecond",
    });

    expect(output).not.toContain("\r");
    expect(output).toContain("\\n");
  });

  it("does not silently drop a multi-line non-description value", () => {
    const output = utils.toStringFrontMatter({ Notes: "a\nb" });

    expect(output).not.toBe("");
    expect(output).toContain("Notes:");
  });

  it("escapes embedded quotes in a description instead of breaking the scalar", () => {
    const parsed = parseRendered({
      Description: 'He said "hello" and left.',
    }) as Record<string, string>;

    expect(typeof parsed.Description).toBe("string");
    expect(parsed.Description).toContain("hello");
  });

  it("quotes list items that would otherwise look like YAML syntax", () => {
    const parsed = parseRendered({
      Categories: ["- looks like a list", "plain", "#comment"],
    }) as Record<string, string[]>;

    expect(parsed.Categories).toEqual([
      "- looks like a list",
      "plain",
      "#comment",
    ]);
  });

  it("keeps ordinary values bare", () => {
    const output = utils.toStringFrontMatter({
      Title: "Dune",
      Publisher: "Ace",
      tags: ["frank_herbert", "dune"],
    });

    expect(output).toContain("Title: Dune");
    expect(output).toContain("Publisher: Ace");
    expect(output).toContain("tags:\n- frank_herbert\n- dune");
  });

  it("still quotes ISBNs and page counts", () => {
    const output = utils.toStringFrontMatter({
      "isbn 13": "9780141187209",
      Pages: 176,
    });

    expect(output).toContain('isbn 13: "9780141187209"');
    expect(output).toContain('Pages: "176"');
  });

  it("quotes page counts for localised keys too", () => {
    // The Arabic template writes `عدد الصفحات`; the language-specific heuristic
    // used to miss it and store the count as a YAML number.
    const output = utils.toStringFrontMatter({ "عدد الصفحات": "176" });

    expect(output).toContain('عدد الصفحات: "176"');
  });

  it("leaves genuinely numeric properties as numbers", () => {
    const output = utils.toStringFrontMatter({ Rating: 4, Year: 2020 });

    expect(output).toContain("Rating: 4");
    expect(output).toContain("Year: 2020");
  });

  it("does not quote unrelated keys that merely resemble numeric keys", () => {
    const output = utils.toStringFrontMatter({
      Pagecount: "42",
      ISBNote: "not-an-isbn",
    });

    expect(output).toContain("Pagecount: 42");
    expect(output).toContain("ISBNote: not-an-isbn");
  });
});
