export interface FrontMatter {
  [key: string]: string | string[];
}

export interface Book {
  // Required — every API must provide these
  title: string;
  author: string;
  authors: string[];
  coverUrl: string;
  link: string;

  // Optional — explicitly typed
  subtitle?: string;
  isbn10?: string;
  isbn13?: string;
  isbn?: string; // used by some APIs as a catch-all
  description?: string;
  publisher?: string;
  publishDate?: string;
  totalPage?: number | string;
  categories?: string;
  category?: string;
  originalTitle?: string;
  translator?: string;
  narrator?: string;
  asin?: string;

  // Edition and work details from Goodreads.
  format?: string; // the edition's format: "Paperback", "Kindle Edition", "Audible Audio"
  language?: string; // the edition's language: "English", "Spanish"
  firstPublishDate?: string; // when the work first came out, as yyyy/mm/dd (or just the year)

  // StoryGraph's moods ("adventurous, dark") and pace ("fast-paced").
  moods?: string;
  pace?: string;

  // Populated by plugin, not APIs
  tags?: string[];
  localCoverImage?: string;

  // LibraryThing "Common Knowledge" fields (characters and places also come
  // from Goodreads). Available as template variables (e.g. {{characters}});
  // not part of the default frontmatter template.
  characters?: string;
  places?: string;
  events?: string;
  firstWords?: string;
  lastWords?: string;
  quotes?: string;
  dedication?: string;
  blurbers?: string;
  originalLanguage?: string;
  relatedMovies?: string;

  // Series. Providers set `series` and `seriesNumber`; `seriesLink` (a
  // [[wikilink]] to the series, empty when linking is switched off) is derived
  // by `applySeriesFields` when the note is rendered.
  series?: string;
  seriesNumber?: number | string;
  seriesLink?: string;

  // Calibre-specific
  ids?: string;
  customColumns?: Record<string, unknown>;
  sourceProvider?: string;
  sourceId?: string;

  // Extra UI/UX fields
  status?: string;
  startReadDate?: string;
  finishReadDate?: string;
  myRate?: number | string;
  bookNote?: string;
  currentPage?: number | string;
  readingProgress?: number | string;
  previewLink?: string;
  coverSmallUrl?: string;
  coverMediumUrl?: string;
  coverLargeUrl?: string;
}
