jest.mock("@settings/settings", () => ({
  DefaultFrontmatterKeyType: {
    snakeCase: "Snake Case",
    camelCase: "Camel Case",
  },
}));

import type { BookSearchPluginSettings } from "@settings/settings";
import { BookWithSource, mergeWithConflicts } from "@apis/global_search";

const settings = {
  fieldSourcePreferences: {},
} as unknown as BookSearchPluginSettings;

const source = (
  id: string,
  label: string,
  extra: Partial<BookWithSource> = {},
): BookWithSource => ({
  title: "The Colour of Magic",
  author: "Terry Pratchett",
  authors: ["Terry Pratchett"],
  coverUrl: "",
  link: "",
  _sourceIds: [id],
  _sourceLabels: [label],
  ...extra,
});

describe("mergeWithConflicts: series", () => {
  it("brings the series in from Goodreads when another provider is primary", () => {
    const google = source("google", "Google Books");
    const goodreads = source("goodreads", "Goodreads", {
      series: "Discworld",
      seriesNumber: "1",
    });

    const { merged, contributingSources } = mergeWithConflicts(
      google,
      goodreads,
      [],
      settings,
      "google",
    );

    expect(merged.series).toBe("Discworld");
    expect(merged.seriesNumber).toBe("1");
    expect(contributingSources).toContain("Goodreads");
  });

  it("takes a series and its number from the same source, never mixing two", () => {
    // The primary names a series without a number; Goodreads has a different
    // series with a number. The number must not be paired with the wrong name.
    const primary = source("calibre", "Calibre", { series: "Discworld" });
    const goodreads = source("goodreads", "Goodreads", {
      series: "Discworld - Rincewind",
      seriesNumber: "1",
    });

    const { merged } = mergeWithConflicts(
      primary,
      goodreads,
      [],
      settings,
      "calibre",
    );

    expect(merged.series).toBe("Discworld");
    expect(merged.seriesNumber).toBeUndefined();
  });

  it("prefers the primary source's series over a secondary's", () => {
    const calibre = source("calibre", "Calibre", {
      series: "My Own Series Name",
      seriesNumber: 3,
    });
    const goodreads = source("goodreads", "Goodreads", {
      series: "Discworld",
      seriesNumber: "1",
    });

    const { merged } = mergeWithConflicts(
      calibre,
      goodreads,
      [],
      settings,
      "calibre",
    );

    expect(merged.series).toBe("My Own Series Name");
    expect(merged.seriesNumber).toBe(3);
  });

  it("leaves a book without any series alone", () => {
    const { merged } = mergeWithConflicts(
      source("google", "Google Books"),
      null,
      [],
      settings,
      "google",
    );
    expect(merged.series).toBeUndefined();
    expect(merged.seriesNumber).toBeUndefined();
  });

  it("falls back to a secondary source when neither primary nor Goodreads has one", () => {
    const secondary = source("storygraph", "StoryGraph", {
      series: "Discworld",
      seriesNumber: "1",
    });
    const { merged } = mergeWithConflicts(
      source("google", "Google Books"),
      null,
      [secondary],
      settings,
      "google",
    );
    expect(merged.series).toBe("Discworld");
    expect(merged.seriesNumber).toBe("1");
  });
});
