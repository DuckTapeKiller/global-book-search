import { requestUrl } from "obsidian";
import { Book } from "@models/book.model";
import { BookSearchPluginSettings } from "@settings/settings";
import { GLOBAL_SEARCH_SOURCE_LABELS } from "@src/constants";
import { factoryServiceProvider } from "@apis/base_api";
import { GoogleBooksApi } from "@apis/google_books_api";
import { OpenLibraryApi } from "@apis/open_library_api";
import { GoodreadsApi } from "@apis/goodreads_api";
import { StoryGraphApi } from "@apis/storygraph_api";

import {
  BookEdition,
  EnrichmentResult,
  FieldConflict,
  VaultIndexEntry,
} from "@models/accuracy.model";

export interface BookWithSource extends Book {
  _sourceLabels: string[]; // Human-readable: ["Goodreads", "StoryGraph"]
  _sourceIds: string[]; // Machine: ["goodreads", "storygraph"]
  _editions?: BookEdition[]; // Multiple editions found during search
  _isInVault?: boolean;
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
  options?: {
    locale?: string;
    includeCalibre?: boolean;
    vaultIndex?: VaultIndexEntry[];
  },
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

  // Deduplicate and Group by "Work" (Title + Author)
  const workMap = new Map<string, BookWithSource>();

  const normalize = (str: string): string =>
    (str || "")
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");

  combinedResults.forEach((book) => {
    const key = `${normalize(book.title)}|${normalize(book.author)}`;
    const existing = workMap.get(key);

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

      // Track distinct editions (different ISBNs)
      if (book.isbn13 || book.isbn10) {
        if (!existing._editions) existing._editions = [];
        const isNewEdition = !existing._editions.some(
          (e) =>
            (e.isbn13 && e.isbn13 === book.isbn13) ||
            (e.isbn10 && e.isbn10 === book.isbn10),
        );
        if (isNewEdition) {
          existing._editions.push({
            ...book,
            _providerId: book._sourceIds[0],
          } as BookEdition);
        }
      }
    } else {
      const newWork = { ...book, _editions: [] };
      if (book.isbn13 || book.isbn10) {
        newWork._editions.push({
          ...book,
          _providerId: book._sourceIds[0],
        } as BookEdition);
      }
      workMap.set(key, newWork);
    }
  });

  const finalResults = Array.from(workMap.values());

  // Mark "In Vault" status
  if (options?.vaultIndex) {
    finalResults.forEach((work) => {
      const editions = work._editions || [];
      const isAnyEditionInVault = editions.some((ed) =>
        options.vaultIndex?.some(
          (v) =>
            (ed.isbn13 && ed.isbn13 === v.isbn13) ||
            (ed.isbn10 && ed.isbn10 === v.isbn10),
        ),
      );
      if (isAnyEditionInVault) {
        work._isInVault = true;
      }
    });
  }

  return finalResults;
}

function upgradeGoogleCover(url: string): string {
  if (!url) return url;
  if (url.includes("books.google.com") && url.includes("zoom=1")) {
    return url.replace("zoom=1", "zoom=3");
  }
  return url;
}

export async function enrichBookByISBN(
  primaryBook: BookWithSource,
  settings: BookSearchPluginSettings,
  onProgress?: (message: string) => void,
): Promise<EnrichmentResult> {
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
    return { book, sources: [primarySourceLabel], conflicts: [] };
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

  // ── Step 5: Merge with Conflict Tracking ───────────────────────────────────
  const {
    merged: mergedBook,
    contributingSources,
    conflicts,
  } = mergeWithConflicts(book, goodreadsData, secondaries);

  // ── Step 6: Fable passive enrichment (with cover upgrade) ──────────────────
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

  // Upgrade Google cover if it's the only one we have
  if (mergedBook.coverUrl?.includes("books.google.com")) {
    mergedBook.coverUrl = upgradeGoogleCover(mergedBook.coverUrl);
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
    conflicts,
  };
}

function mergeWithConflicts(
  primary: Book,
  goodreads: Book | null,
  secondaries: BookWithSource[],
): { merged: Book; contributingSources: string[]; conflicts: FieldConflict[] } {
  const contributingSources = new Set<string>();
  const result: Book = { ...primary };
  const conflicts: FieldConflict[] = [];

  const fieldsToTrack: { name: keyof Book; label: string }[] = [
    { name: "title", label: "Title" },
    { name: "author", label: "Author" },
    { name: "publisher", label: "Publisher" },
    { name: "publishDate", label: "Publish Date" },
    { name: "totalPage", label: "Page Count" },
    { name: "categories", label: "Categories" },
  ];

  fieldsToTrack.forEach((field) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allValues: { value: any; source: string }[] = [];

    // Add primary source value
    if (primary[field.name]) {
      allValues.push({
        value: primary[field.name],
        source:
          (primary as BookWithSource)._sourceLabels?.[0] || "Primary Source",
      });
    }

    // Add Goodreads value
    if (goodreads && goodreads[field.name]) {
      allValues.push({ value: goodreads[field.name], source: "Goodreads" });
    }

    // Add secondary values
    secondaries.forEach((sec) => {
      if (sec[field.name]) {
        allValues.push({
          value: sec[field.name],
          source: sec._sourceLabels?.[0] || "Secondary Source",
        });
      }
    });

    if (allValues.length > 1) {
      // Check for conflict
      const distinctValues = [
        ...new Set(allValues.map((v) => String(v.value).toLowerCase().trim())),
      ];

      if (distinctValues.length > 1) {
        // We have a conflict!
        const quorumValue = getQuorumValue(allValues.map((v) => v.value));
        conflicts.push({
          fieldName: field.name as string,
          label: field.label,
          values: allValues.map((v) => ({
            ...v,
            isQuorum:
              String(v.value).toLowerCase().trim() ===
              String(quorumValue).toLowerCase().trim(),
          })),
          currentBestValue: quorumValue,
        });
      }
    }
  });

  // Now perform the actual merge (Goodreads still wins by default if present)
  if (goodreads) {
    contributingSources.add("Goodreads");
    Object.keys(goodreads).forEach((field) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const val = (goodreads as any)[field];
      if (val && field !== "link" && field !== "previewLink") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (result as any)[field] = val;
      }
    });
  }

  secondaries.forEach((sec) => {
    Object.keys(sec).forEach((field) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(result as any)[field] && (sec as any)[field]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (result as any)[field] = (sec as any)[field];
        contributingSources.add(sec._sourceLabels[0]);
      }
    });
  });

  return {
    merged: result,
    contributingSources: Array.from(contributingSources),
    conflicts,
  };
}

function getQuorumValue<T>(values: T[]): T | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<string, number>();
  values.forEach((v) => {
    const s = String(v).toLowerCase().trim();
    if (s) counts.set(s, (counts.get(s) || 0) + 1);
  });
  let maxCount = 0;
  let quorumValue = values[0];
  counts.forEach((count, valStr) => {
    if (count > maxCount) {
      maxCount = count;
      // Find the original value that matches this string
      quorumValue = values.find(
        (v) => String(v).toLowerCase().trim() === valStr,
      );
    }
  });
  return quorumValue;
}
