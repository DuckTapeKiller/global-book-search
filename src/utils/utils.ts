import { Book, FrontMatter } from "@models/book.model";
import { DefaultFrontmatterKeyType } from "@settings/settings";

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

export function makeFileName(
  book: Book,
  fileNameFormat?: string,
  extension = "md",
) {
  let result;
  if (fileNameFormat) {
    result = replaceVariableSyntax(book, replaceDateInString(fileNameFormat));
  } else {
    result = !book.author ? book.title : `${book.title} - ${book.author}`;
  }
  return replaceIllegalFileNameCharactersInString(result) + `.${extension}`;
}

export function changeSnakeCase(book: Book) {
  return Object.entries(book).reduce((acc, [key, value]) => {
    acc[camelToSnakeCase(key)] = value;
    return acc;
  }, {});
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

  const bookData =
    keyType === DefaultFrontmatterKeyType.camelCase
      ? book
      : (changeSnakeCase(book) as Record<string, unknown>);

  const result = { ...extraFrontMatter };

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

export function replaceVariableSyntax(book: Book, text: string): string {
  if (!text?.trim()) {
    return "";
  }

  const entries = Object.entries(book);

  return entries
    .reduce((result, [key, val = ""]) => {
      if (Array.isArray(val)) {
        // Check if the variable is wrapped in quotes in the template: "{{key}}"
        const quotedRegex = new RegExp(`(['"]){{${key}}}(['"])`, "ig");
        if (quotedRegex.test(result)) {
          const commaString = val.map((v) => v.trim()).join(", ");
          return result.replace(quotedRegex, `$1${commaString}$2`);
        }
        const listString = val.map((v) => `\n  - ${v}`).join("");
        return result.replace(new RegExp(`{{${key}}}`, "ig"), listString);
      }
      return result.replace(new RegExp(`{{${key}}}`, "ig"), String(val));
    }, text)
    .replace(/{{\w+}}/gi, "")
    .trim();
}

export function camelToSnakeCase(str) {
  return str.replace(/[A-Z]/g, (letter) => `_${letter?.toLowerCase()}`);
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
  return Object.entries(frontMatter)
    .map(([key, newValue]) => {
      const isDescriptionKey =
        key.toLowerCase() === "description" ||
        key.toLowerCase() === "resumen" ||
        key.toLowerCase() === "summary";

      if (Array.isArray(newValue)) {
        if (newValue.length === 0) return "";
        const listValues = newValue.map((v) => `  - ${v}`).join("\n");
        return `${key}:\n${listValues}\n`;
      }

      let stringValue = newValue?.toString().trim() ?? "";
      if (stringValue === "" || stringValue === '""') {
        return `${key}: ""\n`;
      }

      const isNumericStringKey =
        key.toLowerCase().includes("isbn") ||
        key.toLowerCase().includes("páginas") ||
        key.toLowerCase().includes("pages") ||
        key.toLowerCase().includes("pagine") ||
        key.toLowerCase().includes("pagina") ||
        key.toLowerCase().includes("페이지") ||
        key.toLowerCase().includes("页") ||
        key.toLowerCase().includes("страниц") ||
        key.toLowerCase().includes("seiten") ||
        key.toLowerCase().includes("page");

      if (isNumericStringKey) {
        // Force quotes for numeric strings like ISBN and Pages to prevent Obsidian/YAML issues
        stringValue = stringValue.replace(/^"|"$/g, "");
        return `${key}: "${stringValue}"\n`;
      }

      if (isDescriptionKey) {
        // Strip leading/trailing quotes if they exist to avoid double quoting
        stringValue = stringValue.replace(/^"|"$/g, "");
        let isOpening = true;
        const hasDoubleQuotes = stringValue.includes('"');

        const escapedValue = stringValue.replace(
          /"|'/gu,
          (match, offset, fullText) => {
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
        return `${key}: "${escapedValue}"\n`;
      }

      if (/\r|\n/.test(stringValue)) {
        if (stringValue.trim().startsWith("- ")) {
          return `${key}:\n  ${stringValue.trim()}\n`;
        }
        return "";
      }

      if (/:\s/.test(stringValue) || /"/.test(stringValue)) {
        // Standard YAML escaping for other fields, but strip outer quotes if present
        const cleanValue = stringValue.replace(/^"|"$/g, "");
        const escapedValue = cleanValue.replace(/"/g, '\\"');
        return `${key}: "${escapedValue}"\n`;
      }
      return `${key}: ${stringValue}\n`;
    })
    .join("")
    .trim();
}

export function getDate(input?: { format?: string; offset?: number }) {
  let duration;

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

function replacer(str: string, reg: RegExp, replaceValue) {
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

  const tags = [];

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
