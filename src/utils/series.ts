import { Book } from "@models/book.model";

export interface ParsedSeriesTitle {
  /** The title without its "(Series, #n)" suffix. */
  title: string;
  series: string;
  /** "1", "0.5" or a range such as "1-3". */
  seriesNumber: string;
}

/**
 * Goodreads writes a book's series after its title: "The Colour of Magic
 * (Discworld, #1)", "Dune (Dune Chronicles #1)", "Omnibus (Series, #1-3)".
 * A "#number" is required so an ordinary parenthesis such as "(Special
 * Edition)" is never mistaken for a series.
 */
const TRAILING_SERIES =
  /^(.+?)\s*\(\s*([^()]+?)\s*,?\s*#\s*(\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?)\s*\)\s*$/;

export function parseSeriesFromTitle(
  rawTitle: string,
): ParsedSeriesTitle | null {
  const match = TRAILING_SERIES.exec((rawTitle ?? "").trim());
  if (!match) return null;
  const [, title, series, number] = match;
  return {
    title: title.trim(),
    series: series.trim(),
    seriesNumber: number.replace(/\s+/g, "").replace("–", "-"),
  };
}

/** `{ series, seriesNumber }` when the title carries a series suffix, else `{}`. */
export function seriesFromTitle(
  title: string,
): Pick<Book, "series" | "seriesNumber"> {
  const parsed = parseSeriesFromTitle(title);
  return parsed
    ? { series: parsed.series, seriesNumber: parsed.seriesNumber }
    : {};
}

/**
 * A wikilink to the series note, `[[Discworld]]`. Characters that cannot be
 * part of a link target or file name are dropped; empty when nothing is left.
 */
export function formatSeriesLink(series: string): string {
  const target = (series ?? "")
    .replace(/[[\]#^|\\/:*?"<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return target ? `[[${target}]]` : "";
}

/**
 * Settle the series fields just before a note is rendered. `series` and
 * `seriesNumber` come from the provider; `seriesLink` is always derived here,
 * so the "Enable series linking" setting decides in one place whether notes get
 * a `[[wikilink]]` (and with it a link in the graph) or not.
 */
export function applySeriesFields(book: Book, enableLinking: boolean): void {
  const series = typeof book.series === "string" ? book.series.trim() : "";
  book.series = series;
  book.seriesLink = enableLinking ? formatSeriesLink(series) : "";
}
