import { Book } from "@models/book.model";
import { BaseBooksApiImpl } from "@apis/base_api";
import { httpRequest } from "@utils/http";
import { contributorKind } from "@utils/contributors";
import { parseBookDate } from "@utils/dates";
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
  JsonRecord,
} from "@utils/json";

const OPEN_LIBRARY = "https://openlibrary.org";

// The MARC codes Open Library files languages under ("/languages/eng").
const LANGUAGE_NAMES: Record<string, string> = {
  eng: "English",
  spa: "Spanish",
  fre: "French",
  ger: "German",
  ita: "Italian",
  por: "Portuguese",
  cat: "Catalan",
  glg: "Galician",
  baq: "Basque",
  dut: "Dutch",
  swe: "Swedish",
  nor: "Norwegian",
  dan: "Danish",
  fin: "Finnish",
  ice: "Icelandic",
  pol: "Polish",
  cze: "Czech",
  slo: "Slovak",
  slv: "Slovenian",
  hun: "Hungarian",
  rum: "Romanian",
  bul: "Bulgarian",
  srp: "Serbian",
  hrv: "Croatian",
  rus: "Russian",
  ukr: "Ukrainian",
  gre: "Greek",
  tur: "Turkish",
  ara: "Arabic",
  heb: "Hebrew",
  per: "Persian",
  hin: "Hindi",
  jpn: "Japanese",
  chi: "Chinese",
  kor: "Korean",
  vie: "Vietnamese",
  tha: "Thai",
  ind: "Indonesian",
  lat: "Latin",
  wel: "Welsh",
  gle: "Irish",
};

// The reader's two-letter language and Open Library's code for it.
const LANGUAGE_CODES: Record<string, string> = {
  en: "eng",
  es: "spa",
  fr: "fre",
  de: "ger",
  it: "ita",
  pt: "por",
  ca: "cat",
  nl: "dut",
  sv: "swe",
  da: "dan",
  fi: "fin",
  pl: "pol",
  cs: "cze",
  hu: "hun",
  ro: "rum",
  ru: "rus",
  uk: "ukr",
  el: "gre",
  tr: "tur",
  ar: "ara",
  he: "heb",
  ja: "jpn",
  zh: "chi",
  ko: "kor",
};

/** The name of an edition's first language ("/languages/spa" → "Spanish"), or "". */
export function openLibraryLanguage(languages: unknown): string {
  const key = getString(getProp(getArray(languages)[0], "key"));
  return LANGUAGE_NAMES[key.split("/").pop() || ""] || "";
}

function isLatin(text: string): boolean {
  return (
    /\p{Script=Latin}/u.test(text) &&
    /^[\p{Script=Latin}\p{M}\p{N}\s.,'’()&-]+$/u.test(text)
  );
}

/**
 * An author's name as the note should give it. Open Library names some
 * authors in their own script ("村上春樹"); an edition with a title in Latin
 * script gets the Latin form it also lists ("Murakami, Haruki" → "Haruki
 * Murakami").
 */
export function openLibraryAuthorName(author: unknown, latin: boolean): string {
  const name = getString(getProp(author, "name")).trim();
  if (!latin || !name || isLatin(name)) return name;
  const forms = [
    getString(getProp(author, "personal_name")),
    ...getStringArray(getProp(author, "alternate_names")),
  ];
  for (const form of forms) {
    const value = form.trim();
    // Shouting forms ("HARUKI MURAKAMI") are catalogue keys, not names.
    if (!value || !isLatin(value) || value === value.toUpperCase()) continue;
    const inverted = /^([^,]+),\s*([^,]+)$/.exec(value);
    return inverted ? `${inverted[2]} ${inverted[1]}` : value;
  }
  return name;
}

/**
 * Translators named in an edition's statement of responsibility ("Umberto
 * Eco ; translated from the Italian by William Weaver.").
 */
export function translatorsFromStatement(statement: string): string[] {
  const match = /\btranslated\b[^;]*?\bby\s+([^;]+)/i.exec(statement || "");
  if (!match) return [];
  return match[1]
    .replace(/[.\s]+$/, "")
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map((name) => name.trim())
    .filter(
      (name) =>
        /^\p{Lu}[\p{L}.'’-]*(?:\s+\p{L}[\p{L}.'’-]*)+$/u.test(name) &&
        !/\b(?:author|others)\b/i.test(name),
    );
}

