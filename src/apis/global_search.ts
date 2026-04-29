import { requestUrl } from "obsidian";
import { Book } from "@models/book.model";
import { BookSearchPluginSettings } from "@settings/settings";
import { GLOBAL_SEARCH_SOURCE_LABELS } from "@src/constants";
import { factoryServiceProvider } from "@apis/base_api";
import { GoogleBooksApi } from "@apis/google_books_api";
import { OpenLibraryApi } from "@apis/open_library_api";
import { GoodreadsApi } from "@apis/goodreads_api";
import { StoryGraphApi } from "@apis/storygraph_api";

export interface BookWithSource extends Book {
  _sourceLabels: string[]; // Human-readable: ["Goodreads", "StoryGraph"]
  _sourceIds: string[]; // Machine: ["goodreads", "storygraph"]
}

const PROVIDER_ORDER = ["goodreads", "google", "openlibrary", "storygraph"];

async function timeoutReject<T>(ms: number, providerName: string): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(
      () =>
        reject(new Error(`Provider ${providerName} timed out after ${ms}ms`)),
      ms,
    );
  });
}

function toFableSlug(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s]/g, " ") // non-alphanumeric → space
    .replace(/\s+/g, " ") // collapse spaces
    .trim()
    .replace(/\s/g, "-"); // spaces → hyphens
}

async function fetchFableData(
  book: Book,
): Promise<{ description?: string; coverUrl?: string } | null> {
  const isbn = book.isbn13;
  if (!isbn) return null;

  // Extract the first listed author for the slug (handle "Last, First" format)
  const rawAuthor = (book.authors?.[0] || book.author || "").replace(
    /,\s*/,
    " ",
  );
  const titleSlug = toFableSlug(book.title);
  const authorSlug = toFableSlug(rawAuthor);

  if (!titleSlug || !authorSlug) return null;

  const url = `https://fable.co/book/${titleSlug}-by-${authorSlug}-${isbn}`;

  try {
    const response = await Promise.race([
      requestUrl({ url, method: "GET" }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Fable timeout")), 6000),
      ),
    ]);

    const html: string = (response as { text: string }).text;
    if (!html) return null;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Verify this is the right book by checking the ISBN in the DOM
    const bookGroup = doc.querySelector("div#book-group[data-isbn]");
    const pageIsbn = bookGroup?.getAttribute("data-isbn");
    if (pageIsbn && pageIsbn !== isbn) {
      // Wrong edition — Fable redirected to a different ISBN
      return null;
    }

    const descriptionEl = doc.querySelector("span.css-1l3pf7i > span");
    const coverEl = doc.querySelector('img[data-testid="bookCover"]');

    const description = descriptionEl?.textContent?.trim() || undefined;
    const rawCover = coverEl?.getAttribute("src") || undefined;
    // Strip query params from cover URL
    const coverUrl = rawCover ? rawCover.split("?")[0] : undefined;

    if (!description && !coverUrl) return null;

    return { description, coverUrl };
  } catch (err) {
    console.warn("Fable enrichment failed:", err);
    return null;
  }
}

/**
 * Passive enrichment from Library of Congress.
 * Dummy implementation as the source code was missing.
 */
async function fetchLocData(
  book: Book,
): Promise<Partial<
  Pick<
    Book,
    | "publisher"
    | "publishDate"
    | "totalPage"
    | "categories"
    | "isbn10"
    | "isbn13"
  >
