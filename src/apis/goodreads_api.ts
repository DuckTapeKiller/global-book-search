import { Notice } from "obsidian";
import { Book } from "@models/book.model";
import { BaseBooksApiImpl } from "@apis/base_api";
import { getHttpConfig, httpRequest, looksLikeBotChallenge } from "@utils/http";
import {
  getArray,
  getNumber,
  getPath,
  getProp,
  getString,
  isRecord,
  toErrorMessage,
} from "@utils/json";
import { parseSeriesFromTitle, seriesFromTitle } from "@utils/series";
import { contributorKind } from "@utils/contributors";
import { isIsbn10, toIsbn10, toIsbn13 } from "@utils/existing_note";
import { parseBookDate } from "@utils/dates";
import { formatFamily, pickSameEdition } from "@utils/editions";

/**
 * Merge detail-page data into the search-result book without ever letting an
 * empty scrape erase fields the search result already had (title, author,
 * cover, …). Goodreads serves bot-challenge pages that parse to all-blank
 * books; clobbering with those produced empty notes.
 */
export function mergeBookData(base: Partial<Book>, extracted: Book): Book {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extracted)) {
    const isEmpty =
      value === undefined ||
      value === null ||
      (typeof value === "string" && !value.trim()) ||
      (Array.isArray(value) &&
        value.filter((v) => String(v).trim()).length === 0);
    if (!isEmpty) {
      merged[key] = value;
    }
  }
  // A series and its number belong together: when the extraction names a
  // series, its number (even an empty one) comes with it, so one source's
  // series is never paired with another source's position.
  if (typeof extracted.series === "string" && extracted.series.trim()) {
    merged.seriesNumber = extracted.seriesNumber;
  }
  return merged as unknown as Book;
}

const GOODREADS_HOST = "https://www.goodreads.com";

// Locale-prefixed paths (`/es/book/show/<id>`) dodge the AWS WAF rule that
// blocks the canonical path, and all return the *same* English book data — the
// prefix only localises UI chrome, not the apolloState payload (verified across
// en/de/ja/ru). The sticky-last-good tracker means we normally hit just one
// route; this wider pool only fans out as a fallback when routes get blocked.
const GOODREADS_LOCALES = [
  "en",
  "es",
  "de",
  "fr",
  "it",
  "pt",
  "nl",
  "ja",
  "zh",
  "ru",
  "ko",
];

export interface GoodreadsRoute {
  kind: string;
  url: string;
}

/**
 * Tier 1 of the escalation chain: every direct Goodreads detail-page route we
 * know dodges (or is) the canonical path, in priority order. Each yields the
 * exact same Next.js page, so one parser handles all of them. The variety is
 * the point — for the WAF to kill this tier it would have to block `.xml` *and*
 * every localized path, which would also break Goodreads' own i18n site.
 */
export function buildGoodreadsDetailRoutes(
  id: string,
  slug: string,
  canonicalUrl: string,
): GoodreadsRoute[] {
  const routes: GoodreadsRoute[] = [];
  if (id) {
    routes.push({ kind: "xml", url: `${GOODREADS_HOST}/book/show/${id}.xml` });
    if (slug) {
      routes.push({
        kind: "xml-slug",
        url: `${GOODREADS_HOST}/book/show/${id}.${slug}.xml`,
      });
    }
    for (const loc of GOODREADS_LOCALES) {
      routes.push({
        kind: `locale-${loc}`,
        url: `${GOODREADS_HOST}/${loc}/book/show/${id}`,
      });
    }
  }
  if (canonicalUrl) routes.push({ kind: "canonical", url: canonicalUrl });
  return routes;
}

/** Move the last route that worked to the front so we usually fetch once. */
export function orderRoutesBySticky(
  routes: GoodreadsRoute[],
  stickyKind: string | null,
): GoodreadsRoute[] {
  if (!stickyKind) return routes;
  const preferred = routes.filter((r) => r.kind === stickyKind);
  const rest = routes.filter((r) => r.kind !== stickyKind);
  return [...preferred, ...rest];
}

/**
 * Rewrite a Wayback snapshot URL to its raw form (`/web/<ts>id_/…`) so
 * archive.org returns the original page without its toolbar/link rewriting.
 */
export function waybackRawUrl(snapshotUrl: string): string {
  return (snapshotUrl || "")
    .replace(/^http:/i, "https:")
    .replace(/\/web\/(\d+)\//, "/web/$1id_/");
}

function decodeHtmlEntities(value: string): string {
  return (value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function digitsOnly(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/[^0-9X]/gi, "");
}

/**
 * Tier 4 parser layer: schema.org `Book` JSON-LD. Structure-independent, so it
 * survives a Goodreads frontend rewrite that would break the apolloState parse.
 * Pure (regex, no DOM) so it runs in the escalation path and is unit-testable.
 */
export function parseLdJsonBook(html: string): Partial<Book> {
  const out: Partial<Book> = {};
  const blocks =
    (html || "").match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ) || [];

  for (const block of blocks) {
    const jsonText = block
      .replace(/^<script[^>]*>/i, "")
      .replace(/<\/script>\s*$/i, "");
    let data: unknown;
    try {
      data = JSON.parse(jsonText);
    } catch {
      continue;
    }

    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const type = rec["@type"];
      const isBook =
        type === "Book" || (Array.isArray(type) && type.includes("Book"));
      if (!isBook) continue;

      if (!out.title && typeof rec.name === "string") {
        out.title = decodeHtmlEntities(rec.name);
      }
      const isbn = digitsOnly(rec.isbn);
      if (isbn.length === 13 && !out.isbn13) out.isbn13 = isbn;
      if (isbn.length === 10 && !out.isbn10) out.isbn10 = isbn;
      if (
        !out.totalPage &&
        (typeof rec.numberOfPages === "number" ||
          typeof rec.numberOfPages === "string")
      ) {
        out.totalPage = String(rec.numberOfPages);
      }
      if (!out.publisher) {
        const pub = rec.publisher;
        const name =
          pub && typeof pub === "object"
            ? (pub as Record<string, unknown>).name
            : pub;
        if (typeof name === "string") out.publisher = decodeHtmlEntities(name);
      }
      if (!out.coverUrl) {
        const img: unknown = Array.isArray(rec.image)
          ? (rec.image as unknown[])[0]
          : rec.image;
        if (typeof img === "string") out.coverUrl = img;
      }
      if (!out.description && typeof rec.description === "string") {
        out.description = decodeHtmlEntities(rec.description);
      }
      if (!out.categories && rec.genre != null) {
        const genre = Array.isArray(rec.genre)
          ? (rec.genre as unknown[])
              .filter((g): g is string => typeof g === "string")
              .join(", ")
          : typeof rec.genre === "string"
            ? rec.genre
            : "";
        if (genre.trim()) {
          out.categories = genre;
          out.category = genre;
        }
      }
      const authors: string[] = [];
      const rawAuthors = Array.isArray(rec.author) ? rec.author : [rec.author];
      for (const a of rawAuthors) {
        if (typeof a === "string") authors.push(a);
        else if (a && typeof a === "object") {
          const name = (a as Record<string, unknown>).name;
          if (typeof name === "string") authors.push(name);
        }
      }
      const cleanAuthors = authors.map((a) => a.trim()).filter(Boolean);
      if (cleanAuthors.length && !out.authors) {
        out.authors = cleanAuthors;
        if (!out.author) out.author = cleanAuthors[0];
      }
    }
  }
  return out;
}