// Subjects that are Open Library's own bookkeeping rather than a subject.
const NOT_A_SUBJECT =
  /[:=]|\b(?:accessible book|protected daisy|in library|large type books|lending library|overdrive|open library staff picks|internet archive wishlist)\b/i;

function subjectsOf(values: string[]): string[] {
  return values
    .map((subject) => subject.trim())
    .filter((subject) => subject && !NOT_A_SUBJECT.test(subject))
    .slice(0, 8);
}

/** A work's or edition's description, without its links and appended notes. */
function descriptionText(value: unknown): string {
  const text =
    typeof value === "string" ? value : getString(getProp(value, "value"));
  return text
    .split(/\n\s*-{3,}/)[0]
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function coverUrl(record: unknown): string {
  const id = getArray(getProp(record, "covers"))
    .map((cover) => getNumber(cover) ?? 0)
    .find((cover) => cover > 0);
  return id ? `https://covers.openlibrary.org/b/id/${id}-L.jpg` : "";
}

/**
 * An edition's title without the notes in brackets that imported records
 * carry ("1984 (Contemporanea (Debolsillo)) (Spanish Edition)",
 * "Crime and Punishment (Penguin Classics)").
 */
function cleanTitle(title: string): string {
  let value = title.trim();
  for (;;) {
    const stripped = value.replace(/\s*\((?:[^()]|\([^()]*\))*\)\s*$/, "");
    if (!stripped || stripped === value) return value;
    value = stripped.trim();
  }
}

function capitalised(text: string): string {
  const value = text.trim();
  return value ? value[0].toUpperCase() + value.slice(1) : "";
}

/** The edition's ISBN-13 and ISBN-10, the one asked for first when it lists several. */
function editionIsbns(
  edition: unknown,
  wanted = "",
): { isbn13: string; isbn10: string } {
  const all = [
    ...getStringArray(getProp(edition, "isbn_13")),
    ...getStringArray(getProp(edition, "isbn_10")),
  ]
    .map((isbn) => toIsbn13(normalizeIsbn(isbn)))
    .filter(Boolean);
  const isbn13 = all.includes(wanted) ? wanted : all[0] || "";
  return { isbn13, isbn10: toIsbn10(isbn13) };
}

/**
 * The book of one Open Library edition: the edition's own title, publisher,
 * date, pages, binding, language, ISBNs, cover, original title and
 * translators, with its work's description, subjects and first publication
 * and its authors' names.
 */
export function bookFromOpenLibraryEdition(
  edition: unknown,
  work: unknown,
  authors: unknown[],
  wantedIsbn = "",
): Book {
  const title = cleanTitle(getString(getProp(edition, "title")));
  const latin = isLatin(title);
  const names = authors
    .map((author) => openLibraryAuthorName(author, latin))
    .filter((name, i, all) => name && all.indexOf(name) === i);
  const people = getArray(getProp(edition, "contributors"));
  const role = (kind: string): string[] =>
    people
      .filter(
        (person) =>
          contributorKind(getString(getProp(person, "role"))) === kind,
      )
      .map((person) => getString(getProp(person, "name")).trim())
      .filter(Boolean);
  const translators = [
    ...role("translator"),
    ...translatorsFromStatement(getString(getProp(edition, "by_statement"))),
  ].filter((name, i, all) => all.indexOf(name) === i);
  const publishDate = parseBookDate(
    getString(getProp(edition, "publish_date")),
  );
  const subjects = subjectsOf(getStringArray(getProp(work, "subjects")));
  const pages = getNumber(getProp(edition, "number_of_pages"));
  const cover = coverUrl(edition) || coverUrl(work);
  const key = getString(getProp(edition, "key"));
  const link = key ? `${OPEN_LIBRARY}${key}` : "";

  return {
    title,
    subtitle: getString(getProp(edition, "subtitle")).trim(),
    author: names[0] || "",
    authors: names,
    translator: translators.join(", "),
    narrator: role("narrator").join(", "),
    publisher: getStringArray(getProp(edition, "publishers"))[0]?.trim() || "",
    publishDate,
    // No first publication: Open Library's is too often wrong (1884 for
    // Crime and Punishment, 1896 for Don Quixote, 1999 for Cien años).
    totalPage: pages ? String(pages) : "",
    format: capitalised(getString(getProp(edition, "physical_format"))),
    language: openLibraryLanguage(getProp(edition, "languages")),
    originalTitle: getString(getProp(edition, "translation_of")).trim(),
    ...editionIsbns(edition, wantedIsbn),
    asin: "",
    description:
      descriptionText(getProp(edition, "description")) ||
      descriptionText(getProp(work, "description")),
    categories: subjects.join(", "),
    category: subjects[0] || "",
    coverUrl: cover,
    coverSmallUrl: cover,
    link,
    previewLink: link,
    sourceProvider: "openlibrary",
  };
}

/**
 * The edition to make a note from when the reader picked a book rather than
 * an edition: one with an ISBN in the reader's language, as complete as
 * there is, else the most complete one with an ISBN.
 */
export function chooseOpenLibraryEdition(
  editions: unknown[],
  language: string,
): unknown {
  const hasIsbn = (edition: unknown): boolean => !!editionIsbns(edition).isbn13;
  const complete = (edition: unknown): boolean =>
    hasIsbn(edition) &&
    !!getNumber(getProp(edition, "number_of_pages")) &&
    getStringArray(getProp(edition, "publishers")).length > 0;
  const inLanguage = (edition: unknown): boolean =>
    getArray(getProp(edition, "languages")).some(
      (entry) => getString(getProp(entry, "key")) === `/languages/${language}`,
    );
  return (
    editions.find((e) => inLanguage(e) && complete(e)) ||
    editions.find((e) => inLanguage(e) && hasIsbn(e)) ||
    editions.find(complete) ||
    editions.find(hasIsbn) ||
    null
  );
}

export class OpenLibraryApi implements BaseBooksApiImpl {
  static readonly API_VERSION = "2026-05-13";

  // The reader's language as Open Library codes it ("spa").
  private readonly language: string;
  // Books already read, by edition link, so getBook after a search is free.
  private readonly editions = new Map<string, Book>();

  constructor(locale = "en") {
    this.language =
      LANGUAGE_CODES[(locale || "en").slice(0, 2).toLowerCase()] || "eng";
  }

  private async json(url: string, purpose: string): Promise<JsonRecord | null> {
    const res = await httpRequest(
      { url, method: "GET", headers: { Accept: "application/json" } },
      {
        providerId: "openlibrary",
        purpose,
        responseType: "json",
        cacheTtlMs: 300_000,
      },
    );
    return res.status === 200 && isRecord(res.json) ? res.json : null;
  }

  async getByQuery(query: string): Promise<Book[]> {
    try {
      // An ISBN names one edition: answer with that edition, not its work.
      const isbn = isbnFromQuery(query);
      if (isbn) {
        const book = await this.editionByIsbn(isbn);
        return book ? [book] : [];
      }

      // Use general search for better results: https://openlibrary.org/dev/docs/api/search
      const searchUrl = `${OPEN_LIBRARY}/search.json?q=${encodeURIComponent(query)}&limit=20`;
      const searchRes = await httpRequest(
        {
          url: searchUrl,
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
        {
          providerId: "openlibrary",
          purpose: "search",
          responseType: "json",
          cacheTtlMs: 60_000,
        },
      );

      if (searchRes.status !== 200) {
        return [];
      }

      const results = asRecord(searchRes.json);
      return getArray(results.docs).map((doc) => this.mapResultToBook(doc));
    } catch (error) {
      console.warn("OpenLibrary search error", error);
      return [];
    }
  }

  async getBook(book: Book): Promise<Book> {
    try {
      const keyMatch = (book.link || "").match(/\/(works|books)\/OL\w+/);
      if (!keyMatch) return book;
      const key = keyMatch[0];
      const known = this.editions.get(`${OPEN_LIBRARY}${key}`);
      if (known) return withEdition(book, known);

      if (key.startsWith("/works/")) {
        // A book picked from a search: make the note from one of its
        // editions, every edition detail from that same edition.
        const data = await this.json(
          `${OPEN_LIBRARY}${key}/editions.json?limit=50`,
          "editions",
        );
        const edition = chooseOpenLibraryEdition(
          getArray(data?.entries),
          this.language,
        );
        if (!isRecord(edition)) return book;
        return withEdition(book, await this.completeEdition(edition));
      }

      const edition = await this.json(`${OPEN_LIBRARY}${key}.json`, "detail");
      return edition
        ? withEdition(book, await this.completeEdition(edition))
        : book;
    } catch (error) {
      console.warn("OpenLibrary enrichment error", error);
      return book;
    }
  }

  /**
   * Open Library's editions with an ISBN of the book another source
   * describes, for finding the same edition when that source has no ISBN.
   */
  async editionsLike(book: Book): Promise<Book[]> {
    if (!book.title) return [];
    const params = new URLSearchParams({
      title: book.title.replace(/\s*[([].*$/, ""),
      fields: "key,title,editions,editions.title",
      limit: "5",
    });
    if (book.author) params.set("author", book.author);
    const search = await this.json(
      `${OPEN_LIBRARY}/search.json?${params.toString()}`,
      "search",
    );
    const works = getArray(search?.docs)
      .filter(
        (doc) =>
          sameTitle(getString(getProp(doc, "title")), book.title) ||
          getArray(getPath(doc, ["editions", "docs"])).some((edition) =>
            sameTitle(getString(getProp(edition, "title")), book.title),
          ),
      )
      .map((doc) => getString(getProp(doc, "key")))
      .filter((key) => key.startsWith("/works/"))
      .slice(0, 2);

    const candidates: Book[] = [];
    for (const work of works) {
      const data = await this.json(
        `${OPEN_LIBRARY}${work}/editions.json?limit=100`,
        "editions",
      );
      for (const edition of getArray(data?.entries)) {
        if (!editionIsbns(edition).isbn13) continue;
        candidates.push(bookFromOpenLibraryEdition(edition, null, []));
      }
    }
    return candidates;
  }

  /**
   * The edition with this ISBN. Open Library answers an ISBN it does not have
   * with some other book, so only an edition that lists the ISBN is it.
   */
  private async editionByIsbn(isbn: string): Promise<Book | null> {
    const isbn13 = toIsbn13(isbn);
    const edition = await this.json(
      `${OPEN_LIBRARY}/isbn/${isbn13}.json`,
      "edition",
    );
    if (!edition || editionIsbns(edition, isbn13).isbn13 !== isbn13) {
      return null;
    }
    return this.completeEdition(edition, isbn13);
  }

  /** An edition with its work's description and its authors' names. */
  private async completeEdition(
    edition: JsonRecord,
    wantedIsbn = "",
  ): Promise<Book> {
    const workKey = getString(getProp(getArray(edition.works)[0], "key"));
    const work = workKey
      ? await this.json(`${OPEN_LIBRARY}${workKey}.json`, "work")
      : null;
    const authorKeys = (
      getArray(edition.authors).length
        ? getArray(edition.authors).map((a) => getString(getProp(a, "key")))
        : getArray(work?.authors).map((a) =>
            getString(getPath(a, ["author", "key"])),
          )
    )
      .filter((key) => key.startsWith("/authors/"))
      .slice(0, 3);
    const authors = await Promise.all(
      authorKeys.map((key) =>
        this.json(`${OPEN_LIBRARY}${key}.json`, "author").catch(() => null),
      ),
    );
    const book = bookFromOpenLibraryEdition(
      edition,
      work,
      authors.filter(isRecord),
      wantedIsbn,
    );
    if (book.link) this.editions.set(book.link, book);
    return book;
  }

  /**
   * A search result: a book (Open Library's work), not one of its editions.
   * Its ISBNs and dates cover every edition, so none of them is taken for an
   * edition's: getBook picks the edition.
   */
  private mapResultToBook(raw: unknown): Book {
    const doc = asRecord(raw);
    const title = getString(doc.title);
    const authors = getStringArray(doc.author_name);
    const author = authors[0] || "";

    const coverId = getNumber(doc.cover_i);
    const coverUrl = coverId
      ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
      : "";
    const key = getString(doc.key);
    const link = key ? `${OPEN_LIBRARY}${key}` : "";
    const subjects = subjectsOf(getStringArray(doc.subject));

    return {
      title,
      author,
      authors,
      coverUrl,
      coverSmallUrl: coverUrl,
      publishDate: "",
      publisher: "",
      isbn10: "",
      isbn13: "",
      totalPage: "",
      link,
      previewLink: link,
      description: "",
      categories: subjects.join(", "),
      category: subjects[0] || "",
      asin: "",
      originalTitle: "",
      translator: "",
      tags: [],
      sourceProvider: "openlibrary",
    };
  }
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