> | null> {
  const isbn = book.isbn13;
  if (!isbn) return null;

  const url = `https://www.loc.gov/books/?q=isbn:${isbn}&fo=json`;

  try {
    const response = await Promise.race([
      requestUrl({ url, method: "GET" }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LoC timeout")), 6000),
      ),
    ]);

    const data = JSON.parse((response as { text: string }).text);
    const results: unknown[] = data?.results;
    if (!results || results.length === 0) return null;

    const result = results[0] as {
      date?: string;
      publisher?: string[];
      description?: string[];
      number?: string[];
      item?: { genre?: string[] };
    };

    const extracted: Partial<
      Pick<
        Book,
        | "publisher"
        | "publishDate"
        | "totalPage"
        | "categories"
        | "isbn10"
        | "isbn13"
      >
    > = {};

    // publishDate — year string e.g. "2015"
    if (result.date?.trim()) {
      extracted.publishDate = result.date.trim();
    }

    // publisher — strip trailing punctuation (LoC often appends commas/periods)
    const rawPublisher = result.publisher?.[0];
    if (rawPublisher) {
      extracted.publisher = rawPublisher.replace(/[,.]$/, "").trim();
    }

    // totalPage — parse largest integer before "pages" or "p." in description array
    let maxPages = 0;
    for (const desc of result.description || []) {
      const match = desc.match(/(\d+)\s+(?:pages|p\.)/i);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxPages) maxPages = n;
      }
    }
    if (maxPages > 0) {
      extracted.totalPage = maxPages;
    }

    // categories — from item.genre ONLY, max 3 terms
    // NEVER use result.subject (LCSH headings) — too verbose
    const genres = result.item?.genre;
    if (genres && genres.length > 0) {
      extracted.categories = genres.slice(0, 3).join(", ");
    }

    // isbn10 / isbn13 — parse from number array
    for (const num of result.number || []) {
      const digits = num.replace(/[^0-9X]/gi, "");
      if (digits.length === 13 && !extracted.isbn13) extracted.isbn13 = digits;
      if (digits.length === 10 && !extracted.isbn10) extracted.isbn10 = digits;
    }

    if (Object.keys(extracted).length === 0) return null;
    return extracted;
  } catch (err) {
    console.warn("LoC enrichment failed:", err);
    return null;
  }
}

export async function globalSearch(
  query: string,
  settings: BookSearchPluginSettings,
  options?: { locale?: string; includeCalibre?: boolean },
  onProgress?: (message: string) => void,
): Promise<BookWithSource[]> {
  const providers = [...PROVIDER_ORDER];
  if (options?.includeCalibre && settings.calibreServerUrl) {
    providers.push("calibre");
  }

  onProgress?.("Searching all sources...");

  const wrappedProviders = providers.map(async (providerId) => {
    try {
      const api = factoryServiceProvider(settings, providerId);
      // Increased timeout for StoryGraph as it relies on scraping
      const timeout = providerId === "storygraph" ? 12000 : 8000;

      const providerResults = await Promise.race([
        api.getByQuery(query, {
          locale: options?.locale || settings.localePreference,
        }),
        timeoutReject<Book[]>(timeout, providerId),
      ]);

      onProgress?.(`${GLOBAL_SEARCH_SOURCE_LABELS[providerId]} ✓`);
      return providerResults.map((book) => ({
        ...book,
        _sourceIds: [providerId],
        _sourceLabels: [GLOBAL_SEARCH_SOURCE_LABELS[providerId] || providerId],
      })) as BookWithSource[];
    } catch (error) {
      console.warn(`Global Search: Provider ${providerId} failed`, error);
      onProgress?.(`${GLOBAL_SEARCH_SOURCE_LABELS[providerId]} — no results`);
      return [] as BookWithSource[];
    }
  });

  const results = await Promise.allSettled(wrappedProviders);

  const combinedResults: BookWithSource[] = [];
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      combinedResults.push(...result.value);
    }
  });

  // Deduplicate: same normalized title + normalized author
  // Now merging source information instead of discarding
  const seenMap = new Map<string, BookWithSource>();

  const normalize = (str: string): string =>
    (str || "")
      .toLowerCase()
      .trim()
      .normalize("NFD") // decompose accented characters
      .replace(/[\u0300-\u036f]/g, "") // strip combining diacritical marks
      .replace(/\s+/g, " ");

  combinedResults.forEach((book) => {
    const key = `${normalize(book.title)}|${normalize(book.author)}`;
    const existing = seenMap.get(key);

    if (existing) {
      // Merge source info
      book._sourceIds.forEach((id) => {
        if (!existing._sourceIds.includes(id)) {
          existing._sourceIds.push(id);
          const label = GLOBAL_SEARCH_SOURCE_LABELS[id] || id;
          if (!existing._sourceLabels.includes(label)) {
            existing._sourceLabels.push(label);
          }
        }
      });
      // Merge identifiers if missing
      if (!existing.isbn13 && book.isbn13) existing.isbn13 = book.isbn13;
      if (!existing.isbn10 && book.isbn10) existing.isbn10 = book.isbn10;
    } else {
      seenMap.set(key, { ...book });
    }
  });

  return Array.from(seenMap.values());
}

