import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isGoodreadsChromePage } from "./goodreads_api";

const fixture = (name: string): string =>
  readFileSync(join(__dirname, "..", "..", "test", "fixtures", name), "utf-8");

describe("isGoodreadsChromePage", () => {
  it("rejects a real 'Page not found' page served with HTTP 200", () => {
    // Captured from GET /book/show/999999999.xml → HTTP 200, og:title="Goodreads".
    const dead = fixture("goodreads_dead_book_page.html");

    expect(dead).toContain("Page not found");
    expect(isGoodreadsChromePage(dead)).toBe(true);
  });

  it("does not reject a page with a book identity marker", () => {
    const bookPage = `
      <html><head>
        <title>The Hobbit</title>
        <meta property="og:title" content="Goodreads" />
        <meta property="og:image" content="https://s.gr-assets.com/assets/facebook/x.png" />
      </head><body>
        <h1 data-testid="bookTitle">The Hobbit</h1>
      </body></html>`;

    expect(isGoodreadsChromePage(bookPage)).toBe(false);
  });

  it("does not reject an ordinary page whose title merely contains 'not found'", () => {
    const bookPage = `
      <html><head>
        <title>Lost and Not Found: A Memoir | Goodreads</title>
        <meta property="og:title" content="Lost and Not Found: A Memoir" />
        <meta property="og:image" content="https://i.gr-assets.com/images/cover.jpg" />
      </head><body><h1 data-testid="bookTitle">Lost and Not Found</h1></body></html>`;

    expect(isGoodreadsChromePage(bookPage)).toBe(false);
  });

  it("rejects an OpenGraph-only site page that has no book identity", () => {
    const chrome = `
      <html><head>
        <title>Some Marketing Page</title>
        <meta property="og:title" content="Goodreads" />
        <meta property="og:description" content="Discover and share books you love." />
        <meta property="og:image" content="https://s.gr-assets.com/assets/facebook/goodreads_wide.png" />
      </head><body><div id="__next"></div></body></html>`;

    expect(isGoodreadsChromePage(chrome)).toBe(true);
  });

  it("rejects a chrome title even when the body is unparseable", () => {
    expect(
      isGoodreadsChromePage("<html><head><title>Page not found</title>"),
    ).toBe(true);
    expect(isGoodreadsChromePage("")).toBe(false);
  });

  it("recognises a JSON-LD Book as book identity", () => {
    const page = `
      <html><head><title>Some Book</title></head><body>
        <script type="application/ld+json">{"@type":"Book","name":"Some Book"}</script>
      </body></html>`;

    expect(isGoodreadsChromePage(page)).toBe(false);
  });

  it("recognises an Apollo Book entity as book identity", () => {
    const page = `
      <html><head><title>Some Book</title>
        <meta property="og:title" content="Goodreads" />
      </head><body>
        <script>window.__APOLLO_STATE__={"Book:123":{"__typename":"Book","title":"Some Book"}}</script>
      </body></html>`;

    expect(isGoodreadsChromePage(page)).toBe(false);
  });
});
