/**
 * Finding the note a book already has in the vault, so the plugin can offer
 * to open or update it instead of creating a duplicate.
 */

/** The digits of an ISBN however it was written ("978-0-552-12475-1", a YAML
 * number…), or "" when it is not a 10- or 13-character ISBN. */
export function normalizeIsbn(value: unknown): string {
  const text =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value
        : "";
  const digits = text.replace(/[^0-9Xx]/g, "").toUpperCase();
  return digits.length === 10 || digits.length === 13 ? digits : "";
}

/** The ISBN-13 form of an ISBN, so ISBN-10 and ISBN-13 of one book compare equal. */
export function toIsbn13(isbn: string): string {
  if (isbn.length === 13) return isbn;
  if (isbn.length !== 10) return "";
  const core = `978${isbn.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  return `${core}${(10 - (sum % 10)) % 10}`;
}

/**
 * Every ISBN a note's frontmatter holds, whatever its key is called: `isbn13`,
 * `isbn 13` (the shipped templates), `isbn_13`, `ISBN-13`, `isbn10`, `isbn`,
 * Calibre's `ids`… Values are normalised; lists are read item by item.
 */
export function frontmatterIsbns(
  frontmatter: Record<string, unknown>,
): string[] {
  const found: string[] = [];
  for (const [key, raw] of Object.entries(frontmatter)) {
    const name = key.toLowerCase().replace(/[\s_-]/g, "");
    if (!["isbn", "isbn10", "isbn13", "ids"].includes(name)) continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      const isbn = normalizeIsbn(value);
      if (isbn && !found.includes(isbn)) found.push(isbn);
    }
  }
  return found;
}

/** True when `path` is inside `folder` (a real folder boundary, not a prefix). */
export function isInFolder(path: string, folder: string): boolean {
  const base = (folder || "").replace(/^\/+|\/+$/g, "");
  return !base || path.startsWith(`${base}/`);
}

/** The slice of Obsidian's App this lookup needs (easy to fake in tests). */
export interface NoteLookupApp {
  vault: { getMarkdownFiles(): Array<{ path: string; basename: string }> };
  metadataCache: {
    getFileCache(file: {
      path: string;
    }): { frontmatter?: Record<string, unknown> } | null;
  };
}

/**
 * The existing note for a book in `folder`: first by ISBN (any spelling, ISBN-10
 * or ISBN-13), then by name, either the file name a new note would get or the
 * bare title.
 */
export function findExistingBookNote<
  F extends { path: string; basename: string },
>(
  app: {
    vault: { getMarkdownFiles(): F[] };
    metadataCache: NoteLookupApp["metadataCache"];
  },
  folder: string,
  book: { title: string; isbns: readonly string[]; fileName?: string },
): F | null {
  const files = app.vault
    .getMarkdownFiles()
    .filter((file) => isInFolder(file.path, folder));

  const wanted = new Set(
    book.isbns.map((isbn) => toIsbn13(normalizeIsbn(isbn))).filter(Boolean),
  );
  if (wanted.size > 0) {
    const byIsbn = files.find((file) => {
      const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
      return (
        !!frontmatter &&
        frontmatterIsbns(frontmatter).some((isbn) => wanted.has(toIsbn13(isbn)))
      );
    });
    if (byIsbn) return byIsbn;
  }

  const names = new Set(
    [book.fileName, book.title]
      .filter((name): name is string => !!name && !!name.trim())
      .map((name) => name.toLowerCase().trim()),
  );
  return (
    files.find((file) => names.has(file.basename.toLowerCase().trim())) ?? null
  );
}