export async function enrichBookByISBN(
  primaryBook: BookWithSource,
  settings: BookSearchPluginSettings,
  onProgress?: (message: string) => void,
): Promise<{ book: Book; sources: string[] }> {
  const sourceIds = primaryBook._sourceIds || [];
  const primarySourceId = sourceIds[0] || "";
  const primarySourceLabel = primaryBook._sourceLabels[0] || "";
  let goodreadsData: Book | null = null;

  // ── Step 1: Full data from primary source ─────────────────────────────────
  let book: Book = { ...primaryBook };
  try {
    const api = factoryServiceProvider(settings, primarySourceId);
    if (api.getBook) {
      onProgress?.(`Fetching full details from ${primarySourceLabel}...`);
      book = await Promise.race([
        api.getBook(book),
        timeoutReject<Book>(10000, primarySourceId),
      ]);
    }
  } catch (err) {
    console.warn(
      `Enrichment: primary source ${primarySourceId} getBook failed`,
      err,
    );
  }

  // ── Step 2: Extract ISBN ───────────────────────────────────────────────────
  let isbn = book.isbn13 || book.isbn10;

  // ── FALLBACK: If no ISBN, search Goodreads by Title/Author to find it ──────
  if (!isbn && primarySourceId !== "goodreads") {
    onProgress?.("No ISBN — searching Goodreads by title...");
    try {
      const grApi = new GoodreadsApi();
      const grResults = await Promise.race([
        grApi.getByQuery(`${book.title} ${book.author}`),
        timeoutReject<Book[]>(8000, "goodreads-title-fallback"),
      ]);

      if (grResults.length > 0) {
        // Use the first result as the most likely match
        const grFull = await Promise.race([
          grApi.getBook(grResults[0]),
          timeoutReject<Book>(8000, "goodreads-title-fallback-book"),
        ]);
        const grIsbn = grFull.isbn13 || grFull.isbn10;
        if (grIsbn) {
          isbn = grIsbn;
          goodreadsData = grFull;
          // Update the base book object so it carries the ISBN forward
          book.isbn13 = grFull.isbn13;
          book.isbn10 = grFull.isbn10;
          onProgress?.("ISBN found on Goodreads ✓");
        }
      }
    } catch (err) {
      console.warn("Goodreads title fallback failed", err);
    }
  }

  if (!isbn) {
    onProgress?.("No ISBN found — using primary source data only.");
    return { book, sources: [primarySourceLabel] };
  }

  // ── Step 3: Goodreads enrichment by ISBN ──────────────────────────────────
  if (primarySourceId !== "goodreads" && !goodreadsData) {
    onProgress?.("Fetching Goodreads data...");
    try {
      const grApi = new GoodreadsApi();
      const grResults = await Promise.race([
        grApi.getByQuery(isbn),
        timeoutReject<Book[]>(8000, "goodreads-enrich"),
      ]);
      if (grResults.length > 0) {
        const grFull = await Promise.race([
          grApi.getBook(grResults[0]),
          timeoutReject<Book>(8000, "goodreads-enrich-book"),
        ]);
        const grIsbn = grFull.isbn13 || grFull.isbn10;
        if (grIsbn && (grIsbn === book.isbn13 || grIsbn === book.isbn10)) {
          goodreadsData = grFull;
          onProgress?.("Goodreads ✓");
        } else {
          onProgress?.("Goodreads — edition mismatch, skipped");
        }
      } else {
        onProgress?.("Goodreads — no results");
      }
    } catch (err) {
      console.warn("Enrichment: Goodreads failed", err);
      onProgress?.("Goodreads — no results");
    }
  }

  // ── Step 4: Secondary sources in parallel ─────────────────────────────────
  onProgress?.("Enriching from secondary sources...");

  const secondaryProviderIds = ["google", "storygraph", "openlibrary"].filter(
    (id) => !sourceIds.includes(id),
  );

  const secondaryResultsWithIds = await Promise.allSettled(
    secondaryProviderIds.map(
      async (id): Promise<{ book: Book; providerId: string } | null> => {
        try {
          if (id === "google") {
            const api = new GoogleBooksApi(
              settings.localePreference,
              settings.enableCoverImageEdgeCurl,
              settings.apiKey,
            );
            const results = await Promise.race([
              api.getByQuery(`isbn:${isbn}`),
              timeoutReject<Book[]>(8000, id),
            ]);
            return results[0] ? { book: results[0], providerId: id } : null;
          }

          if (id === "storygraph") {
            const api = new StoryGraphApi();
            const results = await Promise.race([
              api.getByQuery(isbn),
              timeoutReject<Book[]>(8000, id),
            ]);
            if (results.length === 0) return null;
            const full = await Promise.race([
              api.getBook(results[0]),
              timeoutReject<Book>(8000, `${id}-getBook`),
            ]);
            const sgIsbn = full.isbn13 || full.isbn10;
            if (!sgIsbn || (sgIsbn !== book.isbn13 && sgIsbn !== book.isbn10)) {
              return null;
            }
            return { book: full, providerId: id };
          }

          if (id === "openlibrary") {
            const api = new OpenLibraryApi();
            const results = await Promise.race([
              api.getByQuery(`isbn:${isbn}`),
              timeoutReject<Book[]>(8000, id),
            ]);
            return results[0] ? { book: results[0], providerId: id } : null;
          }

          return null;
        } catch (err) {
          console.warn(`Enrichment: secondary provider ${id} failed`, err);
          return null;
        }
      },
    ),
  );

  const secondaries: BookWithSource[] = secondaryResultsWithIds
    .filter(
      (r): r is PromiseFulfilledResult<{ book: Book; providerId: string }> =>
        r.status === "fulfilled" && r.value !== null,
    )
    .map((r) => ({
      ...r.value.book,
      _sourceIds: [r.value.providerId],
      _sourceLabels: [
        GLOBAL_SEARCH_SOURCE_LABELS[r.value.providerId] || r.value.providerId,
      ],
    }));

  // ── Step 5: Merge ──────────────────────────────────────────────────────────
  const { merged: mergedBook, contributingSources } = mergeBooks(
    book,
    goodreadsData,
    secondaries,
  );

  // ── Step 6: Fable passive enrichment ──────────────────────────────────────
  const needsDescription = !mergedBook.description;
  const needsCover = !mergedBook.coverUrl;

  if ((needsDescription || needsCover) && mergedBook.isbn13) {
    onProgress?.("Checking Fable for missing fields...");
    const fableData = await fetchFableData(mergedBook);
    if (fableData) {
      if (needsDescription && fableData.description) {
        mergedBook.description = fableData.description;
        contributingSources.push("Fable");
      }
      if (needsCover && fableData.coverUrl) {
        mergedBook.coverUrl = fableData.coverUrl;
        if (!contributingSources.includes("Fable")) {
          contributingSources.push("Fable");
        }
      }
    }
  }

  // ── Step 7: Library of Congress passive enrichment ────────────────────────
  const needsLocData =
    !mergedBook.publisher ||
    !mergedBook.publishDate ||
    !mergedBook.totalPage ||
    !mergedBook.categories ||
    (!mergedBook.isbn10 && mergedBook.isbn13);

  if (needsLocData && mergedBook.isbn13) {
    onProgress?.("Checking Library of Congress for missing fields...");
    const locData = await fetchLocData(mergedBook);
    if (locData) {
      let locContributed = false;
      if (!mergedBook.publisher && locData.publisher) {
        mergedBook.publisher = locData.publisher;
        locContributed = true;
      }
      if (!mergedBook.publishDate && locData.publishDate) {
        mergedBook.publishDate = locData.publishDate;
        locContributed = true;
      }
      if (!mergedBook.totalPage && locData.totalPage) {
        mergedBook.totalPage = locData.totalPage;
        locContributed = true;
      }
      if (!mergedBook.categories && locData.categories) {
        mergedBook.categories = locData.categories;
        locContributed = true;
      }
      if (!mergedBook.isbn10 && locData.isbn10) {
        mergedBook.isbn10 = locData.isbn10;
        locContributed = true;
      }
      if (!mergedBook.isbn13 && locData.isbn13) {
        mergedBook.isbn13 = locData.isbn13;
        locContributed = true;
      }
      if (
        locContributed &&
        !contributingSources.includes("Library of Congress")
      ) {
        contributingSources.push("Library of Congress");
      }
    }
  }

  onProgress?.("Done.");
  return {
    book: mergedBook,
    sources: [...new Set([primarySourceLabel, ...contributingSources])],
  };
}

