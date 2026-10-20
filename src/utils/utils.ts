import { Book, FrontMatter } from "@models/book.model";
import { DefaultFrontmatterKeyType } from "@settings/key_type";

// == Format Syntax == //
export const NUMBER_REGEX = /^-?[0-9]*$/;
export const DATE_REGEX = /{{DATE(\+-?[0-9]+)?}}/;
export const DATE_REGEX_FORMATTED = /{{DATE:([^}\n\r+]*)(\+-?[0-9]+)?}}/;

export function replaceIllegalFileNameCharactersInString(text: string) {
  return text.replace(/[\\,#%&{}/*<>$":@.?|]/g, "").replace(/\s+/g, " ");
}

export function isISBN(str: string) {
  return /^(97(8|9))?\d{9}(\d|X)$/.test(str);
}

/**
 * Pick an ISBN out of a note's frontmatter.
 *
 * The shipped templates write `isbn 10` / `isbn 13` (with a space), while the
 * plugin's own lookups used to read only `isbn10` / `isbn13` — so notes created
 * by this plugin never matched. Accept every spelling a template may use.
 */
export function frontmatterIsbn(
  frontmatter: Record<string, unknown>,
  length: 10 | 13,
): string {
  const wanted = new Set([
    `isbn${length}`,
    `isbn ${length}`,
    `isbn-${length}`,
    `isbn_${length}`,
  ]);

  for (const [key, value] of Object.entries(frontmatter)) {
    if (!wanted.has(key.trim().toLowerCase().replace(/\s+/g, " "))) continue;
    const text =
      typeof value === "string"
        ? value
        : typeof value === "number"
          ? String(value)
          : "";
    const trimmed = text.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/** Render an unknown scalar as a string, without ever producing "[object Object]". */
function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return "";
}

/**
 * Escape a string for a YAML double-quoted scalar.
 *
 * Handles the four common escapes in one regex pass, then only pays for the
 * rarer control characters when the string actually has one — descriptions can
 * be several kilobytes.
 */
function escapeYamlDoubleQuoted(value: string): string {
  return (
    value
      .replace(/[\\"\r\n\t]/g, (char) => {
        if (char === "\\") return "\\\\";
        if (char === '"') return '\\"';
        if (char === "\t") return "\\t";
        return "\\n";
      })
      // A raw C0 control (or DEL) anywhere makes the whole frontmatter
      // unparseable; C1 controls are legal YAML and pass through untouched.
      .replace(/\p{Cc}/gu, (char) =>
        char === "\u007f" || char.charCodeAt(0) < 0x20
          ? `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`
          : char,
      )
  );
}

/** Render a value as a YAML double-quoted scalar. */
function quoteYaml(value: string): string {
  return `"${escapeYamlDoubleQuoted(value)}"`;
}

/**
 * Drop the outer quotes a value may already carry — either literal (`"176"`, as
 * produced when a template variable is wrapped in quotes) or escaped (`\"176\"`).
 * Without this, values that arrive pre-quoted end up double-quoted (`"\"176\""`).
 */
function stripOuterQuotes(value: string): string {
  const text = value.trim();
  if (text.length < 2) return text;
  const isQuote = (char: string): boolean => char === '"' || char === "'";
  // Walk in from each end over any run of backslashes, then require a real quote.
  let start = 0;
  while (start < text.length && text[start] === "\\") start++;
  let end = text.length - 1;
  while (end >= 0 && text[end] === "\\") end--;
  if (start >= end) return text;
  if (!isQuote(text[start]) || !isQuote(text[end])) return text;
  return text.slice(start + 1, end);
}

// Characters that change a plain scalar's meaning when they lead it: indicators
// (`- ? : , [ ] { } # & * ! | > ' " % @ \``), a `#`-prefixed comment, or a
// document marker. A leading `-` is only an indicator when a space follows.
const LEADING_YAML_INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;
const DOC_MARKER = /^(---|\.\.\.)(\s|$)/;

/**
 * True when `value` can be written as a bare YAML scalar.
 *
 * Anything that would change meaning if written bare (newlines, a leading
 * indicator like `- `, an embedded `#` comment, inner `: `, or leading/trailing
 * spaces) must be quoted instead — otherwise Obsidian either mis-parses the
 * property or fails to read the whole frontmatter block.
 */
function isSafeBareYaml(value: string): boolean {
  if (!value) return false;
  if (/[\r\n\t]/.test(value)) return false;
  if (value !== value.trim()) return false;
  if (/\s#/.test(value)) return false;
  if (LEADING_YAML_INDICATOR.test(value)) return false;
  if (DOC_MARKER.test(value)) return false;
  if (/:\s/.test(value)) return false;
  if (value.endsWith(":")) return false;
  if (value.includes('"')) return false;
  return true;
}

/**
 * Frontmatter keys whose value must be written as a quoted string even when it
 * looks numeric (page counts, ISBNs). Covers the key spellings used by every
 * shipped template, so a localised key like the Arabic `عدد الصفحات` behaves the
 * same as `Pages`.
 */
const QUOTED_NUMERIC_KEYS = new Set([
  "isbn",
  "isbn 10",
  "isbn 13",
  "isbn10",
  "isbn13",
  "asin",
  "pages",
  "page",
  "total pages",
  "total page",
  "number of pages",
  "páginas",
  "paginas",
  "total de páginas",
  "pagine",
  "pagine totali",
  "seiten",
  "gesamtseitenzahl",
  "страниц",
  "всего страниц",
  "페이지",
  "총 페이지 수",
  "页",
  "总页数",
  "ページ",
  "総ページ数",
  "عدد الصفحات",
  "الصفحات",
]);

/**
 * Render a scalar for use as a value: bare when safe, quoted otherwise.
 *
 * Numeric-looking values are left alone here on purpose — a genuinely numeric
 * property (a rating, a year) should stay a number. Fields that must remain
 * strings are handled by `QUOTED_NUMERIC_KEYS` above.
 */
function yamlScalar(value: string): string {
  return isSafeBareYaml(value) ? value : quoteYaml(value);
}

/** Render a scalar for use as a `- ` list item. */
function yamlListItem(value: string): string {
  return isSafeBareYaml(value) ? `- ${value}` : `- ${quoteYaml(value)}`;
}

export function makeFileName(
  book: Book,
  fileNameFormat?: string,
  extension = "md",
) {
  let result: string;
  if (fileNameFormat) {
    result = replaceVariableSyntax(book, replaceDateInString(fileNameFormat));
  } else {
    result = !book.author ? book.title : `${book.title} - ${book.author}`;
  }
  return replaceIllegalFileNameCharactersInString(result) + `.${extension}`;
}

export function changeSnakeCase(book: Book): Record<string, unknown> {
  return Object.entries(book).reduce<Record<string, unknown>>(
    (acc, [key, value]) => {
      acc[camelToSnakeCase(key)] = value;
      return acc;
    },
    {},
  );
}

export function applyDefaultFrontMatter(
  book: Book,
  frontmatter: FrontMatter | string,
  keyType: DefaultFrontmatterKeyType = DefaultFrontmatterKeyType.snakeCase,
) {
  const extraFrontMatter =
    typeof frontmatter === "string"
      ? parseFrontMatter(frontmatter)
      : frontmatter;

  const bookData: Record<string, unknown> =
    keyType === DefaultFrontmatterKeyType.camelCase
      ? { ...book }
      : changeSnakeCase(book);

  const result: Record<string, unknown> = { ...extraFrontMatter };

  // Add book data only if it doesn't exist in extraFrontMatter (case-insensitive check)
  const existingKeys = new Set(Object.keys(result).map((k) => k.toLowerCase()));

  for (const key in bookData) {
    const value = bookData[key];
    if (
      !existingKeys.has(key.toLowerCase()) &&
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      result[key] = value;
    }
  }

  return result;
}

/** Strip a wikilink wrapper: `[[path]]` or `[[path|alias]]` → `path`. */
function stripWikiBrackets(value: string): string {
  const match = value.match(/^\s*!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/);
  return match ? match[1] : value;
}

/**
 * Apply chained template modifiers to a substituted value (e.g. "raw:url"):
 * - `raw`: strip surrounding `[[ ]]` wikilink brackets, leaving the bare path
 * - `url`: URL-encode (spaces → %20) while preserving path/URL structure
 * Unknown modifiers are ignored.
 */
function applyTemplateModifiers(value: string, modifiers?: string): string {
  if (!modifiers) return value;
  let result = value;
  for (const modifier of modifiers
    .split(":")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean)) {
    if (modifier === "raw") {
      result = stripWikiBrackets(result);
    } else if (modifier === "url") {
      result = encodeURI(result);
    }
  }
  return result;
}

export function replaceVariableSyntax(book: Book, text: string): string {
  if (!text?.trim()) {
    return "";
  }

  const entries = Object.entries(book) as [string, unknown][];

  return (
    entries
      .reduce((result, [key, val]) => {
        if (Array.isArray(val)) {
          // Check if the variable is wrapped in quotes in the template: "{{key}}"
          const quotedRegex = new RegExp(`(['"]){{${key}}}(['"])`, "ig");
          if (quotedRegex.test(result)) {
            const commaString = val
              .map((v) => stringifyValue(v).trim())
              .join(", ");
            return result.replace(quotedRegex, `$1${commaString}$2`);
          }
          const listString = val
            .map((v) => `\n  - ${stringifyValue(v)}`)
            .join("");
          return result.replace(new RegExp(`{{${key}}}`, "ig"), listString);
        }
        // Scalar values support optional chained modifiers: {{key:raw}},
        // {{key:url}}, {{key:raw:url}}.
        const value = stringifyValue(val);
        return result.replace(
          new RegExp(`{{${key}(?::([a-zA-Z][a-zA-Z:]*))?}}`, "ig"),
          (_match: string, modifiers: string | undefined) =>
            applyTemplateModifiers(value, modifiers),
        );
      }, text)
      // Strip any leftover unmatched variables (with or without modifiers).
      .replace(/{{\w+(?::[\w:]+)?}}/gi, "")
      .trim()
  );
}

/**
 * Book fields that are conceptually *lists* but are transported as a single
 * comma-separated string by the providers (e.g. `"Fantasy, Classics"`).
 *
 * Their template variables (`{{categories}}`) are expanded into a YAML list so
 * each value becomes its own entry instead of one long comma-joined sentence.
 */
export const LIST_VALUE_KEYS = new Set(["categories", "tags"]);

/** Split a `"a, b, c"` provider string into `["a", "b", "c"]`. */
export function splitListValue(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function camelToSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function parseFrontMatter(frontMatterString: string) {
  if (!frontMatterString) return {};
  return frontMatterString
    .split("\n")
    .filter((line) => line.trim() !== "" && line.trim() !== "---")
    .map((item) => {
      const index = item.indexOf(":");
      if (index === -1) return [item.trim(), ""];

      const key = item.slice(0, index)?.trim();
      const value = item.slice(index + 1)?.trim();
      return [key, value];
    })
    .reduce((acc, [key, value]) => {
      if (key) {
        acc[key] = value?.trim() ?? "";
      }
      return acc;
    }, {});
}

export function toStringFrontMatter(frontMatter: object): string {
  return (Object.entries(frontMatter) as [string, unknown][])
    .map(([key, newValue]) => {
      const isDescriptionKey =
        key.toLowerCase() === "description" ||
        key.toLowerCase() === "resumen" ||
        key.toLowerCase() === "summary";

      if (Array.isArray(newValue)) {
        if (newValue.length === 0) return "";
        const listValues = newValue
          .map((v) => yamlListItem(stripOuterQuotes(stringifyValue(v))))
          .join("\n");
        return `${key}:\n${listValues}\n`;
      }

      const stringValue = stripOuterQuotes(stringifyValue(newValue));
      if (stringValue === "") {
        return `${key}: ""\n`;
      }

      // ISBN and page-count keys must stay quoted strings: a bare number would be
      // typed as a Number property by Obsidian. Explicitly listed rather than
      // suffix-matched so unrelated keys ("Pagecount", "ISBNote") are unaffected.
      if (QUOTED_NUMERIC_KEYS.has(key.trim().toLowerCase())) {
        return `${key}: ${quoteYaml(stringValue)}\n`;
      }

      if (isDescriptionKey) {
        // Strip leading/trailing quotes if they exist to avoid double quoting
        const cleanValue = stringValue;
        let isOpening = true;
        const hasDoubleQuotes = cleanValue.includes('"');

        const escapedValue = cleanValue.replace(
          /"|'/gu,
          (match: string, offset: number, fullText: string) => {
            if (match === '"') {
              const char = isOpening ? "«" : "»";
              isOpening = !isOpening;
              return char;
            }

            // Stateful Single Quote Logic
            const prev = offset > 0 ? fullText[offset - 1] : "";
            const next =
              offset < fullText.length - 1 ? fullText[offset + 1] : "";

            const isLetterBefore = /\p{L}/u.test(prev);
            const isLetterAfter = /\p{L}/u.test(next);

            // 1. Protect apostrophes (don't, it's)
            if (isLetterBefore && isLetterAfter) {
              return "'";
            }

            // 2. Protect plural possessives (users')
            if (
              prev.toLowerCase() === "s" &&
              (!next || /[\s\p{P}]/u.test(next))
            ) {
              return "'";
            }

            // 3. Nesting-Aware Logic:
            // If double quotes are present, we treat them as the primary level (replaced with «»)
            // and leave single quotes as the secondary level (kept as ').
            // We ONLY replace single quotes if there are NO double quotes in the text.
            if (hasDoubleQuotes) {
              return "'";
            }

            const char = isOpening ? "«" : "»";
            isOpening = !isOpening;
            return char;
          },
        );
        // Always double-quote: descriptions routinely span several paragraphs,
        // and a raw newline inside a quoted scalar makes the YAML unparseable.
        return `${key}: ${quoteYaml(escapedValue)}\n`;
      }

      return `${key}: ${yamlScalar(stringValue)}\n`;
    })
    .join("")
    .trim();
}

export function getDate(input?: { format?: string; offset?: number }) {
  let duration: ReturnType<typeof window.moment.duration> | undefined;

  if (
    input?.offset !== null &&
    input?.offset !== undefined &&
    typeof input.offset === "number"
  ) {
    duration = window.moment.duration(input.offset, "days");
  }

  return input?.format
    ? window.moment().add(duration).format(input?.format)
    : window.moment().add(duration).format("YYYY-MM-DD");
}

export function replaceDateInString(input: string) {
  let output: string = input;

  while (DATE_REGEX.test(output)) {
    const dateMatch = DATE_REGEX.exec(output);
    let offset = 0;

    if (dateMatch?.[1]) {
      const offsetString = dateMatch[1].replace("+", "").trim();
      const offsetIsInt = NUMBER_REGEX.test(offsetString);
      if (offsetIsInt) offset = parseInt(offsetString);
    }
    output = replacer(output, DATE_REGEX, getDate({ offset }));
  }

  while (DATE_REGEX_FORMATTED.test(output)) {
    const dateMatch = DATE_REGEX_FORMATTED.exec(output);
    const format = dateMatch?.[1];
    let offset = 0;

    if (dateMatch?.[2]) {
      const offsetString = dateMatch[2].replace("+", "").trim();
      const offsetIsInt = NUMBER_REGEX.test(offsetString);
      if (offsetIsInt) offset = parseInt(offsetString);
    }

    output = replacer(
      output,
      DATE_REGEX_FORMATTED,
      getDate({ format, offset }),
    );
  }

  return output;
}

function replacer(str: string, reg: RegExp, replaceValue: string) {
  return str.replace(reg, function () {
    return replaceValue;
  });
}

export function createBookTags(
  book: Book,
  authorPrefix?: string,
  titlePrefix?: string,
): string[] {
  const sanitize = (str: string) => {
    return str
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^\p{L}\p{N}_]/gu, "");
  };

  const tags: string[] = [];

  // 1. Author tag (primary)
  const authorName =
    book.author ||
    (book.authors && book.authors.length > 0 ? book.authors[0] : "");
  if (authorName) {
    tags.push((authorPrefix || "") + sanitize(authorName));
  }

  // 2. Title tag
  if (book.title) {
    tags.push((titlePrefix || "") + sanitize(book.title));
  }

  return tags.filter((t) => t.length > 0);
}
