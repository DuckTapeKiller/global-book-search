// Telling whether two catalogue records describe the same edition of a book,
// so that an edition without an ISBN can borrow the ISBN of its twin.
import { Book } from "@models/book.model";
import { normalizeIsbn, toIsbn13 } from "@utils/existing_note";

function plain(text: string): string {
  return (text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * A title as editions share it: without a series in brackets, a subtitle, an
 * alternative title ("The Hobbit, or There and Back Again"), accents or
 * punctuation.
 */
export function titleKey(title: string): string {
  return plain(title)
    .replace(/\s*[([].*$/, "")
    .split(":")[0]
    .replace(/,\s+or\s+.*$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function sameTitle(a: string, b: string): boolean {
  const key = titleKey(a);
  return !!key && key === titleKey(b);
}

/**
 * A publisher's name for comparing editions: "Faber & Faber", "Faber and
 * Faber Limited" and "faber and faber" are one; "Vintage Books" and
 * "Vintage" are not (Vintage Books is the American imprint).
 */
export function publisherKey(publisher: string): string {
  return plain(publisher)
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(
      /\b(inc|incorporated|ltd|limited|llc|co|corp|s a|sa|s l|sl|gmbh|srl)\s*$/u,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** The kind of binding a format names, or "" when it names none. */
export function formatFamily(format: string): string {
  const value = plain(format);
  if (!value) return "";
  if (/audio|audible|cd|cassette|mp3/.test(value)) return "audio";
  if (/kindle|ebook|e-book|epub|digital|nook/.test(value)) return "ebook";
  // Catalogues call one paperback "mass market" and another "paperback";
  // the publisher and page count still have to agree.
  if (
    /paperback|softcover|trade paper|perfect|mass market|pocket/.test(value)
  ) {
    return "paperback";
  }
  if (/hardcover|hardback|hard cover|cloth/.test(value)) return "hardcover";
  if (/library binding/.test(value)) return "library binding";
  if (/leather|bonded/.test(value)) return "leather";
  if (/board book/.test(value)) return "board book";
  return value;
}

function pages(value: unknown): number {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? parseInt(value, 10)
        : 0;
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * Whether a record is the same edition as the one wanted: the same title and
 * language, and the same publisher, page count (one page either way, as
 * catalogues count differently) and binding, wherever both name them. Two of
 * those three must be known on both sides; a title alone names a book, not
 * an edition.
 */
export function isSameEdition(
  wanted: Partial<Book>,
  candidate: Partial<Book>,
): boolean {
  if (!sameTitle(wanted.title || "", candidate.title || "")) return false;

  const languageA = plain(wanted.language || "");
  const languageB = plain(candidate.language || "");
  if (languageA && languageB && languageA !== languageB) return false;

  let known = 0;
  const publisherA = publisherKey(wanted.publisher || "");
  const publisherB = publisherKey(candidate.publisher || "");
  if (publisherA && publisherB) {
    if (publisherA !== publisherB) return false;
    known++;
  }
  const pagesA = pages(wanted.totalPage);
  const pagesB = pages(candidate.totalPage);
  if (pagesA && pagesB) {
    if (Math.abs(pagesA - pagesB) > 1) return false;
    known++;
  }
  const formatA = formatFamily(wanted.format || "");
  const formatB = formatFamily(candidate.format || "");
  if (formatA && formatB) {
    if (formatA !== formatB) return false;
    known++;
  }
  return known >= 2;
}

/**
 * The one record among candidates that is the same edition as the one
 * wanted and has an ISBN. When records with different ISBNs all match (the
 * same publisher reprinted the book with the same pages under a new ISBN),
 * there is no telling which, and the answer is null.
 */
export function pickSameEdition<T extends Partial<Book>>(
  wanted: Partial<Book>,
  candidates: T[],
): T | null {
  let found: T | null = null;
  let foundIsbn = "";
  for (const candidate of candidates) {
    const isbn = toIsbn13(
      normalizeIsbn(candidate.isbn13) || normalizeIsbn(candidate.isbn10),
    );
    if (!isbn || !isSameEdition(wanted, candidate)) continue;
    if (found && foundIsbn !== isbn) return null;
    if (!found) {
      found = candidate;
      foundIsbn = isbn;
    }
  }
  return found;
}