function mergeBooks(
  primary: Book,
  goodreads: Book | null,
  secondaries: BookWithSource[],
): { merged: Book; contributingSources: string[] } {
  const contributingSources = new Set<string>();

  // Start with primary data as the base
  const result: Book = { ...primary };

  // Fields that must NEVER change regardless of any source.
  // These preserve the identity of the record the user selected.
  const hardImmutable: (keyof Book)[] = [
    "link",
    "previewLink",
    "sourceProvider",
  ];

  // ── Apply Goodreads data (highest priority) ───────────────────────────────
  // Goodreads wins on every field where it has a non-falsy value,
  // INCLUDING title, author, authors, and coverUrl.
  if (goodreads) {
    const grLabel = "Goodreads";
    let grContributed = false;

    (Object.keys(goodreads) as (keyof Book)[]).forEach((field) => {
      if (hardImmutable.includes(field)) return;

      const grValue = goodreads[field];
      if (!grValue) return; // Goodreads has nothing for this field

      if (field === "tags") {
        // Merge tags
        const merged = [
          ...new Set([...(result.tags || []), ...(goodreads.tags || [])]),
        ];
        if (merged.length > (result.tags || []).length) {
          result.tags = merged;
          grContributed = true;
        }
        return;
      }

      if (field === "totalPage") {
        const existing = parseInt(String(result.totalPage || 0), 10);
        const grPages = parseInt(String(grValue), 10);
        if (grPages > 0) {
          // Goodreads wins even if existing has a value — it's the authority
          result.totalPage = grPages > existing ? grPages : existing;
          grContributed = true;
        }
        return;
      }

      // For all other fields: Goodreads wins unconditionally
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[field] = grValue;
      grContributed = true;
    });

    if (grContributed) contributingSources.add(grLabel);
  }

  // ── Apply secondary data (fill remaining gaps only) ───────────────────────
  // Secondary sources only fill fields that are STILL empty after
  // Goodreads has had its say. They never overwrite Goodreads data.
  for (const secondary of secondaries) {
    const secLabels = (secondary as BookWithSource)._sourceLabels || [];
    const secIds = (secondary as BookWithSource)._sourceIds || [];
    const secLabel =
      secLabels[0] || GLOBAL_SEARCH_SOURCE_LABELS[secIds[0] || ""] || "Unknown";

    (Object.keys(secondary) as (keyof Book)[]).forEach((field) => {
      if (hardImmutable.includes(field)) return;

      const secValue = secondary[field];
      if (!secValue) return;

      if (field === "tags") {
        const before = (result.tags || []).length;
        result.tags = [
          ...new Set([...(result.tags || []), ...(secondary.tags || [])]),
        ];
        if (result.tags.length > before) contributingSources.add(secLabel);
        return;
      }

      if (field === "totalPage") {
        const existing = parseInt(String(result.totalPage || 0), 10);
        const secPages = parseInt(String(secValue), 10);
        if (secPages > existing) {
          result.totalPage = secPages;
          contributingSources.add(secLabel);
        }
        return;
      }

      if (field === "coverUrl") {
        // Secondaries never overwrite coverUrl — Goodreads already set it
        // if it had one, and Fable handles the empty fallback case later
        if (!result.coverUrl) {
          result.coverUrl = secValue as string;
          contributingSources.add(secLabel);
        }
        return;
      }

      // Generic: only fill if still empty
      if (!result[field]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (result as any)[field] = secValue;
        contributingSources.add(secLabel);
      }
    });
  }

  return {
    merged: result,
    contributingSources: Array.from(contributingSources),
  };
}
