import { Book } from "@models/book.model";
import { BaseBooksApiImpl } from "@apis/base_api";
import { httpRequest } from "@utils/http";
import {
  asRecord,
  getArray,
  getNumber,
  getPath,
  getString,
  getStringArray,
} from "@utils/json";

// LibraryThing's HTML pages and its REST/covers APIs all sit behind Cloudflare's
// JS challenge, which Obsidian's requestUrl cannot solve. Two endpoints are NOT
// challenged and together make a complete, Cloudflare-free provider:
//   • Talpa Search API (token-gated JSON)  → query → work_id + title + ISBNs
//   • The Wayback Machine (archive.org)     → work_id → archived work page (CK)
const TALPA_API = "https://www.librarything.com/api/talpa.php";
const WAYBACK_AVAIL = "https://archive.org/wayback/available";
const LT_WORK = "https://www.librarything.com/work";
// Page count + publisher aren't on the work page (they're edition-specific);
// OpenLibrary resolves them from the ISBN Talpa returns (open, no Cloudflare).
const OPENLIBRARY_BOOKS = "https://openlibrary.org/api/books";
const OPENLIBRARY = "https://openlibrary.org";

// Reader locale (2-letter) → OpenLibrary language code (ISO 639-2/B). Used to
// surface the edition in the reader's language (e.g. "El proceso", not "The
// Trial"). "eng"/unknown means no localisation.
const OL_LANGUAGE: Record<string, string> = {
  es: "spa",
  fr: "fre",
  de: "ger",
  it: "ita",
  pt: "por",
  nl: "dut",
  ca: "cat",
  gl: "glg",
  eu: "baq",
  ru: "rus",
  ja: "jpn",
  zh: "chi",
  ko: "kor",
  pl: "pol",
  sv: "swe",
  da: "dan",
  no: "nor",
  fi: "fin",
  tr: "tur",
  cs: "cze",
  el: "gre",
  he: "heb",
  ar: "ara",
  en: "eng",
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

// The Wayback Machine serves LibraryThing's English locale, where Common
// Knowledge rows are plain `<dt>Label</dt><dd>value</dd>` pairs. Map the stable
// English labels onto Book fields.
export const CK_FIELD_BY_LABEL: Record<string, keyof Book> = {
  "canonical title": "title",
  "original title": "originalTitle",
  "original publication date": "publishDate",
  "people/characters": "characters",
  "important places": "places",
  "important events": "events",
  "first words": "firstWords",
  "last words": "lastWords",
  quotations: "quotes",
  dedication: "dedication",
  "original language": "originalLanguage",
  "related movies": "relatedMovies",
};

const NAMED_ENTITIES: Record<string, string> = {
  agrave: "à",
  aacute: "á",
  acirc: "â",
  atilde: "ã",
  auml: "ä",
  aring: "å",
  ccedil: "ç",
  egrave: "è",
  eacute: "é",
  ecirc: "ê",
  euml: "ë",
  igrave: "ì",
  iacute: "í",
  icirc: "î",
  iuml: "ï",
  ntilde: "ñ",
  ograve: "ò",
  oacute: "ó",
  ocirc: "ô",
  otilde: "õ",
  ouml: "ö",
  oslash: "ø",
  ugrave: "ù",
  uacute: "ú",
  ucirc: "û",
  uuml: "ü",
  yacute: "ý",
  szlig: "ß",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  thinsp: " ",
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d: string) =>
      String.fromCodePoint(parseInt(d, 10)),
    )
    .replace(/&([a-z]+);/gi, (whole, name: string) => {
      const lower = name.toLowerCase();
      if (lower === "amp") return "&";
      if (lower === "quot") return '"';
      if (lower === "apos") return "'";
      if (lower === "lt") return "<";
      if (lower === "gt") return ">";
      if (lower === "nbsp") return " ";
      return NAMED_ENTITIES[lower] ?? whole;
    });
}

