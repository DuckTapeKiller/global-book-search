export enum ServiceProvider {
  google = "google",
  goodreads = "goodreads",
  calibre = "calibre",
  openlibrary = "openlibrary",
  storygraph = "storygraph",
}

export const GLOBAL_SEARCH_SOURCE_LABELS: Record<string, string> = {
  goodreads: "Goodreads",
  google: "Google Books",
  openlibrary: "OpenLibrary",
  storygraph: "StoryGraph",
  calibre: "Calibre",
};