/**
 * Tier 4 parser layer (last ditch): OpenGraph/Twitter meta tags. Only title,
 * cover and description survive here, but that's enough to avoid a blank note.
 */
export function parseOgMetaBook(html: string): Partial<Book> {
  const out: Partial<Book> = {};
  const read = (prop: string): string => {
    const p = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Try both attribute orders (property-then-content and content-then-property).
    const re1 = new RegExp(
      `<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`,
      "i",
    );
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${p}["']`,
      "i",
    );
    const m = (html || "").match(re1) || (html || "").match(re2);
    return m ? decodeHtmlEntities(m[1]) : "";
  };

  const title = read("og:title") || read("twitter:title");
  if (title) {
    out.title = title.replace(/\s*\|\s*Goodreads\s*$/i, "").trim();
    Object.assign(out, seriesFromTitle(out.title));
  }
  const image = read("og:image");
  if (image) out.coverUrl = image;
  const description = read("og:description");
  // A book without a description of its own gets Goodreads' slogan here.
  if (description && !/^discover and share books you love/i.test(description)) {
    out.description = description;
  }
  return out;
}

/**
 * The book's main series from Goodreads' Apollo state, e.g. Discworld #1.
 *
 * `bookSeries` lists every series the book belongs to: the main series, any
 * sub-series and foreign-language collections. Goodreads' own data is trusted
 * over the title: the listed series named in `titleComplete` ("The Colour of
 * Magic (Discworld, #1)") wins, otherwise the first listed one. Only when
 * `bookSeries` is empty does the series in `titleComplete` serve as the answer.
 * Pure, so it can be tested without a DOM.
 */
export function extractApolloSeries(
  apolloState: unknown,
  bookJson: unknown,
): { series: string; seriesNumber: string } {
  const entries: Array<{ series: string; seriesNumber: string }> = [];
  for (const item of getArray(getProp(bookJson, "bookSeries"))) {
    const ref = getString(getPath(item, ["series", "__ref"]));
    const series = ref
      ? getString(getPath(getProp(apolloState, ref), ["title"])).trim()
      : "";
    if (!series) continue;
    const position = getProp(item, "userPosition");
    entries.push({
      series,
      seriesNumber:
        typeof position === "number" && Number.isFinite(position)
          ? String(position)
          : getString(position).trim(),
    });
  }

  const fromTitle = parseSeriesFromTitle(
    getString(getProp(bookJson, "titleComplete")),
  );
  const named = fromTitle
    ? entries.find((entry) => entry.series === fromTitle.series)
    : undefined;
  const chosen =
    named ??
    entries[0] ??
    (fromTitle && {
      series: fromTitle.series,
      seriesNumber: fromTitle.seriesNumber,
    });
  return chosen || { series: "", seriesNumber: "" };
}

// Notes Goodreads librarians put at the top of a description, which are not
// part of the book's summary.
const LIBRARIAN_NOTE =
  /^(?:librarian'?s?\s+note|(?:an?\s+)?alternat(?:e|ive)\s+(?:cover|edition)|this\s+is\s+(?:an?\s+)?alternat|for\s+(?:an?\s+)?alternat|previously[\s-]+published|also\s+published\s+as|(?:edici[oó]n|portada|cubierta)\s+alternativa|nota\s+(?:del?|de\s+la)\s+bibliotecari)/i;

function htmlToText(html: string): string {
  return decodeHtmlEntities(
    (html || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, "")
      .replace(/&#(\d+);/g, (_m, code: string) =>
        String.fromCodePoint(Number(code)),
      )
      .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) =>
        String.fromCodePoint(parseInt(code, 16)),
      ),
  );
}

/**
 * A Goodreads description as one line of text. The page separates paragraphs
 * with `<br>`, which plain text extraction dropped, gluing the last word of
 * one paragraph to the first of the next; here they are kept apart by a space.
 * Librarian notes that open the description ("Alternate cover edition of
 * ISBN …") are left out, as long as the summary itself remains. Quotation
 * marks are kept as written.
 */
export function cleanGoodreadsDescription(html: string): string {
  let rest = (html || "").trim();
  for (;;) {
    const lead =
      /^<(i|b|em|strong)>([\s\S]*?)<\/\1>\s*(?:<br\s*\/?>\s*)*/i.exec(rest);
    if (!lead || !LIBRARIAN_NOTE.test(htmlToText(lead[2]))) break;
    const after = rest.slice(lead[0].length);
    if (!htmlToText(after)) break;
    rest = after;
  }
  const paragraphs = rest
    .split(/(?:<br\s*\/?>\s*)+|<\/?p(?:\s[^>]*)?>/i)
    .map(htmlToText)
    .filter(Boolean);
  while (paragraphs.length > 1 && LIBRARIAN_NOTE.test(paragraphs[0])) {
    paragraphs.shift();
  }
  return paragraphs.join(" ");
}