/** Strip all tags from an HTML fragment and return clean, collapsed text. */
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s+([;,.:!?])/g, "$1")
    .trim();
}

function metaContent(html: string, property: string): string {
  const re = new RegExp(
    `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`,
    "i",
  );
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : "";
}

/** Parse the Common Knowledge `<dl>` (English labels) into Book fields. */
export function parseCommonKnowledge(
  html: string,
): Partial<Record<keyof Book, string>> {
  const out: Partial<Record<keyof Book, string>> = {};
  const idx = html.indexOf("newwork_ck_table");
  if (idx === -1) return out;
  const dl = html.slice(idx).match(/<dl[^>]*>([\s\S]*?)<\/dl>/i);
  if (!dl) return out;

  const rowRe = /<dt>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(dl[1])) !== null) {
    const label = stripTags(m[1]).replace(/\*+$/, "").trim().toLowerCase();
    const field = CK_FIELD_BY_LABEL[label];
    if (!field || out[field]) continue;
    // Drop the "click to reveal" spoiler prompt before hidden last-words text.
    const ddHtml = m[2].replace(
      /<span[^>]*class="note"[^>]*>[\s\S]*?<\/span>/i,
      "",
    );
    const value = stripTags(ddHtml);
    if (value) out[field] = value;
  }
  return out;
}

/** Genres from the Classifications section. */
export function parseGenres(html: string): string {
  const idx = html.indexOf("section_classification");
  if (idx === -1) return "";
  const region = html.slice(idx, idx + 4000);
  const genres: string[] = [];
  const re = /<a href="\/genre\/[^"]*"[^>]*>([^<]+)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(region)) !== null) {
    const g = decodeEntities(m[1]).trim();
    if (g && !genres.includes(g)) genres.push(g);
  }
  return genres.join(", ");
}

/** Primary author from the author-info section. */
export function parseAuthor(html: string): string {
  const m = html.match(/<div class="ais_aname"><a [^>]*>([^<]+)<\/a>/i);
  return m ? decodeEntities(m[1]).trim() : "";
}

function emptyBook(): Book {
  return { title: "", author: "", authors: [], coverUrl: "", link: "" };
}

/** Build a Book from one archived LibraryThing work page. */
export function parseWorkPage(html: string, link: string): Book {
  const book = emptyBook();
  book.link = link;
  book.previewLink = link;

  const ck = parseCommonKnowledge(html);
  Object.assign(book as unknown as Record<string, unknown>, ck);
  if (book.publishDate) {
    const year = book.publishDate.match(/\d{4}/);
    if (year) book.publishDate = year[0];
  }

  const author = parseAuthor(html);
  if (author) {
    book.author = author;
    book.authors = [author];
  }

  const genres = parseGenres(html);
  if (genres) {
    book.categories = genres;
    book.category = genres.split(",")[0].trim();
  }

  if (!book.title) {
    const t = metaContent(html, "og:title").replace(/\s+by\s+.+$/i, "");
    if (t) book.title = t.trim();
  }
  return book;
}

/** Map a Talpa Search JSON payload into Book stubs (title + work_id + ISBN). */
export function parseTalpaResults(json: unknown): Book[] {
  const list = getArray(getPath(json, ["response", "resultlist"]));
  const books: Book[] = [];
  for (const item of list) {
    const rec = asRecord(item);
    const id = getNumber(rec.work_id);
    if (!id) continue;
    const workId = String(id);
    const isbns = getStringArray(rec.isbns);
    const book = emptyBook();
    book.title = getString(rec.title);
    book.sourceProvider = "librarything";
    book.sourceId = workId;
    book.link = `${LT_WORK}/${workId}`;
    book.previewLink = book.link;
    if (isbns.length) {
      book.isbn13 = isbns[0];
      book.isbn = isbns[0];
      book.coverUrl = `https://covers.openlibrary.org/b/isbn/${isbns[0]}-L.jpg`;
    }
    books.push(book);
  }
  return books;
}

