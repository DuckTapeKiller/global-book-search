import { Book } from "@models/book.model";
import { BaseBooksApiImpl } from "@apis/base_api";
import { httpRequest } from "@utils/http";
import {
  ContributorKind,
  hardcoverContributorKind,
  samePerson,
} from "@utils/contributors";
import { sameTitle } from "@utils/editions";
import {
  isbnFromQuery,
  normalizeIsbn,
  toIsbn10,
  toIsbn13,
} from "@utils/existing_note";
import {
  asRecord,
  getArray,
  getNumber,
  getPath,
  getProp,
  getString,
  getStringArray,
  isRecord,
} from "@utils/json";

const HARDCOVER_GRAPHQL = "https://api.hardcover.app/v1/graphql";

// Diagnostic: runs the real queries with the user's own token (which never
// leaves their machine) and reports the API's responses/errors. GraphQL errors
// name the exact bad fields, so the user can paste the report (no token in it)
// and the queries can be corrected precisely.
export async function probeHardcover(apiToken: string): Promise<string> {
  const token = (apiToken || "").trim();
  if (!token)
    return "No Hardcover token set (Settings → Global Book Search → Sources → Hardcover).";
  const auth = token.toLowerCase().startsWith("bearer ")
    ? token
    : `Bearer ${token}`;

  const call = async (
    label: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<string> => {
    try {
      const res = await httpRequest(
        {
          url: HARDCOVER_GRAPHQL,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: auth,
          },
          body: JSON.stringify({ query, variables }),
        },
        { providerId: "hardcover", purpose: "probe", responseType: "json" },
      );
      const json = asRecord(res.json);
      const errors = getArray(json.errors);
      if (errors.length) {
        const msg = errors
          .map((e) => getString(getPath(e, ["message"])))
          .join(" | ");
        return `${label}: ERROR — ${msg}`;
      }
      const data = JSON.stringify(json.data ?? {});
      return `${label}: OK — ${data.slice(0, 240)}`;
    } catch (err) {
      return `${label}: request failed — ${String(err)}`;
    }
  };

  const lines: string[] = [];
  lines.push(await call("me", "query { me { username } }", {}));
  lines.push(
    await call(
      "search",
      `query S($q: String!) { search(query: $q, query_type: "Book", per_page: 3, page: 1) { results } }`,
      { q: "farewell to arms" },
    ),
  );
  lines.push(
    await call(
      "book+editions",
      `query B($id: Int!) { books(where: { id: { _eq: $id } }, limit: 1) { title pages release_year contributions { author { name } } image { url } editions(limit: 2) { isbn_13 isbn_10 pages publisher { name } } } }`,
      { id: 1 },
    ),
  );
  return lines.join("\n\n");
}

// What the queries ask Hardcover for: an edition, and the book (the work) it
// is an edition of. Contributions keep the order Hardcover credits them in.
const EDITION_FIELDS = `
  id title subtitle isbn_10 isbn_13 asin pages audio_seconds release_date
  edition_format
  reading_format { format }
  language { language code2 }
  publisher { name }
  image { url }
  contributions(order_by: { id: asc }) { contribution author { name } }`;

const BOOK_FIELDS = `
  id slug title description release_date release_year
  image { url }
  cached_tags
  contributions(order_by: { id: asc }) { contribution author { name } }
  featured_book_series { position series { name } }
  book_characters(order_by: { position: asc }, limit: 25) {
    spoiler only_mentioned character { name }
  }`;

// Hardcover names "National Geographic Books" as the publisher of thousands of
// editions it never published (Penguin Classics, Bantam, Debolsillo…), so the
// name says nothing about an edition.
const MEANINGLESS_PUBLISHERS = new Set(["national geographic books"]);

/**
 * A Hardcover date ("2006-01-03") the way the plugin writes dates
 * ("2006/01/03"). Hardcover stores a date it knows only by its year as
 * 1 January, so "1994-01-01" is just "1994".
 */
export function hardcoverDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "");
  if (!match) return "";
  const [, year, month, day] = match;
  return month === "01" && day === "01" ? year : `${year}/${month}/${day}`;
}

