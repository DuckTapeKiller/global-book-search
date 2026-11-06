jest.mock("@settings/settings", () => ({
  DefaultFrontmatterKeyType: {
    snakeCase: "Snake Case",
    camelCase: "Camel Case",
  },
}));
jest.mock("@apis/base_api", () => ({ factoryServiceProvider: jest.fn() }));

import type { BookSearchPluginSettings } from "@settings/settings";
import { factoryServiceProvider } from "@apis/base_api";
import { globalSearch } from "@apis/global_search";
import { ProviderBlockedError } from "@utils/http";

const mockedFactory = factoryServiceProvider as unknown as jest.Mock;
const settings = {
  localePreference: "default",
  calibreServerUrl: "",
} as unknown as BookSearchPluginSettings;

const goodreadsBook = {
  title: "Dune",
  author: "Frank Herbert",
  authors: ["Frank Herbert"],
  coverUrl: "",
  link: "https://www.goodreads.com/book/show/234225",
};

beforeEach(() => {
  mockedFactory.mockReset();
  mockedFactory.mockImplementation((_settings: unknown, id: string) => ({
    getByQuery: () => {
      if (id === "storygraph") {
        return Promise.reject(
          new ProviderBlockedError("storygraph", 403, 600_000),
        );
      }
      return Promise.resolve(id === "goodreads" ? [goodreadsBook] : []);
    },
  }));
});

describe("globalSearch with a blocked provider", () => {
  it("still returns the other providers' results", async () => {
    const results = await globalSearch("dune", settings);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Dune");
    expect(results[0]._sourceIds).toEqual(["goodreads"]);
  });

  it("says the provider is blocked, without logging it as a failure", async () => {
    const progress: string[] = [];
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      await globalSearch("dune", settings, undefined, (m) => progress.push(m));
      expect(progress).toContain("StoryGraph — blocked");
      expect(progress).not.toContain("StoryGraph — no results");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("shows the provider's own short reason, such as a missing sign-in", async () => {
    mockedFactory.mockImplementation((_settings: unknown, id: string) => ({
      getByQuery: () =>
        id === "storygraph"
          ? Promise.reject(
              new ProviderBlockedError("storygraph", 403, 0, {
                message: "StoryGraph only answers signed-in requests.",
                shortReason: "sign-in needed",
              }),
            )
          : Promise.resolve([]),
    }));
    const progress: string[] = [];
    await globalSearch("dune", settings, undefined, (m) => progress.push(m));
    expect(progress).toContain("StoryGraph — sign-in needed");
  });

  it("still reports an ordinary provider failure as before", async () => {
    mockedFactory.mockImplementation((_settings: unknown, id: string) => ({
      getByQuery: () =>
        id === "google"
          ? Promise.reject(new Error("boom"))
          : Promise.resolve(id === "goodreads" ? [goodreadsBook] : []),
    }));
    const progress: string[] = [];
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      await globalSearch("dune", settings, undefined, (m) => progress.push(m));
      expect(progress).toContain("Google Books — no results");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
