import { Book } from "@models/book.model";
import { BookSearchPluginSettings } from "@settings/settings";
import { ServiceProvider, GLOBAL_SEARCH_SOURCE_LABELS } from "@src/constants";
import { factoryServiceProvider } from "@apis/base_api";
import { GoogleBooksApi } from "@apis/google_books_api";
import { OpenLibraryApi } from "@apis/open_library_api";

export interface BookWithSource extends Book {
  _sourceLabel: string; // Human-readable: "Goodreads", "Google Books", "OpenLibrary", "StoryGraph"
  _sourceId: string; // Machine: "goodreads" | "google" | "openlibrary" | "storygraph"
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
      const providerResults = await Promise.race([
        api.getByQuery(query, {
          locale: options?.locale || settings.localePreference,
        }),
        timeoutReject<Book[]>(8000, providerId),
      ]);

      onProgress?.(`${GLOBAL_SEARCH_SOURCE_LABELS[providerId]} ✓`);
      return providerResults.map((book) => ({
        ...book,
        _sourceId: providerId,
        _sourceLabel: GLOBAL_SEARCH_SOURCE_LABELS[providerId] || providerId,
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
  const seen = new Set<string>();
  const deduplicatedResults: BookWithSource[] = [];

  const normalize = (str: string): string =>
    (str || "")
      .toLowerCase()
      .trim()
      .normalize("NFD") // decompose accented characters
      .replace(/[\u0300-\u036f]/g, "") // strip combining diacritical marks
      .replace(/\s+/g, " ");

  combinedResults.forEach((book) => {
    const key = `${normalize(book.title)}|${normalize(book.author)}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicatedResults.push(book);
    }
  });

  return deduplicatedResults;
}

export async function enrichBookByISBN(
  primaryBook: BookWithSource,
  settings: BookSearchPluginSettings,
  onProgress?: (message: string) => void,
): Promise<{ book: Book; sources: string[] }> {
  let book: Book = { ...primaryBook };
  const sourceId = primaryBook._sourceId || primaryBook.sourceProvider;

  // Step 1: Get full data from primary source
  if (sourceId) {
    try {
      const api = factoryServiceProvider(settings, sourceId);
      if (api.getBook) {
        onProgress?.(
          `Fetching full details from ${primaryBook._sourceLabel}...`,
        );
        book = await api.getBook(book);
      }
    } catch (error) {
      console.warn(
        `Enrichment: Failed to get full data from primary source ${sourceId}`,
        error,
      );
    }
  }

  // Step 2: Extract ISBN
  const isbn = book.isbn13 || book.isbn10;
  if (!isbn) {
    onProgress?.("No ISBN found — using primary source data only.");
    return { book, sources: [primaryBook._sourceLabel] };
  }

  // Step 3: Query secondary sources by ISBN
  const enrichmentProviders = ["google", "openlibrary"].filter(
    (id) => id !== sourceId,
  );
  onProgress?.("Enriching from secondary sources...");

  const secondaryResults = await Promise.allSettled(
    enrichmentProviders.map(async (id) => {
      try {
        let api;
        if (id === "google") {
          api = new GoogleBooksApi(
            settings.localePreference,
            settings.enableCoverImageEdgeCurl,
            settings.apiKey,
          );
        } else if (id === "openlibrary") {
          api = new OpenLibraryApi();
        } else {
          return null;
        }

        const results = await Promise.race([
          api.getByQuery(`isbn:${isbn}`, { locale: settings.localePreference }),
          timeoutReject<Book[]>(8000, id),
        ]);
        return results.length > 0 ? results[0] : null;
      } catch (error) {
        console.warn(`Enrichment: Secondary provider ${id} failed`, error);
        return null;
      }
    }),
  );

  const secondaries: Book[] = [];
  secondaryResults.forEach((result) => {
    if (result.status === "fulfilled" && result.value) {
      secondaries.push(result.value);
    }
  });

  // Step 4: Merge fields
  const { merged: mergedBook, contributingSources } = mergeBooks(
    book,
    ...secondaries,
  );

  onProgress?.("Done.");
  return {
    book: mergedBook,
    sources: [primaryBook._sourceLabel, ...contributingSources],
  };
}

function mergeBooks(
  primary: Book,
  ...secondaries: Book[]
): { merged: Book; contributingSources: string[] } {
  const result = { ...primary };
  const contributingSources = new Set<string>();

  const immutableFields = [
    "title",
    "author",
    "authors",
    "link",
    "previewLink",
    "_sourceId",
    "_sourceLabel",
    "sourceProvider",
  ];

  const allFieldsSet = new Set<keyof Book>(
    Object.keys(primary) as (keyof Book)[],
  );
  secondaries.forEach((s) => {
    Object.keys(s).forEach((k) => allFieldsSet.add(k as keyof Book));
  });
  const allFields = Array.from(allFieldsSet);

  allFields.forEach((field) => {
    if (immutableFields.includes(field)) return;

    // Special case for tags: merge and deduplicate
    if (field === "tags") {
      const allTags = [...(primary.tags || [])];
      secondaries.forEach((s) => {
        if (s.tags && s.tags.length > 0) {
          const originalLength = allTags.length;
          allTags.push(...s.tags);
          const uniqueTags = [...new Set(allTags)];
          if (uniqueTags.length > originalLength) {
            allTags.length = 0;
            allTags.push(...uniqueTags);
            const sourceLabel =
              (s as BookWithSource)._sourceLabel ||
              GLOBAL_SEARCH_SOURCE_LABELS[s.sourceProvider || ""] ||
              s.sourceProvider;
            if (sourceLabel) contributingSources.add(sourceLabel);
          }
        }
      });
      result.tags = allTags;
      return;
    }

    // Special case for coverUrl: only use secondary if primary is empty
    if (field === "coverUrl") {
      if (!result.coverUrl) {
        const secondary = secondaries.find((s) => s.coverUrl);
        if (secondary) {
          result.coverUrl = secondary.coverUrl;
          const sourceLabel =
            (secondary as BookWithSource)._sourceLabel ||
            GLOBAL_SEARCH_SOURCE_LABELS[secondary.sourceProvider || ""] ||
            secondary.sourceProvider;
          if (sourceLabel) contributingSources.add(sourceLabel);
        }
      }
      return;
    }

    // Special case for totalPage: prefer the larger integer
    if (field === "totalPage") {
      let maxPages = parseInt(String(primary.totalPage || 0), 10);
      let bestSecondary: Book | null = null;

      secondaries.forEach((s) => {
        const pages = parseInt(String(s.totalPage || 0), 10);
        if (pages > maxPages) {
          maxPages = pages;
          bestSecondary = s;
        }
      });

      if (bestSecondary) {
        result.totalPage = maxPages;
        const sourceLabel =
          (bestSecondary as BookWithSource)._sourceLabel ||
          GLOBAL_SEARCH_SOURCE_LABELS[bestSecondary.sourceProvider || ""] ||
          bestSecondary.sourceProvider;
        if (sourceLabel) contributingSources.add(sourceLabel);
      }
      return;
    }

    // Generic merge: use first non-falsy value from secondaries if primary is falsy
    if (!result[field]) {
      for (const secondary of secondaries) {
        if (secondary[field]) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (result as any)[field] = secondary[field];
          const sourceLabel =
            (secondary as BookWithSource)._sourceLabel ||
            GLOBAL_SEARCH_SOURCE_LABELS[secondary.sourceProvider || ""] ||
            secondary.sourceProvider;
          if (sourceLabel) contributingSources.add(sourceLabel);
          break;
        }
      }
    }
  });

  return {
    merged: result,
    contributingSources: Array.from(contributingSources),
  };
}