/**
 * The date of the edition itself, or "" when the date Hardcover has for it
 * is not the edition's. Hardcover copies a book's first publication date onto
 * many of its editions, in every language: a 2003 Penguin Crime and
 * Punishment is dated 1866, and 25 editions of My Brilliant Friend carry the
 * Italian original's 19 October 2011. So a date is not the edition's when it
 * is the book's own first publication date (that is {{firstPublishDate}}),
 * comes before the book existed or before ISBNs did, or falls in the year the
 * book first came out on a translation (translations hardly ever come out the
 * same year as the original).
 */
export function hardcoverEditionDate(
  edition: unknown,
  work: unknown,
  isTranslation: boolean,
): string {
  const date = getString(getProp(edition, "release_date"));
  const match = /^(\d{4})-\d{2}-\d{2}/.exec(date);
  if (!match) return "";
  const year = Number(match[1]);
  const workDate = getString(getProp(work, "release_date")).slice(0, 10);
  const workYear =
    getNumber(getProp(work, "release_year")) ||
    Number(workDate.slice(0, 4)) ||
    0;
  if (workDate && date.slice(0, 10) === workDate) return "";
  if (year < 1966) return "";
  if (workYear && year < workYear) return "";
  if (workYear && year === workYear && isTranslation) return "";
  return hardcoverDate(date);
}

/**
 * The names in one category of a book's tags ("Genre", "Mood"), most voted
 * first. Once some tag has two or more votes, tags a single reader added are
 * left out: they are where the noise is ("Fiction:Thriller", a mood "Crime").
 */
export function hardcoverTags(
  cachedTags: unknown,
  category: string,
  limit: number,
): string[] {
  const tags = getArray(getProp(cachedTags, category))
    .map((tag) => ({
      name: getString(getProp(tag, "tag")).trim(),
      count: getNumber(getProp(tag, "count")) ?? 0,
    }))
    .filter((tag) => tag.name)
    .sort((a, b) => b.count - a.count);
  const voted = (tags[0]?.count ?? 0) >= 2;
  const names: string[] = [];
  for (const tag of tags) {
    if (voted && tag.count < 2) break;
    if (names.some((name) => name.toLowerCase() === tag.name.toLowerCase())) {
      continue;
    }
    names.push(tag.name);
    if (names.length >= limit) break;
  }
  return names;
}

/** A name reduced to its letters, word order ignored ("Quixote Don" = "Don Quixote"). */
function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/**
 * The book's characters, without spoilers or characters only mentioned.
 * Hardcover's list also holds subject headings imported from library
 * catalogues: real people with their dates ("Fyodor Dostoyevsky
 * (1821-1881)"), the author ("Umberto Eco" in The Name of the Rose) and
 * "(Fictitious character)" labels; those are left out or cleaned.
 */
