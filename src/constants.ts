export enum ServiceProvider {
  google = "google",
  goodreads = "goodreads",
  calibre = "calibre",
  openlibrary = "openlibrary",
  storygraph = "storygraph",
  hardcover = "hardcover",
  librarything = "librarything",
}

export const GLOBAL_SEARCH_SOURCE_LABELS: Record<string, string> = {
  goodreads: "Goodreads",
  google: "Google Books",
  openlibrary: "OpenLibrary",
  storygraph: "StoryGraph",
  calibre: "Calibre",
  hardcover: "Hardcover",
  librarything: "LibraryThing",
  fable: "Fable",
  loc: "Library of Congress",
};