export interface OpenLibraryExtra {
  author?: string;
  totalPage?: number;
  publisher?: string;
  publishDate?: string;
  categories?: string;
  subtitle?: string;
  workKey?: string;
}

/**
 * Core metadata + the OpenLibrary work key from a `jscmd=details` payload
 * (one call serves both the reliable fields and localisation).
 */
export function parseOpenLibraryData(
  json: unknown,
  isbn: string,
): OpenLibraryExtra {
  const details = asRecord(getPath(json, [`ISBN:${isbn}`, "details"]));
  const out: OpenLibraryExtra = {};

  const authors = getArray(details.authors);
  if (authors.length) {
    const name = getString(getPath(authors[0], ["name"]));
    if (name) out.author = name;
  }
  const pages = getNumber(details.number_of_pages);
  if (pages) out.totalPage = pages;
  // In jscmd=details, publishers + subjects are plain strings.
  const publishers = getStringArray(details.publishers);
  if (publishers.length) out.publisher = publishers[0];
  const publishDate = getString(details.publish_date);
  if (publishDate) out.publishDate = publishDate;
  const subjects = getStringArray(details.subjects);
  if (subjects.length) out.categories = subjects.slice(0, 5).join(", ");
  const subtitle = getString(details.subtitle);
  if (subtitle) out.subtitle = subtitle;
  const works = getArray(details.works);
  if (works.length) {
    const key = getString(getPath(works[0], ["key"]));
    if (key) out.workKey = key;
  }
  return out;
}

export interface LocalizedEdition {
  title?: string;
  totalPage?: number;
  publisher?: string;
  isbn13?: string;
  coverUrl?: string;
}

/** Pick the best edition in `lang` from an OpenLibrary work-editions payload. */
export function pickLocalizedEdition(
  json: unknown,
  lang: string,
): LocalizedEdition | null {
  const entries = getArray(getPath(json, ["entries"])).map(asRecord);
  const inLang = entries.filter((e) =>
    getArray(e.languages).some(
      (l) => getString(getPath(l, ["key"])) === `/languages/${lang}`,
    ),
  );
  if (!inLang.length) return null;

  const hasIsbn = (e: Record<string, unknown>) =>
    getStringArray(e.isbn_13).length > 0 ||
    getStringArray(e.isbn_10).length > 0;
  const realPublisher = (e: Record<string, unknown>) =>
    !/independent/i.test(getStringArray(e.publishers)[0] || "");

  // Prefer an edition with pages + ISBN + a real publisher; degrade gracefully.
  const best =
    inLang.find(
      (e) => getNumber(e.number_of_pages) && hasIsbn(e) && realPublisher(e),
    ) ||
    inLang.find((e) => getNumber(e.number_of_pages) && hasIsbn(e)) ||
    inLang.find((e) => hasIsbn(e)) ||
    inLang[0];

  const out: LocalizedEdition = {};
  const title = getString(best.title);
  if (title) out.title = title;
  const pages = getNumber(best.number_of_pages);
  if (pages) out.totalPage = pages;
  const publisher = getStringArray(best.publishers)[0];
  if (publisher) out.publisher = publisher;
  const isbn =
    getStringArray(best.isbn_13)[0] || getStringArray(best.isbn_10)[0];
  if (isbn) out.isbn13 = isbn;
  const coverId = getNumber(getArray(getPath(best, ["covers"]))[0]);
  if (coverId) {
    out.coverUrl = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
  }
  return out;
}

/** Copy only defined, non-empty values onto the target Book. */
function applyDefined(target: Book, fields: Record<string, unknown>): void {
  const t = target as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== "") t[key] = value;
  }
}