export function hardcoverCharacters(
  bookCharacters: unknown,
  authors: string[],
  limit = 10,
): string[] {
  const authorKeys = new Set(authors.map(nameKey));
  const keys = new Set<string>();
  const names: string[] = [];
  for (const entry of getArray(bookCharacters)) {
    if (getProp(entry, "spoiler") === true) continue;
    if (getProp(entry, "only_mentioned") === true) continue;
    const raw = getString(getPath(entry, ["character", "name"])).trim();
    if (/\(\s*\d{3,4}\s*-/.test(raw)) continue;
    const name = raw
      .replace(/\s*\((?:fictitious|fictional)\s+character\)\s*$/i, "")
      .trim();
    const key = nameKey(name);
    if (!key || authorKeys.has(key) || keys.has(key)) continue;
    keys.add(key);
    names.push(name);
    if (names.length >= limit) break;
  }
  return names;
}

/** The series and number, only when Hardcover gives the book's place in it. */
export function hardcoverSeries(featured: unknown): {
  series: string;
  seriesNumber: string;
} {
  const series = getString(getPath(featured, ["series", "name"])).trim();
  const position = getNumber(getProp(featured, "position"));
  // A series without a position is too often a wrong match (Pedro Páramo is
  // filed under a photography series).
  if (!series || position === undefined)
    return { series: "", seriesNumber: "" };
  return { series, seriesNumber: String(position) };
}

/** Hardcover descriptions are plain text with blank lines between paragraphs. */
function cleanDescription(text: string): string {
  return (text || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .split(/\s*\n\s*/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/[ \t]{2,}/g, " ");
}

/**
 * The book with its text in composed Unicode: Hardcover returns some names
 * decomposed ("Ca\u0301tedra"), which looks the same in a note but is not
 * found by a search for "Cátedra" and splits a list of publishers in two.
 */
function composed(book: Book): Book {
  const record = book as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") record[key] = value.normalize("NFC");
    else if (Array.isArray(value)) {
      record[key] = value.map((item: unknown) =>
        typeof item === "string" ? item.normalize("NFC") : item,
      );
    }
  }
  return book;
}

/** Contributor names by what their role makes them, in the order credited. */
function namesByKind(
  contributions: unknown,
): Record<ContributorKind, string[]> {
  const names: Record<ContributorKind, string[]> = {
    author: [],
    translator: [],
    narrator: [],
    other: [],
  };
  for (const contribution of getArray(contributions)) {
    const name = getString(getPath(contribution, ["author", "name"])).trim();
    if (!name) continue;
    const kind = hardcoverContributorKind(
      getString(getProp(contribution, "contribution")),
    );
    if (!names[kind].includes(name)) names[kind].push(name);
  }
  return names;
}

function hardcoverLink(work: unknown, edition?: unknown): string {
  const slug = getString(getProp(work, "slug"));
  if (!slug) return "";
  const editionId = getNumber(getProp(edition, "id"));
  return editionId === undefined
    ? `https://hardcover.app/books/${slug}`
    : `https://hardcover.app/books/${slug}/editions/${editionId}`;
}

/**
 * A note's book from one Hardcover edition and the book it belongs to. Every
 * edition detail (title, ISBN, publisher, date, pages, language, format,
 * translators, narrators, cover) comes from that one edition; the first
 * publication, description, series, genres, moods and characters are the
 * book's. Authors are the edition's, or the book's when the edition lists
 * none; translators and narrators only ever the edition's, since another
 * edition's translator is not this one's.
 */
export function bookFromHardcover(edition: unknown, work: unknown): Book {
  const editionPeople = namesByKind(getProp(edition, "contributions"));
  const workPeople = namesByKind(getProp(work, "contributions"));
  const authors = editionPeople.author.length
    ? editionPeople.author
    : workPeople.author;

  const readingFormat = getString(
    getPath(edition, ["reading_format", "format"]),
  );
  const editionFormat = getString(getProp(edition, "edition_format")).trim();
  const isAudio =
    readingFormat === "Listened" ||
    (getNumber(getProp(edition, "audio_seconds")) ?? 0) > 0 ||
    /audio/i.test(editionFormat);
  const format =
    editionFormat ||
    (readingFormat === "Listened"
      ? "Audiobook"
      : readingFormat === "Ebook"
        ? "Ebook"
        : "");
  const pages = getNumber(getProp(edition, "pages"));
  const publisher = getString(getPath(edition, ["publisher", "name"])).trim();
  const tags = getProp(work, "cached_tags");
  const genres = hardcoverTags(tags, "Genre", 5);
  const workYear = getNumber(getProp(work, "release_year"));
  const cover =
    getString(getPath(edition, ["image", "url"])) ||
    getString(getPath(work, ["image", "url"]));
  const link = hardcoverLink(work, isRecord(edition) ? edition : undefined);
  const workId = getNumber(getProp(work, "id"));

  return composed({
    title:
      getString(getProp(edition, "title")).trim() ||
      getString(getProp(work, "title")).trim(),
    subtitle: getString(getProp(edition, "subtitle")).trim(),
    author: authors[0] || "",
    authors,
    translator: editionPeople.translator.join(", "),
    narrator: editionPeople.narrator.join(", "),
    publisher: MEANINGLESS_PUBLISHERS.has(publisher.toLowerCase())
      ? ""
      : publisher,
    publishDate: hardcoverEditionDate(
      edition,
      work,
      editionPeople.translator.length > 0,
    ),
    firstPublishDate:
      hardcoverDate(getString(getProp(work, "release_date"))) ||
      (workYear ? String(workYear) : ""),
    totalPage: pages && !isAudio ? String(pages) : "",
    format,
    language: getString(getPath(edition, ["language", "language"]))
      .split(";")[0]
      .trim(),
    categories: genres.join(", "),
    category: genres[0] || "",
    moods: hardcoverTags(tags, "Mood", 5)
      .map((mood) => mood.toLowerCase())
      .join(", "),
    characters: hardcoverCharacters(
      getProp(work, "book_characters"),
      authors,
    ).join(", "),
    ...hardcoverSeries(getProp(work, "featured_book_series")),
    description: cleanDescription(getString(getProp(work, "description"))),
    isbn13: getString(getProp(edition, "isbn_13")).trim(),
    isbn10: getString(getProp(edition, "isbn_10")).trim(),
    asin: getString(getProp(edition, "asin")).trim(),
    originalTitle: "",
    coverUrl: cover,
    coverSmallUrl: cover,
    link,
    previewLink: link,
    sourceProvider: "hardcover",
    sourceId: workId === undefined ? "" : String(workId),
  });
}

/**
 * A search result: a book (the work), not one of its editions yet. Its ISBN
 * list covers every edition in every language, so no ISBN is taken from it
 * (the first one was a Polish edition of The Name of the Rose); getBook picks
 * the edition. Authors are told apart from translators and other
 * contributors by their role.
 */
export function bookFromHardcoverSearchHit(document: unknown): Book | null {
  const title = getString(getProp(document, "title")).trim();
  if (!title) return null;
  const people = namesByKind(getProp(document, "contributions"));
  const authors = people.author.length
    ? people.author
    : getStringArray(getProp(document, "author_names")).slice(0, 1);
  const genres = getStringArray(getProp(document, "genres")).slice(0, 5);
  const year = getNumber(getProp(document, "release_year"));
  const cover = getString(getPath(document, ["image", "url"]));
  const link = hardcoverLink(document);
  const id = getProp(document, "id");
  return composed({
    title,
    author: authors[0] || "",
    authors,
    coverUrl: cover,
    coverSmallUrl: cover,
    description: cleanDescription(getString(getProp(document, "description"))),
    publisher: "",
    publishDate: "",
    firstPublishDate:
      hardcoverDate(getString(getProp(document, "release_date"))) ||
      (year ? String(year) : ""),
    totalPage: "",
    categories: genres.join(", "),
    category: genres[0] || "",
    ...hardcoverSeries(getProp(document, "featured_series")),
    isbn10: "",
    isbn13: "",
    asin: "",
    originalTitle: "",
    translator: "",
    narrator: "",
    subtitle: "",
    link,
    previewLink: link,
    sourceProvider: "hardcover",
    sourceId:
      typeof id === "number" ? String(id) : getString(id).replace(/\D/g, ""),
  });
}

/**
 * The edition to make a note from when the reader picked a book rather than
 * an edition: one in the reader's language when Hardcover has one (so a
 * Spanish reader gets "El proceso", not "The Trial"), else Hardcover's default
 * printed edition, else the most read edition with an ISBN.
 */
export function chooseHardcoverEdition(
  work: unknown,
  language: string,
): unknown {
  const hasIsbn = (edition: unknown): boolean =>
    !!getString(getProp(edition, "isbn_13")) ||
    !!getString(getProp(edition, "isbn_10"));
  const isComplete = (edition: unknown): boolean => {
    const publisher = getString(getPath(edition, ["publisher", "name"]));
    return (
      hasIsbn(edition) &&
      !!getNumber(getProp(edition, "pages")) &&
      !!publisher &&
      !MEANINGLESS_PUBLISHERS.has(publisher.toLowerCase())
    );
  };
  const preferred = getProp(work, "default_physical_edition");
  const inLanguage = getArray(getProp(work, "in_language"));
  const popular = getArray(getProp(work, "popular"));
  const languageOf = (edition: unknown): string =>
    getString(getPath(edition, ["language", "code2"]));

  if (hasIsbn(preferred) && languageOf(preferred) === language)
    return preferred;
  const local = inLanguage.find(isComplete) || inLanguage.find(hasIsbn);
  if (local) return local;
  if (hasIsbn(preferred)) return preferred;
  return popular.find(isComplete) || popular.find(hasIsbn) || null;
}

/** The search result's values, with every value the edition has put over them. */
function withEdition(base: Book, edition: Book): Book {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(edition)) {
    const filled =
      typeof value === "string"
        ? value.trim() !== ""
        : Array.isArray(value)
          ? value.length > 0
          : value !== undefined && value !== null;
    if (filled) merged[key] = value;
  }
  return merged as unknown as Book;
}

