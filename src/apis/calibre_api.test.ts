jest.mock("@utils/http", () => ({ httpRequest: jest.fn() }));

import { httpRequest } from "@utils/http";
import { CalibreApi } from "@apis/calibre_api";
import { Book } from "@models/book.model";

const mockedRequest = httpRequest as jest.Mock;

/** Fetch one book through the API as the Calibre content server would send it. */
async function fetchBook(data: Record<string, unknown>): Promise<Book> {
  mockedRequest.mockResolvedValueOnce({
    status: 200,
    json: {
      title: "The Colour of Magic",
      authors: ["Terry Pratchett"],
      ...data,
    },
  });
  const api = new CalibreApi("http://localhost:8080", "calibre");
  return api.getBook({ sourceId: "7" } as Book);
}

describe("CalibreApi series", () => {
  it("returns the series and its number", async () => {
    const book = await fetchBook({ series: "Discworld", series_index: 1 });
    expect(book.series).toBe("Discworld");
    expect(book.seriesNumber).toBe(1);
  });

  it("accepts a numeric string and a fractional index", async () => {
    expect(
      (await fetchBook({ series: "S", series_index: "2" })).seriesNumber,
    ).toBe(2);
    expect(
      (await fetchBook({ series: "S", series_index: 0.5 })).seriesNumber,
    ).toBe(0.5);
  });

  it("never lets a non-numeric index become NaN in a note", async () => {
    const book = await fetchBook({ series: "S", series_index: "n/a" });
    expect(book.series).toBe("S");
    expect(book.seriesNumber).toBeUndefined();
  });

  it("ignores a missing or invalid index", async () => {
    expect((await fetchBook({ series: "S" })).seriesNumber).toBeUndefined();
    expect(
      (await fetchBook({ series: "S", series_index: null })).seriesNumber,
    ).toBeUndefined();
    expect(
      (await fetchBook({ series: "S", series_index: {} })).seriesNumber,
    ).toBeUndefined();
  });

  it("returns an empty series for a book that is not in one", async () => {
    const book = await fetchBook({ series_index: 1 });
    expect(book.series).toBe("");
    expect(book.seriesNumber).toBeUndefined();
  });

  it("leaves the wikilink to the note renderer", async () => {
    const book = await fetchBook({ series: "Discworld", series_index: 1 });
    expect(book.seriesLink).toBeUndefined();
  });
});