function yearOf(value: string): string {
  return value.match(/\d{4}/)?.[0] ?? value;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class LibraryThingApi implements BaseBooksApiImpl {
  // OpenLibrary language code to prefer, or "" for English/no localisation.
  private readonly olLanguage: string;

  constructor(
    private readonly apiToken: string,
    locale = "en",
  ) {
    const code = OL_LANGUAGE[(locale || "en").slice(0, 2).toLowerCase()];
    this.olLanguage = code && code !== "eng" ? code : "";
  }

  private get token(): string {
    return (this.apiToken || "").trim();
  }

  async getByQuery(query: string): Promise<Book[]> {
    if (!this.token) return [];
    try {
      const url = `${TALPA_API}?search=${encodeURIComponent(
        query,
      )}&token=${encodeURIComponent(this.token)}&limit=20`;
      const res = await httpRequest(
        { url, method: "GET", headers: { "User-Agent": USER_AGENT } },
        { providerId: "librarything", purpose: "search" },
      );
      const json = parseJson(res.text || "");
      return parseTalpaResults(json);
    } catch (error) {
      console.warn("LibraryThing (Talpa) search error", error);
      return [];
    }
  }

  async getBook(book: Book): Promise<Book> {
    const id = book.sourceId;
    if (!id) return book;
    const isbn = book.isbn13 || book.isbn || "";
    try {
      // Wayback runs in parallel (it's a different host — archive.org). The
      // OpenLibrary calls are sequenced to respect OL's ~1 req/sec limit;
      // firing them together gets one of them throttled.
      const waybackPromise = this.fetchWaybackWork(id, book.link);
      const ol = await this.fetchOpenLibrary(isbn);
      const localized = ol.workKey
        ? await this.fetchLocalizedEdition(ol.workKey)
        : null;
      const wayback = await waybackPromise;

      const result: Book = { ...book };

      // 1. Reliable ISBN-based English core metadata.
      applyDefined(result, {
        author: ol.author,
        totalPage: ol.totalPage,
        publisher: ol.publisher,
        publishDate: ol.publishDate ? yearOf(ol.publishDate) : undefined,
        categories: ol.categories,
        subtitle: ol.subtitle,
      });
      if (ol.author) result.authors = [ol.author];

      // 2. LibraryThing canonical author/genres, original publication date, and
      // unique Common Knowledge. The canonical English title is only used when
      // we are NOT showing a localised edition.
      if (wayback) {
        applyDefined(result, {
          author: wayback.author,
          publishDate: wayback.publishDate,
          categories: wayback.categories,
          originalTitle: wayback.originalTitle,
          originalLanguage: wayback.originalLanguage,
          characters: wayback.characters,
          places: wayback.places,
          events: wayback.events,
          firstWords: wayback.firstWords,
          lastWords: wayback.lastWords,
          quotes: wayback.quotes,
          dedication: wayback.dedication,
          blurbers: wayback.blurbers,
          relatedMovies: wayback.relatedMovies,
        });
        if (wayback.author) result.authors = wayback.authors;
        if (!localized) applyDefined(result, { title: wayback.title });
      }

      // 3. Localised edition wins for the edition-specific display fields.
      if (localized) {
        applyDefined(result, {
          title: localized.title,
          totalPage: localized.totalPage,
          publisher: localized.publisher,
          isbn13: localized.isbn13,
          isbn: localized.isbn13,
          coverUrl: localized.coverUrl,
        });
      }

      if (result.categories) {
        result.category = result.categories.split(",")[0].trim();
      }
      result.sourceProvider = "librarything";
      result.sourceId = id;
      return result;
    } catch (error) {
      console.warn("LibraryThing getBook error", error);
      return book;
    }
  }

  private async fetchWaybackWork(
    id: string,
    link: string,
  ): Promise<Book | null> {
    // Self-contained: archive.org can be flaky, so a failure here must not
    // reject the parallel OpenLibrary fetch — return null and keep going.
    try {
      // Locate the most recent archived snapshot of the work page.
      const availRes = await httpRequest(
        {
          url: `${WAYBACK_AVAIL}?url=${encodeURIComponent(
            `librarything.com/work/${id}`,
          )}`,
          method: "GET",
        },
        { providerId: "librarything", purpose: "wayback-lookup" },
      );
      const ts = getString(
        getPath(parseJson(availRes.text || ""), [
          "archived_snapshots",
          "closest",
          "timestamp",
        ]),
      );
      if (!ts) return null;

      // `id_` returns the original (un-rewritten) page bytes.
      const archiveUrl = `https://web.archive.org/web/${ts}id_/https://www.librarything.com/work/${id}`;
      const res = await httpRequest(
        {
          url: archiveUrl,
          method: "GET",
          headers: { "User-Agent": USER_AGENT },
        },
        { providerId: "librarything", purpose: "wayback-work" },
      );
      const html = res.text || "";
      if (!html) return null;
      return parseWorkPage(html, link || `${LT_WORK}/${id}`);
    } catch (error) {
      console.warn("LibraryThing Wayback fetch failed", error);
      return null;
    }
  }

  private async fetchOpenLibrary(isbn: string): Promise<OpenLibraryExtra> {
    if (!isbn) return {};
    try {
      const res = await httpRequest(
        {
          url: `${OPENLIBRARY_BOOKS}?bibkeys=ISBN:${encodeURIComponent(
            isbn,
          )}&format=json&jscmd=details`,
          method: "GET",
        },
        { providerId: "librarything", purpose: "openlibrary-isbn" },
      );
      return parseOpenLibraryData(parseJson(res.text || ""), isbn);
    } catch {
      return {};
    }
  }

  private async fetchLocalizedEdition(
    workKey: string,
  ): Promise<LocalizedEdition | null> {
    if (!this.olLanguage || !workKey) return null;
    try {
      // Work → editions → best edition in the reader's language.
      const res = await httpRequest(
        {
          url: `${OPENLIBRARY}${workKey}/editions.json?limit=500`,
          method: "GET",
        },
        { providerId: "librarything", purpose: "openlibrary-editions" },
      );
      return pickLocalizedEdition(parseJson(res.text || ""), this.olLanguage);
    } catch {
      return null;
    }
  }
}

// Diagnostic: reports whether Talpa search (token) and the Wayback detail
// fetch are reachable. Surfaced via a command since requestUrl traffic never
// appears in DevTools.
export async function probeLibraryThing(apiToken?: string): Promise<string> {
  const token = (apiToken || "").trim();
  const lines: string[] = [];

  if (!token) {
    lines.push("Talpa search: no token set (Settings → LibraryThing API key).");
  } else {
    try {
      const res = await httpRequest(
        {
          url: `${TALPA_API}?search=the+trial&token=${encodeURIComponent(
            token,
          )}&limit=3`,
          method: "GET",
          headers: { "User-Agent": USER_AGENT },
        },
        { providerId: "librarything", purpose: "probe-search" },
      );
      const json = asRecord(parseJson(res.text || ""));
      const err = getString(getPath(json, ["error", "wording"]));
      if (err) lines.push(`Talpa search: ERROR — ${err}`);
      else {
        const n = getNumber(getPath(json, ["response", "results"]));
        lines.push(`Talpa search: OK — ${n} results`);
      }
    } catch (err) {
      lines.push(`Talpa search: failed — ${String(err)}`);
    }
  }

  try {
    const res = await httpRequest(
      {
        url: `${WAYBACK_AVAIL}?url=librarything.com/work/2152`,
        method: "GET",
      },
      { providerId: "librarything", purpose: "probe-wayback" },
    );
    const ts = getString(
      getPath(parseJson(res.text || ""), [
        "archived_snapshots",
        "closest",
        "timestamp",
      ]),
    );
    lines.push(
      ts
        ? `Wayback detail: OK — snapshot ${ts}`
        : "Wayback detail: no snapshot",
    );
  } catch (err) {
    lines.push(`Wayback detail: failed — ${String(err)}`);
  }

  return lines.join("\n");
}