// Hardcover (https://hardcover.app) sits behind Cloudflare's JS challenge, so
// its pages can't be scraped from Obsidian. Its GraphQL API, however, is
// directly reachable and just needs a personal Bearer token (Account → API).
// This provider is therefore token-gated: with no token it returns nothing.
export class HardcoverApi implements BaseBooksApiImpl {
  // The reader's language as a 2-letter code ("es"), for picking an edition.
  private readonly language: string;
  // Editions already fetched by ISBN-13, so getBook after an ISBN search
  // costs no second request.
  private readonly editions = new Map<string, Book>();

  constructor(
    private readonly apiToken: string,
    locale = "en",
  ) {
    const code = (locale || "en").slice(0, 2).toLowerCase();
    this.language = /^[a-z]{2}$/.test(code) ? code : "en";
  }

  private get token(): string {
    return (this.apiToken || "").trim();
  }

  private authHeader(): string {
    const t = this.token;
    return t.toLowerCase().startsWith("bearer ") ? t : `Bearer ${t}`;
  }

  private async graphql(
    query: string,
    variables: Record<string, unknown>,
    purpose: string,
  ): Promise<unknown> {
    const res = await httpRequest(
      {
        url: HARDCOVER_GRAPHQL,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "obsidian-global-book-search",
          Authorization: this.authHeader(),
        },
        body: JSON.stringify({ query, variables }),
      },
      { providerId: "hardcover", purpose, responseType: "json" },
    );
    const errors = getArray(getProp(res.json, "errors"));
    if (errors.length) {
      throw new Error(
        `Hardcover: ${errors.map((e) => getString(getProp(e, "message"))).join("; ")}`,
      );
    }
    return res.json;
  }

  async getByQuery(query: string): Promise<Book[]> {
    if (!this.token) return [];
    try {
      const isbn = isbnFromQuery(query);
      if (isbn) {
        const edition = await this.editionByIsbn(isbn);
        return edition ? [edition] : [];
      }

      const json = await this.graphql(
        `query SearchBooks($query: String!) {
          search(query: $query, query_type: "Book", per_page: 20, page: 1) {
            results
          }
        }`,
        { query },
        "search",
      );
      const hits = getArray(
        getPath(json, ["data", "search", "results", "hits"]),
      );
      return hits
        .map((hit) => bookFromHardcoverSearchHit(getProp(hit, "document")))
        .filter((book): book is Book => book !== null);
    } catch (error) {
      console.warn("Hardcover search error", error);
      return [];
    }
  }

  async getBook(book: Book): Promise<Book> {
    if (!this.token) return book;
    try {
      // An ISBN names one edition: that edition, never another one.
      const isbn = normalizeIsbn(book.isbn13) || normalizeIsbn(book.isbn10);
      if (isbn) {
        const edition = await this.editionByIsbn(isbn);
        return edition ? withEdition(book, edition) : book;
      }
      const id = Number(book.sourceId);
      if (!book.sourceId || !Number.isInteger(id)) return book;
      const edition = await this.editionOfBook(id);
      return edition ? withEdition(book, edition) : book;
    } catch (error) {
      console.warn("Hardcover getBook error", error);
      return book;
    }
  }

  /**
   * Hardcover's editions with an ISBN of the book another source describes,
   * of about its length, for finding the same edition when that source has
   * no ISBN for it. The book is found by title and author, among the most
   * read matches.
   */
  async editionsLike(book: Book): Promise<Book[]> {
    if (!this.token || !book.title) return [];
    const json = await this.graphql(
      `query SearchBooks($query: String!) {
        search(query: $query, query_type: "Book", per_page: 10, page: 1) {
          results
        }
      }`,
      { query: `${book.title} ${book.author || ""}`.trim() },
      "search",
    );
    const works = getArray(getPath(json, ["data", "search", "results", "hits"]))
      .map((hit) => getProp(hit, "document"))
      .filter(
        (document) =>
          sameTitle(getString(getProp(document, "title")), book.title) &&
          (!book.author ||
            getStringArray(getProp(document, "author_names")).some((name) =>
              samePerson(name, book.author),
            )),
      )
      .sort(
        (a, b) =>
          (getNumber(getProp(b, "users_count")) ?? 0) -
          (getNumber(getProp(a, "users_count")) ?? 0),
      )
      .slice(0, 3);
    const ids = works
      .map((document) => Number(getProp(document, "id")))
      .filter((id) => Number.isInteger(id));
    if (!ids.length) return [];

    const pages = parseInt(String(book.totalPage ?? ""), 10);
    const length = pages > 0 ? { _gte: pages - 1, _lte: pages + 1 } : null;
    const editions = await this.graphql(
      `query EditionsLike($where: editions_bool_exp!) {
        editions(where: $where, order_by: { users_count: desc_nulls_last }, limit: 100) {
          ${EDITION_FIELDS}
          book { id slug title release_date release_year }
        }
      }`,
      {
        where: {
          book_id: { _in: ids },
          isbn_13: { _is_null: false },
          ...(length ? { pages: length } : {}),
        },
      },
      "editions",
    );
    return getArray(getPath(editions, ["data", "editions"])).map((edition) =>
      bookFromHardcover(edition, getProp(edition, "book")),
    );
  }

  /** The edition with this ISBN (either form), or null when Hardcover has none. */
  private async editionByIsbn(isbn: string): Promise<Book | null> {
    const isbn13 = toIsbn13(isbn);
    const known = this.editions.get(isbn13);
    if (known) return known;
    // A 979 ISBN has no ISBN-10; the ISBN-13 then stands in, matching nothing.
    const isbn10 = toIsbn10(isbn13) || isbn13;
    const json = await this.graphql(
      `query EditionByIsbn($isbn13: String!, $isbn10: String!) {
        editions(
          where: { _or: [{ isbn_13: { _eq: $isbn13 } }, { isbn_10: { _eq: $isbn10 } }] }
          order_by: { users_count: desc_nulls_last }
          limit: 3
        ) {
          ${EDITION_FIELDS}
          book { ${BOOK_FIELDS} }
        }
      }`,
      { isbn13, isbn10 },
      "book",
    );
    const edition = getArray(getPath(json, ["data", "editions"])).find((e) =>
      isRecord(getProp(e, "book")),
    );
    if (!edition) return null;
    const book = bookFromHardcover(edition, getProp(edition, "book"));
    // Hardcover sometimes files an edition under one ISBN form only.
    book.isbn13 = book.isbn13 || isbn13;
    book.isbn10 = book.isbn10 || toIsbn10(isbn13);
    this.editions.set(isbn13, book);
    return book;
  }

  /** The edition a note should be made from when the reader picked a book. */
  private async editionOfBook(id: number): Promise<Book | null> {
    const json = await this.graphql(
      `query BookEditions($id: Int!, $language: String!) {
        books(where: { id: { _eq: $id } }, limit: 1) {
          ${BOOK_FIELDS}
          default_physical_edition { ${EDITION_FIELDS} }
          in_language: editions(
            where: { language: { code2: { _eq: $language } }, isbn_13: { _is_null: false } }
            order_by: { users_count: desc_nulls_last }
            limit: 5
          ) { ${EDITION_FIELDS} }
          popular: editions(
            where: { isbn_13: { _is_null: false } }
            order_by: { users_count: desc_nulls_last }
            limit: 3
          ) { ${EDITION_FIELDS} }
        }
      }`,
      { id, language: this.language },
      "book",
    );
    const work = getArray(getPath(json, ["data", "books"]))[0];
    if (!isRecord(work)) return null;
    return bookFromHardcover(chooseHardcoverEdition(work, this.language), work);
  }
}
