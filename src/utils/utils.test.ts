import { Book } from "@models/book.model";
import * as utils from "./utils";

jest.mock("@settings/settings", () => jest.fn());

describe("util.js", () => {
  const book: Book = {
    title: "코스모스",
    author: "칼 세이건",
    authors: ["칼 세이건"],
    coverUrl: "http://example.com/cover.jpg",
    link: "http://example.com/book",
  };

  it("toStringFrontMatter renders arrays as flush YAML block sequences", () => {
    expect(
      utils.toStringFrontMatter({ tags: ["introducing_kafka"] }),
    ).toContain("tags:\n- introducing_kafka");
    expect(
      utils.toStringFrontMatter({ tags: ["author/kafka", "libros/x"] }),
    ).toContain("tags:\n- author/kafka\n- libros/x");
  });

  it("replaceIllegalFileNameCharactersInString 1", () => {
    expect(
      utils.replaceIllegalFileNameCharactersInString(
        "재레드 다이아몬드의 <대변동 : 위기, 선택, 변화>",
      ),
    ).toBe("재레드 다이아몬드의 대변동 위기 선택 변화");
  });

  it("replaceIllegalFileNameCharactersInString 2", () => {
    expect(
      utils.replaceIllegalFileNameCharactersInString(
        "2022 고시넷 초록이 NCS 모듈형 1 | 통합기본서(2판)",
      ),
    ).toBe("2022 고시넷 초록이 NCS 모듈형 1 통합기본서(2판)");
  });

  it("makeFileName 1", () => {
    expect(utils.makeFileName(book)).toBe("코스모스 - 칼 세이건.md");
  });

  it("makeFileName 2", () => {
    const newBook = {
      ...book,
      author: "",
    };
    expect(utils.makeFileName(newBook)).toBe("코스모스.md");
  });

  it("makeFileName 3", () => {
    expect(utils.makeFileName(book, "{{author}}-{{title}}")).toBe(
      "칼 세이건-코스모스.md",
    );
  });

  it("makeFileName 4", () => {
    expect(utils.makeFileName(book, "{{author}}-{{title}}")).toBe(
      "칼 세이건-코스모스.md",
    );
  });

  it("makeFileName 5", () => {
    const newBook = {
      ...book,
      title: "코스모스 : 창백한 푸른점",
    };
    expect(utils.makeFileName(newBook, "{{title}} - {{author}}")).toBe(
      "코스모스 창백한 푸른점 - 칼 세이건.md",
    );
  });
});

describe("replaceVariableSyntax modifiers", () => {
  const coverBook: Book = {
    title: "Foo",
    author: "Bar",
    authors: ["Bar"],
    coverUrl: "https://example.com/foo bar.jpg",
    link: "https://example.com",
    localCoverImage: "[[images/foo bar.png]]",
  };

  it("leaves {{localCoverImage}} unchanged (backward compatible)", () => {
    expect(utils.replaceVariableSyntax(coverBook, "{{localCoverImage}}")).toBe(
      "[[images/foo bar.png]]",
    );
  });

  it("raw strips the [[ ]] wikilink brackets", () => {
    expect(
      utils.replaceVariableSyntax(coverBook, "{{localCoverImage:raw}}"),
    ).toBe("images/foo bar.png");
  });

  it("url encodes spaces while preserving structure", () => {
    expect(utils.replaceVariableSyntax(coverBook, "{{coverUrl:url}}")).toBe(
      "https://example.com/foo%20bar.jpg",
    );
  });

  it("chains raw then url", () => {
    expect(
      utils.replaceVariableSyntax(coverBook, "{{localCoverImage:raw:url}}"),
    ).toBe("images/foo%20bar.png");
  });

  it("works inside an embed and a quoted frontmatter value", () => {
    expect(
      utils.replaceVariableSyntax(
        coverBook,
        "![[{{localCoverImage:raw}}|150]]",
      ),
    ).toBe("![[images/foo bar.png|150]]");
    expect(
      utils.replaceVariableSyntax(coverBook, '"{{localCoverImage:raw:url}}"'),
    ).toBe('"images/foo%20bar.png"');
  });

  it("ignores unknown modifiers, returning the plain value", () => {
    expect(utils.replaceVariableSyntax(coverBook, "{{title:bogus}}")).toBe(
      "Foo",
    );
  });

  it("raw leaves a non-bracketed value untouched (remote-mode cover)", () => {
    const remote = { ...coverBook, localCoverImage: "https://x.com/c.jpg" };
    expect(utils.replaceVariableSyntax(remote, "{{localCoverImage:raw}}")).toBe(
      "https://x.com/c.jpg",
    );
  });
});