function comparableName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Whether two author credits are one person spelled two ways, as Goodreads
 * lists for many translated classics ("Fyodor Dostoevsky", "Fyodor
 * Dostoyevsky", "Fiódor Dostoiévski"). Only long names with the same initials
 * that differ by at most a fifth count, so co-authors are never merged.
 */
export function isSameAuthorSpelling(a: string, b: string): boolean {
  const x = comparableName(a);
  const y = comparableName(b);
  if (!x || !y) return a === b;
  if (x === y) return true;
  const wx = x.split(" ");
  const wy = y.split(" ");
  if (wx.length < 2 || wy.length < 2) return false;
  if (wx[0][0] !== wy[0][0]) return false;
  if (wx[wx.length - 1][0] !== wy[wy.length - 1][0]) return false;
  const longest = Math.max(x.length, y.length);
  if (longest < 10) return false;
  return editDistance(x, y) <= Math.floor(longest * 0.2);
}

/** The JSON in a Goodreads page's `__NEXT_DATA__` script, or "" without one. */
export function extractNextDataJson(html: string): string {
  const match =
    /<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(
      html || "",
    );
  return match ? match[1] : "";
}

/**
 * The ASIN of the edition itself. Goodreads now puts the Kindle edition's ASIN
 * on printed editions too ("B0DN8P5BQF" on The Hobbit's Houghton Mifflin
 * paperback); a printed book's own ASIN is its ISBN-10, so a Kindle ASIN on a
 * paperback or hardcover is left out.
 */
export function printedBookAsin(asin: string, format: string): string {
  const printed = [
    "paperback",
    "hardcover",
    "library binding",
    "leather",
    "board book",
  ].includes(formatFamily(format));
  return printed && /^B0[0-9A-Z]{8}$/i.test(asin) ? "" : asin;
}

/** The Goodreads id of the work a book page belongs to, from its page data. */
export function goodreadsWorkId(nextDataJson: string): string {
  try {
    const state = getPath(JSON.parse(nextDataJson || "{}"), [
      "props",
      "pageProps",
      "apolloState",
    ]);
    const root = getProp(state, "ROOT_QUERY");
    const bookKey = isRecord(root)
      ? Object.keys(root).find((key) => key.startsWith("getBookByLegacyId"))
      : undefined;
    const book = getProp(
      state,
      getString(getPath(root, [bookKey || "", "__ref"])),
    );
    const work = getProp(state, getString(getPath(book, ["work", "__ref"])));
    const id = getProp(work, "legacyId");
    return typeof id === "number" || typeof id === "string" ? String(id) : "";
  } catch {
    return "";
  }
}

// Goodreads' codes for filtering a work's editions by language.
const EDITION_LANGUAGE_FILTERS: Record<string, string> = {
  english: "eng",
  spanish: "spa",
  french: "fre",
  german: "ger",
  italian: "ita",
  portuguese: "por",
  catalan: "cat",
  dutch: "dut",
  japanese: "jpn",
  russian: "rus",
  polish: "pol",
  swedish: "swe",
};

/**
 * The editions listed on a work's editions page
 * (goodreads.com/work/editions/…): title, binding, publisher, date, pages,
 * ISBNs and language of each. Pure: reads the page's HTML.
 */
export function parseGoodreadsEditionsPage(html: string): Book[] {
  return (html || "")
    .split('<div class="elementList')
    .slice(1)
    .map((block) => {
      const read = (pattern: RegExp): string => {
        const match = pattern.exec(block);
        return match ? htmlToText(match[1]).replace(/\s+/g, " ").trim() : "";
      };
      const heading = read(/<a class="bookTitle"[^>]*>([\s\S]*?)<\/a>/);
      const binding = /\(([^()]+)\)\s*$/.exec(heading)?.[1] || "";
      const published = read(
        /<div class="dataRow">\s*Published\b([\s\S]*?)<\/div>/,
      );
      const [, date = "", publisher = ""] =
        /^(.*?)(?:\s*\bby\s+(.*))?$/.exec(published) || [];
      const summary = block.split("moreDetails")[0];
      const pages = /(\d+)\s+pages/.exec(summary)?.[1] || "";
      const isbn = read(
        /ISBN:\s*<\/div>\s*<div class="dataValue">\s*([\dX]{10,13})/,
      );
      const isbn10 = read(/\(ISBN10:\s*([\dX]{10})\)/);
      return {
        title: heading.replace(/\s*\([^()]+\)\s*$/, ""),
        author: "",
        authors: [],
        coverUrl: "",
        link: "",
        format: binding,
        publisher: publisher.trim(),
        publishDate: parseBookDate(date),
        totalPage: pages,
        isbn13: isbn.length === 13 ? isbn : "",
        isbn10: isbn10 || (isbn.length === 10 ? isbn : ""),
        language: read(
          /Edition language:\s*<\/div>\s*<div class="dataValue">\s*([^<]+)</,
        ),
        sourceProvider: "goodreads",
      };
    });
}

export function normalizeGoodreadsCover(url: string): string {
  return (url || "")
    .replace(/_SY\d+_/, "_SY475_")
    .replace(/_SX\d+_/, "_SX475_");
}

/** A Goodreads timestamp (milliseconds) as yyyy/mm/dd, or "". */
function formatEpochDate(value: unknown): string {
  const ms = getNumber(value);
  if (!ms) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}/${month}/${day}`;
}

function cleanName(value: unknown): string {
  return getString(value).replace(/\s+/g, " ").trim();
}

/**
 * Every field Goodreads has for the edition on a book page, read from the
 * page's Apollo state (the data the page itself is rendered from). Needs no
 * DOM, so a page is parsed without building one, and it is tested directly.
 * Returns null when the page has no book in its Apollo state.
 */
export function parseGoodreadsApollo(
  nextDataJson: string,
  link: string,
): Book | null {
  let nextData: unknown;
  try {
    nextData = JSON.parse(nextDataJson);
  } catch {
    return null;
  }
  const state = getPath(nextData, ["props", "pageProps", "apolloState"]);
  const root = getProp(state, "ROOT_QUERY");
  if (!isRecord(state) || !isRecord(root)) return null;

  const legacyId = /\/book\/show\/(\d+)/.exec(link || "")?.[1] || "";
  const explicitKey = legacyId
    ? `getBookByLegacyId({"legacyId":"${legacyId}"})`
    : "";
  const refKey =
    explicitKey && isRecord(root[explicitKey])
      ? explicitKey
      : Object.keys(root).find((k) => k.startsWith("getBookByLegacyId(")) || "";
  const bookRef = refKey ? getString(getPath(root, [refKey, "__ref"])) : "";
  const book = bookRef ? state[bookRef] : undefined;
  if (!isRecord(book)) return null;

  const details = getProp(book, "details");
  const workRef = getString(getPath(book, ["work", "__ref"]));
  const workDetails = workRef ? getProp(state[workRef], "details") : undefined;

  // Contributors, by what their role means for a note.
  const authors: string[] = [];
  const translators: string[] = [];
  const narrators: string[] = [];
  let primaryName = "";
  const edges = [
    getProp(book, "primaryContributorEdge"),
    ...getArray(getProp(book, "secondaryContributorEdges")),
  ];
  edges.forEach((edge, index) => {
    const nodeRef = getString(getPath(edge, ["node", "__ref"]));
    const name = nodeRef ? cleanName(getProp(state[nodeRef], "name")) : "";
    if (!name || name.toLowerCase() === "unknown author") return;
    if (index === 0) primaryName = name;
    const kind = contributorKind(getString(getProp(edge, "role")));
    if (kind === "author") {
      if (!authors.some((known) => isSameAuthorSpelling(known, name))) {
        authors.push(name);
      }
      return;
    }
    const list =
      kind === "translator"
        ? translators
        : kind === "narrator"
          ? narrators
          : null;
    if (list && !list.includes(name)) list.push(name);
  });
  // An anthology's primary contributor can be its editor: never leave a book
  // without an author when Goodreads names someone first.
  if (
    !authors.length &&
    primaryName &&
    !translators.includes(primaryName) &&
    !narrators.includes(primaryName)
  ) {
    authors.push(primaryName);
  }

  const genres: string[] = [];
  for (const item of getArray(getProp(book, "bookGenres"))) {
    const name = cleanName(getPath(item, ["genre", "name"]));
    if (name && !genres.includes(name)) genres.push(name);
  }

  const isbnRaw = digitsOnly(getProp(details, "isbn"));
  const isbn13Raw = digitsOnly(getProp(details, "isbn13"));
  const isbn10 =
    isbnRaw.length === 10 ? isbnRaw : isbn13Raw.length === 10 ? isbn13Raw : "";
  const isbn13 =
    isbn13Raw.length === 13 ? isbn13Raw : isbnRaw.length === 13 ? isbnRaw : "";
  // Amazon's ASIN for a printed book is its ISBN-10, and Goodreads sometimes
  // has only that: The Shadow of the Wind (Penguin) has no ISBN and the ASIN
  // 0143034901. Without it a global search borrowed another edition's ISBN.
  const asin = cleanName(getProp(details, "asin")).toUpperCase();
  const asinIsbn10 =
    isIsbn10(asin) &&
    (!isbn10 || isbn10 === asin) &&
    (!isbn13 || isbn13 === toIsbn13(asin))
      ? asin
      : "";
  const numPages = getNumber(getProp(details, "numPages"));
  const names = (items: unknown, separator: string): string =>
    getArray(items)
      .map((item) => cleanName(getProp(item, "name")))
      .filter((name, i, all) => name && all.indexOf(name) === i)
      .join(separator);
  const coverUrl = normalizeGoodreadsCover(
    getString(getProp(book, "imageUrl")),
  );

  return {
    title: cleanName(getProp(book, "title")),
    subtitle: "",
    author: authors[0] || "",
    authors,
    translator: translators.join(", "),
    narrator: narrators.join(", "),
    category: genres.join(", "),
    categories: genres.join(", "),
    description: cleanGoodreadsDescription(
      getString(getProp(book, "description")) ||
        getString(getProp(book, 'description({"stripped":true})')),
    ),
    publisher: cleanName(getProp(details, "publisher")),
    publishDate: formatEpochDate(getProp(details, "publicationTime")),
    totalPage: numPages ? String(numPages) : "",
    isbn10: isbn10 || asinIsbn10,
    isbn13: isbn13 || (asinIsbn10 ? toIsbn13(asinIsbn10) : ""),
    asin: printedBookAsin(
      cleanName(getProp(details, "asin")),
      cleanName(getProp(details, "format")),
    ),
    format: cleanName(getProp(details, "format")),
    // "Spanish; Castilian" is Goodreads' name for Spanish.
    language: cleanName(getPath(details, ["language", "name"]))
      .split(";")[0]
      .trim(),
    originalTitle: cleanName(getProp(workDetails, "originalTitle")),
    firstPublishDate: formatEpochDate(getProp(workDetails, "publicationTime")),
    // Place names carry their own commas ("London, England").
    places: names(getProp(workDetails, "places"), "; "),
    characters: names(getProp(workDetails, "characters"), ", "),
    coverUrl,
    coverSmallUrl: coverUrl,
    link,
    previewLink: link,
    ...extractApolloSeries(state, book),
  };
}

// Remembers which Tier-1 route last worked, across GoodreadsApi instances
// (the factory creates a fresh instance per call). Avoids re-probing blocked
// routes on every fetch.
let stickyRouteKind: string | null = null;

export class GoodreadsApi implements BaseBooksApiImpl {
  static readonly SCRAPER_VERSION = "2026-06-14";

  // Notify at most once per session; bulk imports would otherwise spam it.
  private static didWarnDetailBlocked = false;

  // Status of the last direct-route fetch, for the fallback diagnostic Notice.
  private lastDetailStatus?: number;

  // The work of the book page parsed last, for finding its editions.
  private lastWorkId = "";

  private readonly userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";

  constructor() {}

  private parseHtml(html: string): Document {
    const parser = new DOMParser();
    return parser.parseFromString(html || "", "text/html");
  }

  private text(el: Element | null | undefined): string {
    return (el?.textContent || "").trim();
  }

  private normalizeCoverUrl(url: string): string {
    return normalizeGoodreadsCover(url);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private getPath(value: unknown, path: string[]): unknown {
    let current: unknown = value;
    for (const segment of path) {
      if (!this.isRecord(current)) return undefined;
      current = current[segment];
    }
    return current;
  }

  private asString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private asNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return undefined;
  }

  private extractGoodreadsLegacyId(link: string): string {
    const match = (link || "").match(/\/book\/show\/(\d+)/);
    return match?.[1] || "";
  }

  async getByQuery(query: string): Promise<Book[]> {
    try {
      // The autocomplete JSON endpoint is the only one Goodreads currently
      // serves without an AWS WAF bot challenge, so try it before touching
      // the HTML search page at all.
      const autocompleteBooks = await this.getByAutocomplete(query);
      if (autocompleteBooks.length > 0) {
        if (getHttpConfig().diagnosticsEnabled) {
          console.debug(
            `[goodreads] strategy=autocompleteJson results=${autocompleteBooks.length}`,
          );
        }
        return autocompleteBooks;
      }

      // Use the explicit books search to reduce layout variance.
      const encodedQuery = encodeURIComponent(query);
      const searchUrl = `https://www.goodreads.com/search?utf8=%E2%9C%93&search_type=books&q=${encodedQuery}&query=${encodedQuery}`;
      const searchRes = await httpRequest(
        {
          url: searchUrl,
          method: "GET",
          headers: {
            "User-Agent": this.userAgent,
          },
        },
        { providerId: "goodreads", purpose: "search" },
      );

      const doc = this.parseHtml(searchRes.text);
      const strategies: Array<{
        id: string;
        run: () => Promise<Book[]> | Book[];
      }> = [
        {
          id: "direct-book-page",
          run: () => this.tryParseDirectBookPage(doc, searchUrl),
        },
        { id: "tableList", run: () => this.tryParseTableList(doc) },
        { id: "looseBookTitleLinks", run: () => this.tryParseLooseLinks(doc) },
      ];

      for (const strategy of strategies) {
        const books = await strategy.run();
        if (books.length > 0) {
          if (getHttpConfig().diagnosticsEnabled) {
            console.debug(
              `[goodreads] strategy=${strategy.id} results=${books.length}`,
            );
          }
          return books;
        }
      }

      console.warn("Goodreads: no results", {
        url: searchUrl,
        status: (searchRes as unknown as { status?: number }).status,
        htmlLength: searchRes.text?.length || 0,
        title: doc.title,
      });

      return [];
    } catch (error) {
      console.warn("Goodreads scraping error", error);
      return [];
    }
  }

  private tryParseDirectBookPage(doc: Document, fallbackUrl: string): Book[] {
    if (
      doc.querySelector('h1[data-testid="bookTitle"]') ||
      doc.querySelector("#bookTitle")
    ) {
      const canonical =
        doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ||
        fallbackUrl;
      const book = this.extractBook(doc, canonical);
      book.link = canonical;
      book.previewLink = canonical;
      return [book];
    }
    return [];
  }

  private tryParseTableList(doc: Document): Book[] {
    const tableRows = Array.from(doc.querySelectorAll("table.tableList tr"));
    if (tableRows.length === 0) return [];

    const books: Book[] = [];
    tableRows.forEach((row) => {
      const titleLink = row.querySelector("a.bookTitle");
      const title = this.text(titleLink).replace(/"/g, "'");
      const href = titleLink?.getAttribute("href");

      if (!title || !href) return;

      const author = this.text(row.querySelector("a.authorName"));
      const coverUrl =
        row.querySelector("img.bookCover")?.getAttribute("src") || "";
      const smallCoverUrl = coverUrl;

      const fullLink = href.startsWith("http")
        ? href
        : `https://www.goodreads.com${href}`;

      books.push({
        title,
        author,
        authors: [author],
        link: fullLink,
        previewLink: fullLink,
        coverUrl: this.normalizeCoverUrl(coverUrl) || "", // Try to get higher res
        coverSmallUrl: smallCoverUrl || "",
        description: "",
        publisher: "",
        publishDate: "",
        totalPage: "",
        isbn10: "",
        isbn13: "",
        categories: "",
        category: "",
        originalTitle: "",
        translator: "",
        narrator: "",
        subtitle: "",
        asin: "",
        ...seriesFromTitle(title),
      });
    });

    return books;
  }

  private tryParseLooseLinks(doc: Document): Book[] {
    const looseTitleLinks = Array.from(doc.querySelectorAll("a.bookTitle"));
    if (looseTitleLinks.length === 0) return [];

    const books: Book[] = [];
    const seen = new Set<string>();

    for (const titleLink of looseTitleLinks) {
      const title = this.text(titleLink).replace(/"/g, "'");
      const href = titleLink.getAttribute("href");
      if (!title || !href) continue;

      const fullLink = href.startsWith("http")
        ? href
        : `https://www.goodreads.com${href}`;
      if (seen.has(fullLink)) continue;
      seen.add(fullLink);

      const container =
        titleLink.closest("tr") ||
        titleLink.closest("li") ||
        titleLink.closest("div") ||
        titleLink.parentElement;

      const author =
        this.text(container?.querySelector("a.authorName")) ||
        this.text(container?.querySelector(".authorName")) ||
        "";

      const coverUrl = (
        container?.querySelector("img")?.getAttribute("src") || ""
      ).trim();

      books.push({
        title,
        author,
        authors: author ? [author] : [],
        link: fullLink,
        previewLink: fullLink,
        coverUrl: this.normalizeCoverUrl(coverUrl),
        coverSmallUrl: coverUrl,
        description: "",
        publisher: "",
        publishDate: "",
        totalPage: "",
        isbn10: "",
        isbn13: "",
        categories: "",
        category: "",
        originalTitle: "",
        translator: "",
        narrator: "",
        subtitle: "",
        asin: "",
        ...seriesFromTitle(title),
      });
    }

    return books;
  }

  private async getByAutocomplete(query: string): Promise<Book[]> {
    const url = `https://www.goodreads.com/book/auto_complete?format=json&q=${encodeURIComponent(query)}`;

    try {
      const res = await httpRequest(
        {
          url,
          method: "GET",
          headers: {
            "User-Agent": this.userAgent,
            Accept: "application/json",
          },
        },
        {
          providerId: "goodreads",
          purpose: "autocomplete",
          responseType: "json",
          cacheTtlMs: 60_000,
        },
      );

      const payload: unknown =
        (res as unknown as { json?: unknown }).json ??
        JSON.parse(res.text || "[]");

      const items: unknown[] = Array.isArray(payload)
        ? payload
        : // Some wrappers may return `{ results: [...] }`
          (payload as { results?: unknown[] })?.results || [];

      const books: Book[] = [];
      const seen = new Set<string>();

      for (const item of items.slice(0, 25)) {
        const obj = item as Record<string, unknown>;

        const bookIdRaw = obj.bookId ?? obj.book_id ?? obj.id;
        const bookId =
          typeof bookIdRaw === "number"
            ? String(bookIdRaw)
            : typeof bookIdRaw === "string"
              ? bookIdRaw
              : "";
        if (!bookId) continue;

        const title = this.asString(obj.title).replace(/"/g, "'");
        if (!title) continue;

        const authorName = (
          this.asString(this.getPath(obj, ["author", "name"])) ||
          this.asString(obj.authorName) ||
          this.asString(obj.author_name) ||
          this.asString(obj.author)
        ).replace(/\s+/g, " ");

        const link =
          (typeof obj.url === "string" && obj.url.startsWith("http")
            ? obj.url
            : "") || `https://www.goodreads.com/book/show/${bookId}`;

        if (seen.has(link)) continue;
        seen.add(link);

        const coverUrl =
          this.asString(obj.imageUrl) ||
          this.asString(obj.image_url) ||
          this.asString(obj.bookImageUrl) ||
          this.asString(obj.book_image_url) ||
          this.asString(obj.book_small_image_url);

        const descriptionHtml =
          this.asString(this.getPath(obj, ["description", "html"])) ||
          this.asString(obj.description);
        const description = cleanGoodreadsDescription(descriptionHtml);

        books.push({
          title,
          author: authorName,
          authors: authorName ? [authorName] : [],
          link,
          previewLink: link,
          coverUrl: this.normalizeCoverUrl(coverUrl),
          coverSmallUrl: coverUrl,
          description,
          publisher: "",
          publishDate: "",
          totalPage: this.asNumber(obj.numPages)
            ? String(this.asNumber(obj.numPages))
            : "",
          isbn10: "",
          isbn13: "",
          categories: "",
          category: "",
          originalTitle: "",
          translator: "",
          narrator: "",
          subtitle: "",
          asin: "",
          ...seriesFromTitle(title),
        });
      }

      return books;
    } catch (error) {
      console.warn("Goodreads autocomplete failed:", {
        url,
        error: toErrorMessage(error),
      });
      return [];
    }
  }

  private extractSlug(link: string): string {
    const m = (link || "").match(/\/book\/show\/\d+[.-]([^/?#]+)/);
    return (m?.[1] || "").replace(/\.xml$/i, "");
  }

  /**
   * Fetch full book metadata using a tiered escalation chain. Each tier is an
   * independent way to reach the data, so one breaking falls through to the
   * next instead of producing a blank note:
   *
   *   Tier 1  Direct Goodreads routes (`.xml`, locale prefixes, canonical)
   *   Tier 2  ISBN→id resolver (`isbn_to_id`) when the link carries no id
   *   Tier 3  Independent archives (Wayback Machine, archive.today)
   *   Tier 4  Layered parsing (apolloState → JSON-LD → OpenGraph) per fetch
   *   Tier 5  Cross-source top-up (Google Books, Open Library)
   *   Tier 6  Search-result data only (never blank)
   */
  async getBook(book: Book): Promise<Book> {
    const canonicalLink = book.link || "";
    this.lastDetailStatus = undefined;

    // Tiers 1–4: get a parsed detail page from Goodreads or an archive.
    this.lastWorkId = "";
    const detail = await this.fetchDetail(book);
    let result = detail ? mergeBookData(book, detail) : { ...book };

    // Goodreads keeps some editions without an ISBN, while its list of the
    // work's editions has a twin that carries one: the same publisher, pages,
    // binding and language (Norwegian Wood, Vintage Books, 296 pages:
    // 9780375704024). Only a single such twin is taken.
    if (detail && !result.isbn13 && !result.isbn10 && this.lastWorkId) {
      const twin = await this.findTwin(result, this.lastWorkId);
      if (twin) {
        result.isbn13 = toIsbn13(twin.isbn13 || twin.isbn10 || "");
        result.isbn10 = twin.isbn10 || toIsbn10(result.isbn13);
      }
    }

    // A single-service search returns ONLY Goodreads data. Cross-source
    // enrichment from other providers (Google Books / OpenLibrary) is the job
    // of Global Search — doing it here made individual searches slow whenever
    // another service was unreachable, and leaked other sources into the result.

    // Always present the canonical reader-facing link, not an .xml/archive URL.
    if (canonicalLink) {
      result.link = canonicalLink;
      result.previewLink = canonicalLink;
    }

    // Tier 6: if nothing beyond the search result could be recovered, say so.
    const recoveredDetail =
      !!result.publisher ||
      !!result.isbn13 ||
      !!result.isbn10 ||
      !!result.categories;
    if (!recoveredDetail) {
      this.warnDetailPageBlocked(this.lastDetailStatus);
    }

    return result;
  }

  /** Tiers 1–4: a parsed Book from a direct route or archive, or null. */
  private async fetchDetail(book: Book): Promise<Book | null> {
    let id = this.extractGoodreadsLegacyId(book.link);

    // Tier 2: recover the Goodreads id from an ISBN when the link has none.
    if (!id) {
      const isbn = book.isbn13 || book.isbn10 || "";
      if (isbn) id = await this.resolveIsbnToId(isbn);
    }

    const slug = this.extractSlug(book.link);
    const canonical =
      book.link || (id ? `${GOODREADS_HOST}/book/show/${id}` : "");

    // Tier 1: direct routes, sticky-last-good first so we usually fetch once.
    const routes = orderRoutesBySticky(
      buildGoodreadsDetailRoutes(id, slug, canonical),
      stickyRouteKind,
    );
    for (const route of routes) {
      const parsed = await this.tryFetchAndParse(route.url, canonical);
      if (parsed) {
        stickyRouteKind = route.kind;
        if (getHttpConfig().diagnosticsEnabled) {
          console.debug(`[goodreads] detail via route=${route.kind}`);
        }
        return parsed;
      }
    }

    // Tier 3: independent archives (a different host the WAF can't touch).
    if (canonical) {
      const archives: Array<{
        id: string;
        run: () => Promise<{ html: string } | null>;
      }> = [
        { id: "wayback", run: () => this.fetchViaWayback(canonical) },
        {
          id: "archive.today",
          run: () => this.fetchViaArchiveToday(canonical),
        },
      ];
      for (const archive of archives) {
        try {
          const snap = await archive.run();
          if (!snap) continue;
          const parsed = this.parseDetailHtml(snap.html, canonical);
          if (parsed.title.trim()) {
            if (getHttpConfig().diagnosticsEnabled) {
              console.debug(`[goodreads] detail via archive=${archive.id}`);
            }
            return parsed;
          }
        } catch (error) {
          console.warn(`Goodreads archive ${archive.id} failed`, error);
        }
      }
    }

    return null;
  }

  private async tryFetchAndParse(
    url: string,
    canonicalLink: string,
  ): Promise<Book | null> {
    try {
      const res = await httpRequest(
        { url, method: "GET", headers: { "User-Agent": this.userAgent } },
        { providerId: "goodreads", purpose: "book" },
      );
      this.lastDetailStatus = res.status;
      if (looksLikeBotChallenge(res.status, res.text)) return null;

      const parsed = this.parseDetailHtml(res.text, canonicalLink || url);
      return parsed.title.trim() ? parsed : null;
    } catch (error) {
      console.warn(`Goodreads route failed: ${url}`, error);
      return null;
    }
  }

  /** The one edition in the work's editions list that is this edition and has an ISBN. */
  private async findTwin(book: Book, workId: string): Promise<Book | null> {
    const params = new URLSearchParams({ per_page: "100" });
    if (book.format) params.set("filter_by_format", book.format);
    const language =
      EDITION_LANGUAGE_FILTERS[(book.language || "").toLowerCase()];
    if (language) params.set("filter_by_language", language);
    try {
      const res = await httpRequest(
        {
          url: `${GOODREADS_HOST}/work/editions/${workId}?${params.toString()}`,
          method: "GET",
          headers: { "User-Agent": this.userAgent },
        },
        { providerId: "goodreads", purpose: "editions", cacheTtlMs: 600_000 },
      );
      if (res.status !== 200 || looksLikeBotChallenge(res.status, res.text)) {
        return null;
      }
      return pickSameEdition(book, parseGoodreadsEditionsPage(res.text));
    } catch (error) {
      console.warn("Goodreads editions lookup failed", error);
      return null;
    }
  }

  /** Tier 4: layered parse — apolloState/DOM, then JSON-LD, then OpenGraph. */
  private parseDetailHtml(html: string, link: string): Book {
    // The page's own data first; a DOM is only built for pages without it.
    const nextData = extractNextDataJson(html);
    this.lastWorkId = goodreadsWorkId(nextData);
    const apollo = parseGoodreadsApollo(nextData, link);
    let parsed =
      apollo && apollo.title
        ? apollo
        : this.extractBook(this.parseHtml(html), link);
    // Structure-independent layers fill any gaps the primary parse left.
    parsed = mergeBookData(parseLdJsonBook(html), parsed);
    parsed = mergeBookData(parseOgMetaBook(html), parsed);
    return parsed;
  }

  /**
   * Tier 2: resolve a Goodreads numeric id from an ISBN via `isbn_to_id`,
   * which 301-redirects to the canonical book URL. Best-effort: depends on the
   * HTTP layer exposing the redirect Location (some clients auto-follow).
   */
  private async resolveIsbnToId(isbn: string): Promise<string> {
    const clean = digitsOnly(isbn);
    if (!clean) return "";
    try {
      const res = await httpRequest(
        {
          url: `${GOODREADS_HOST}/book/isbn_to_id/${clean}`,
          method: "GET",
          headers: { "User-Agent": this.userAgent },
        },
        { providerId: "goodreads", purpose: "isbn_to_id", cacheTtlMs: 600_000 },
      );
      const headers = res.headers || {};
      const location = headers["location"] || headers["Location"] || "";
      // Pull the id from the redirect target, or from the body if one wasn't
      // exposed (a numeric id is sometimes returned as plain text).
      return (
        this.extractGoodreadsLegacyId(location) ||
        (/^\d+$/.test((res.text || "").trim()) ? (res.text || "").trim() : "")
      );
    } catch (error) {
      console.warn("Goodreads isbn_to_id failed", error);
      return "";
    }
  }

  /** Tier 3a: latest Wayback Machine snapshot of the canonical page. */
  private async fetchViaWayback(
    canonicalUrl: string,
  ): Promise<{ html: string } | null> {
    try {
      const availRes = await httpRequest(
        {
          url: `https://archive.org/wayback/available?url=${encodeURIComponent(canonicalUrl)}`,
          method: "GET",
        },
        {
          providerId: "goodreads-archive",
          purpose: "wayback-available",
          responseType: "json",
          cacheTtlMs: 600_000,
        },
      );
      const snapUrl = this.asString(
        this.getPath(availRes.json, ["archived_snapshots", "closest", "url"]),
      );
      if (!snapUrl) return null;

      const snapRes = await httpRequest(
        {
          url: waybackRawUrl(snapUrl),
          method: "GET",
          headers: { "User-Agent": this.userAgent },
        },
        { providerId: "goodreads-archive", purpose: "wayback-snapshot" },
      );
      if (snapRes.status >= 400 || !snapRes.text) return null;
      return { html: snapRes.text };
    } catch (error) {
      console.warn("Goodreads Wayback fetch failed", error);
      return null;
    }
  }

  /** Tier 3b: archive.today snapshot — a second, independent archive operator. */
  private async fetchViaArchiveToday(
    canonicalUrl: string,
  ): Promise<{ html: string } | null> {
    try {
      const res = await httpRequest(
        {
          url: `https://archive.ph/newest/${canonicalUrl}`,
          method: "GET",
          headers: { "User-Agent": this.userAgent },
        },
        { providerId: "goodreads-archive", purpose: "archive-today" },
      );
      if (res.status >= 400 || !res.text) return null;
      // Only accept a snapshot that actually carries parseable book data.
      if (!/__NEXT_DATA__|application\/ld\+json/i.test(res.text)) return null;
      return { html: res.text };
    } catch (error) {
      console.warn("Goodreads archive.today fetch failed", error);
      return null;
    }
  }

  /** Tier 5: fill missing fields from sources that don't block scraping. */
  private warnDetailPageBlocked(status?: number): void {
    console.warn(
      `Goodreads: book page blocked or unparseable (HTTP ${status ?? "?"}, scraper ${GoodreadsApi.SCRAPER_VERSION}); falling back to search-result data.`,
    );
    if (!GoodreadsApi.didWarnDetailBlocked) {
      GoodreadsApi.didWarnDetailBlocked = true;
      new Notice(
        "Goodreads is blocking detailed metadata requests (bot protection). Notes will be created with basic search data only — publisher, ISBN and genres may be missing.",
        10_000,
      );
    }
  }

  /**
   * The DOM fallback for pages whose Apollo state is missing or carries no
   * title (older or archived pages). Whatever Apollo data there is still wins
   * over what the markup shows.
   */
  private extractBook(doc: Document, link: string): Book {
    const title =
      this.text(doc.querySelector('h1[data-testid="bookTitle"]')) ||
      this.text(doc.querySelector("#bookTitle"));

    const descriptionEl =
      doc.querySelector('[data-testid="description"] span.Formatted') ||
      doc.querySelector("span.Formatted");
    const description = cleanGoodreadsDescription(
      descriptionEl?.innerHTML || "",
    );

    // Contributors with their roles: "(Translator)" next to a name.
    const authors: string[] = [];
    const translators: string[] = [];
    const narrators: string[] = [];
    const addContributor = (name: string, role: string) => {
      const clean = name.replace(/\s+/g, " ").trim();
      if (!clean) return;
      const kind = contributorKind(role.replace(/[()]/g, ""));
      if (kind === "author") {
        if (!authors.some((known) => isSameAuthorSpelling(known, clean))) {
          authors.push(clean);
        }
        return;
      }
      const list =
        kind === "translator"
          ? translators
          : kind === "narrator"
            ? narrators
            : null;
      if (list && !list.includes(clean)) list.push(clean);
    };
    doc.querySelectorAll(".ContributorLink").forEach((el) => {
      addContributor(
        this.text(el.querySelector(".ContributorLink__name")),
        this.text(el.querySelector(".ContributorLink__role")),
      );
    });
    if (!authors.length) {
      doc.querySelectorAll(".authorName__container").forEach((el) => {
        addContributor(
          this.text(el.querySelector(".authorName")),
          this.text(el.querySelector(".role")),
        );
      });
    }

    const categories: string[] = [];
    doc
      .querySelectorAll(
        'ul[aria-label="Top genres for this book"] a.Button--tag',
      )
      .forEach((el) => {
        const c = this.text(el);
        if (c && !categories.includes(c)) categories.push(c);
      });
    const category = categories.join(", ");

    const asin = this.text(doc.querySelector('span[data-testid="asin"]'));

    // Only a real page count: an audiobook's line reads "Audible Audio".
    const pagesMatch = /(\d[\d,.]*)\s*pages?/i.exec(
      this.text(doc.querySelector('p[data-testid="pagesFormat"]')),
    );
    const totalPage = pagesMatch ? pagesMatch[1].replace(/[,.]/g, "") : "";

    const coverUrl = this.normalizeCoverUrl(
      doc.querySelector("img.ResponsiveImage")?.getAttribute("src") ||
        doc.querySelector("#coverImage")?.getAttribute("src") ||
        "",
    );

    const fromMarkup: Book = {
      title,
      subtitle: "",
      author: authors[0] || "",
      authors,
      translator: translators.join(", "),
      narrator: narrators.join(", "),
      category,
      categories: category,
      publisher: "",
      publishDate: "",
      totalPage,
      coverUrl,
      coverSmallUrl: coverUrl,
      description,
      link,
      previewLink: link,
      isbn10: "",
      isbn13: "",
      originalTitle: "",
      asin,
      series: "",
      seriesNumber: "",
    };

    const apollo = parseGoodreadsApollo(
      doc.querySelector("#__NEXT_DATA__")?.textContent || "",
      link,
    );
    return apollo ? mergeBookData(fromMarkup, apollo) : fromMarkup;
  }
}
