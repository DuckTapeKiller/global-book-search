import { httpRequest, ProviderBlockedError } from "@utils/http";
import { Book } from "@models/book.model";
import { BookSearchPluginSettings } from "@settings/settings";
import { GLOBAL_SEARCH_SOURCE_LABELS } from "@src/constants";
import { factoryServiceProvider } from "@apis/base_api";
import { GoogleBooksApi } from "@apis/google_books_api";
import { OpenLibraryApi } from "@apis/open_library_api";
import { GoodreadsApi } from "@apis/goodreads_api";
import { StoryGraphApi, storyGraphLogin } from "@apis/storygraph_api";
import { HardcoverApi } from "@apis/hardcover_api";
import { scoreBookCandidate } from "@utils/edition_score";
import { samePerson } from "@utils/contributors";
import { pickSameEdition, sameTitle } from "@utils/editions";
import { toIsbn10, toIsbn13 } from "@utils/existing_note";
import LANGUAGES from "@utils/languages";
import { getArray, getProp } from "@utils/json";

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

/** How one source answered a global search. */
export type SourceOutcome = "found" | "empty" | "failed";

/** Render a field value as a comparable string without producing "[object Object]". */
function comparableString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

async function timeoutReject<T>(ms: number, providerName: string): Promise<T> {
  return new Promise((_, reject) => {
    window.setTimeout(
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
      httpRequest(
        { url, method: "GET" },
        { providerId: "fable", purpose: "enrich", cacheTtlMs: 300_000 },
      ),
      new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error("Fable timeout")), 6000),
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
      httpRequest(
        { url, method: "GET" },
        { providerId: "loc", purpose: "enrich", cacheTtlMs: 600_000 },
      ),
      new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error("LoC timeout")), 6000),
      ),
    ]);

    const data: unknown = JSON.parse(response.text);
    const results = getArray(getProp(data, "results"));
    if (results.length === 0) return null;

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
    /** Called once per source as soon as it answers, fails or times out. */
    onSourceDone?: (
      providerId: string,
      outcome: SourceOutcome,
      reason?: string,
    ) => void;
  },
  onProgress?: (message: string) => void,
): Promise<BookWithSource[]> {
  const providers = [...PROVIDER_ORDER];
  if (options?.includeCalibre && settings.calibreServerUrl) {
    providers.push("calibre");
  }
  // Hardcover self-skips (returns nothing) until an API token is configured,
  // but it stays listed so it appears alongside the other sources.
  providers.push("hardcover");
  providers.push("librarything");

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
      options?.onSourceDone?.(
        providerId,
        providerResults.length > 0 ? "found" : "empty",
      );
      return providerResults.map((book) => ({
        ...book,
        _sourceIds: [providerId],
        _sourceLabels: [GLOBAL_SEARCH_SOURCE_LABELS[providerId] || providerId],
      }));
    } catch (error) {
      if (error instanceof ProviderBlockedError) {
        onProgress?.(
          `${GLOBAL_SEARCH_SOURCE_LABELS[providerId]} — ${error.shortReason}`,
        );
        options?.onSourceDone?.(providerId, "failed", error.shortReason);
        return [] as BookWithSource[];
      }
      console.warn(`Global Search: Provider ${providerId} failed`, error);
      onProgress?.(`${GLOBAL_SEARCH_SOURCE_LABELS[providerId]} — no results`);
      options?.onSourceDone?.(providerId, "failed");
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
            score: scoreBookCandidate(book),
          });
        }
      }
    } else {
      const newWork: BookWithSource = { ...book, _editions: [] };
      if (book.isbn13 || book.isbn10) {
        newWork._editions?.push({
          ...book,
          _providerId: book._sourceIds[0],
          score: scoreBookCandidate(book),
        });
      }
      workMap.set(key, newWork);
    }
  });

  const finalResults = Array.from(workMap.values());

  // Mark "In vault" status
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

  // ── FALLBACK: no ISBN ─────────────────────────────────────────────────────
  // An edition (a publisher, a page count, a binding) borrows only the ISBN of
  // its twin in another catalogue, and only when exactly one record matches.
  // A book that is not an edition yet takes the edition a source knows best.
  if (!isbn) {
    const isEdition =
      [book.publisher, book.totalPage, book.format].filter(
        (value) => String(value ?? "").trim() !== "",
      ).length >= 2;
    if (isEdition) {
      onProgress?.("No ISBN — looking for the same edition elsewhere...");
      const twin = await findSameEdition(book, settings);
      if (twin) {
        isbn = toIsbn13(twin.isbn13 || twin.isbn10 || "");
        book.isbn13 = isbn;
        book.isbn10 = twin.isbn10 || toIsbn10(isbn) || book.isbn10;
        const label =
          GLOBAL_SEARCH_SOURCE_LABELS[twin.sourceProvider || ""] ||
          "another catalogue";
        onProgress?.(`ISBN found on ${label} ✓`);
      }
    } else {
      const discoveryOrder = [
        "goodreads",
        "openlibrary",
        "google",
        "hardcover",
        "librarything",
      ]
        .filter((id) => id !== primarySourceId)
        .filter((id) => id !== "hardcover" || settings.hardcoverApiToken)
        .filter((id) => id !== "librarything" || settings.librarythingApiKey);

      for (const id of discoveryOrder) {
        const label = GLOBAL_SEARCH_SOURCE_LABELS[id] || id;
        onProgress?.(`No ISBN — searching ${label} by title...`);
        try {
          const api = factoryServiceProvider(settings, id);
          const results = await Promise.race([
            api.getByQuery(`${book.title} ${book.author}`),
            timeoutReject<Book[]>(8000, `${id}-title-fallback`),
          ]);
          // The first result with the same title, never another book.
          const match = results.find((r) => sameTitle(r.title, book.title));
          if (!match) continue;
          const full = api.getBook
            ? await Promise.race([
                api.getBook(match),
                timeoutReject<Book>(12000, `${id}-title-fallback-book`),
              ])
            : match;
          const foundIsbn = full.isbn13 || full.isbn10;
          if (foundIsbn && sameTitle(full.title, book.title)) {
            isbn = foundIsbn;
            book.isbn13 = full.isbn13 || book.isbn13;
            book.isbn10 = full.isbn10 || book.isbn10;
            // Reuse Goodreads' data downstream; others get re-queried by ISBN.
            if (id === "goodreads") goodreadsData = full;
            onProgress?.(`ISBN found on ${label} ✓`);
            break;
          }
        } catch (err) {
          console.warn(`ISBN discovery via ${id} failed`, err);
        }
      }
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

  const secondaryProviderIds = ["google", "storygraph", "openlibrary"];
  // Hardcover + LibraryThing join the ISBN chain when configured.
  if (settings.hardcoverApiToken) secondaryProviderIds.push("hardcover");
  if (settings.librarythingApiKey) secondaryProviderIds.push("librarything");
  // Every source but the one the book came from. The others that found the
  // book in the search are asked too: the search result kept only one
  // source's data, so leaving them out lost StoryGraph's moods and
  // Hardcover's details whenever they had found the book as well.
  const activeSecondaryProviderIds = secondaryProviderIds.filter(
    (id) => id !== primarySourceId,
  );

  const secondaryResultsWithIds = await Promise.allSettled(
    activeSecondaryProviderIds.map(
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
            const api = new StoryGraphApi(storyGraphLogin(settings));
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
              timeoutReject<Book[]>(12000, id),
            ]);
            const found = results[0];
            // Some Open Library records carry another edition's ISBN (an
            // Estonian translation filed under the Tor Three-Body Problem):
            // an answer with another title is not this edition.
            if (!found || !sameTitle(found.title, book.title)) return null;
            // Its authors only when they are the book's (it names Miguel de
            // Unamuno for Grossman's Don Quixote, "Fiódor Dostoievski" for
            // Penguin's Crime and Punishment).
            const authors = book.authors?.length ? book.authors : [book.author];
            const ownAuthors = (found.authors || []).some((name) =>
              authors.some((author) => samePerson(name, author)),
            );
            return {
              book: ownAuthors ? found : { ...found, author: "", authors: [] },
              providerId: id,
            };
          }

          if (id === "hardcover") {
            // Hardcover answers an ISBN with that edition, fully read; any
            // other edition would bring another edition's title, translator
            // and publisher into the merge.
            const api = factoryServiceProvider(settings, id);
            const results = await Promise.race([
              api.getByQuery(isbn),
              timeoutReject<Book[]>(8000, id),
            ]);
            const found = results[0];
            const foundIsbn = found
              ? toIsbn13(found.isbn13 || found.isbn10 || "")
              : "";
            if (!foundIsbn || foundIsbn !== toIsbn13(isbn)) return null;
            return { book: found, providerId: id };
          }

          if (id === "librarything") {
            // Use the factory so locale + token resolution are applied.
            // LibraryThing clusters editions by work, so the localised
            // edition's ISBN may differ from the query ISBN — don't drop on a
            // mismatch.
            const api = factoryServiceProvider(settings, id);
            const results = await Promise.race([
              api.getByQuery(isbn),
              timeoutReject<Book[]>(8000, id),
            ]);
            if (results.length === 0) return null;
            const full = api.getBook
              ? await Promise.race([
                  api.getBook(results[0]),
                  timeoutReject<Book>(12000, `${id}-getBook`),
                ])
              : results[0];
            return { book: full, providerId: id };
          }

          return null;
        } catch (err) {
          if (!(err instanceof ProviderBlockedError)) {
            console.warn(`Enrichment: secondary provider ${id} failed`, err);
          }
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
  let {
    merged: mergedBook,
    contributingSources,
    conflicts,
  } = mergeWithConflicts(
    book,
    goodreadsData,
    secondaries,
    settings,
    primarySourceId,
  );

  // ── Step 6: Fable passive enrichment (with cover upgrade) ──────────────────
  const needsDescription = !mergedBook.description;
  const needsCover = !mergedBook.coverUrl;
  const prefersFable =
    settings.fieldSourcePreferences?.description?.[0] === "fable" ||
    settings.fieldSourcePreferences?.coverUrl?.[0] === "fable";

  const passiveSecondaries: BookWithSource[] = [];

  if ((prefersFable || needsDescription || needsCover) && mergedBook.isbn13) {
    onProgress?.("Checking Fable for missing fields...");
    const fableData = await fetchFableData(mergedBook);
    if (fableData) {
      passiveSecondaries.push({
        title: mergedBook.title,
        author: mergedBook.author,
        authors: mergedBook.authors || [],
        coverUrl: fableData.coverUrl || "",
        link: mergedBook.link,
        description: fableData.description || "",
        _sourceIds: ["fable"],
        _sourceLabels: ["Fable"],
      });
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

  const prefersLoc =
    settings.fieldSourcePreferences?.publisher?.[0] === "loc" ||
    settings.fieldSourcePreferences?.publishDate?.[0] === "loc" ||
    settings.fieldSourcePreferences?.totalPage?.[0] === "loc" ||
    settings.fieldSourcePreferences?.categories?.[0] === "loc";

  if ((prefersLoc || needsLocData) && mergedBook.isbn13) {
    onProgress?.("Checking Library of Congress for missing fields...");
    const locData = await fetchLocData(mergedBook);
    if (locData) {
      passiveSecondaries.push({
        title: mergedBook.title,
        author: mergedBook.author,
        authors: mergedBook.authors || [],
        coverUrl: mergedBook.coverUrl || "",
        link: mergedBook.link,
        publisher: locData.publisher,
        publishDate: locData.publishDate,
        totalPage: locData.totalPage,
        categories: locData.categories,
        isbn10: locData.isbn10,
        isbn13: locData.isbn13,
        _sourceIds: ["loc"],
        _sourceLabels: ["Library of Congress"],
      });
    }
  }

  if (passiveSecondaries.length > 0) {
    const passiveMerge = mergeWithConflicts(
      mergedBook,
      null,
      passiveSecondaries,
      settings,
      primarySourceId,
    );
    mergedBook = passiveMerge.merged;
    contributingSources = [
      ...new Set([...contributingSources, ...passiveMerge.contributingSources]),
    ];
    conflicts = [...conflicts, ...passiveMerge.conflicts];
  }

  onProgress?.("Done.");
  return {
    book: mergedBook,
    sources: [...new Set([primarySourceLabel, ...contributingSources])],
    conflicts,
  };
}

/** A language's name as a two-letter code ("English" → "en"), or "". */
function languageCode(name: string): string {
  const wanted = (name || "").trim().toLowerCase();
  if (!wanted) return "";
  const match = Object.entries(LANGUAGES).find(
    ([code, label]) => code.length === 2 && label.toLowerCase() === wanted,
  );
  return match ? match[0] : "";
}

/**
 * The record in another catalogue that is the same edition as a book without
 * an ISBN: Hardcover's and Open Library's editions of the book, and Google
 * Books' when there is an API key (its shared quota is used up otherwise).
 * Null unless exactly one ISBN matches publisher, pages, binding and language.
 */
async function findSameEdition(
  book: Book,
  settings: BookSearchPluginSettings,
): Promise<Book | null> {
  const lookups: Array<Promise<Book[]>> = [
    Promise.race([
      new OpenLibraryApi().editionsLike(book),
      timeoutReject<Book[]>(10000, "openlibrary-editions"),
    ]),
  ];
  if (settings.hardcoverApiToken) {
    lookups.push(
      Promise.race([
        new HardcoverApi(settings.hardcoverApiToken).editionsLike(book),
        timeoutReject<Book[]>(10000, "hardcover-editions"),
      ]),
    );
  }
  if (settings.apiKey) {
    const author = (book.author || "").split(/\s+/).pop() || "";
    lookups.push(
      Promise.race([
        new GoogleBooksApi(
          languageCode(book.language || "") || settings.localePreference,
          false,
          settings.apiKey,
        ).getByQuery(`intitle:${book.title} inauthor:${author}`),
        timeoutReject<Book[]>(8000, "google-editions"),
      ]).then((books) =>
        books.map((found) => ({ ...found, sourceProvider: "google" })),
      ),
    );
  }
  const settled = await Promise.allSettled(lookups);
  const candidates = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  return pickSameEdition(book, candidates);
}

export async function enrichFromIsbn(
  isbn: string,
  settings: BookSearchPluginSettings,
  onProgress?: (message: string) => void,
): Promise<EnrichmentResult> {
  const normalized = (isbn || "").replace(/[^0-9X]/gi, "").toUpperCase();
  if (!normalized || (normalized.length !== 10 && normalized.length !== 13)) {
    return {
      book: {
        title: normalized || "Unknown ISBN",
        author: "",
        authors: [],
        coverUrl: "",
        link: "",
        isbn10: normalized.length === 10 ? normalized : "",
        isbn13: normalized.length === 13 ? normalized : "",
      },
      sources: [],
      conflicts: [],
    };
  }

  const tag = (book: Book, providerId: string): BookWithSource => ({
    ...book,
    // Ensure the ISBN is carried forward even if the search result doesn't include it.
    isbn10: book.isbn10 || (normalized.length === 10 ? normalized : ""),
    isbn13: book.isbn13 || (normalized.length === 13 ? normalized : ""),
    _sourceIds: [providerId],
    _sourceLabels: [GLOBAL_SEARCH_SOURCE_LABELS[providerId] || providerId],
  });

  onProgress?.(`Searching providers for ISBN ${normalized}...`);

  const providerIds = ["google", "openlibrary", "goodreads", "storygraph"];
  const settled = await Promise.allSettled(
    providerIds.map(async (id) => {
      try {
        if (id === "google") {
          const api = new GoogleBooksApi(
            settings.localePreference,
            settings.enableCoverImageEdgeCurl,
            settings.apiKey,
          );
          const results = await Promise.race([
            api.getByQuery(`isbn:${normalized}`),
            timeoutReject<Book[]>(8000, id),
          ]);
          return results[0] ? tag(results[0], id) : null;
        }

        if (id === "openlibrary") {
          const api = new OpenLibraryApi();
          const results = await Promise.race([
            api.getByQuery(`isbn:${normalized}`),
            timeoutReject<Book[]>(8000, id),
          ]);
          return results[0] ? tag(results[0], id) : null;
        }

        if (id === "goodreads") {
          const api = new GoodreadsApi();
          const results = await Promise.race([
            api.getByQuery(normalized),
            timeoutReject<Book[]>(8000, id),
          ]);
          return results[0] ? tag(results[0], id) : null;
        }

        if (id === "storygraph") {
          const api = new StoryGraphApi(storyGraphLogin(settings));
          const results = await Promise.race([
            api.getByQuery(normalized),
            timeoutReject<Book[]>(10000, id),
          ]);
          return results[0] ? tag(results[0], id) : null;
        }

        return null;
      } catch (err) {
        if (!(err instanceof ProviderBlockedError)) {
          console.warn(`enrichFromIsbn: provider ${id} failed`, err);
        }
        return null;
      }
    }),
  );

  const candidates = settled
    .filter(
      (r): r is PromiseFulfilledResult<BookWithSource | null> =>
        r.status === "fulfilled",
    )
    .map((r) => r.value)
    .filter((v): v is BookWithSource => v !== null);

  if (candidates.length === 0) {
    onProgress?.("No providers returned results — creating a minimal note.");
    return {
      book: {
        title: normalized,
        author: "",
        authors: [],
        coverUrl: "",
        link: "",
        isbn10: normalized.length === 10 ? normalized : "",
        isbn13: normalized.length === 13 ? normalized : "",
      },
      sources: [],
      conflicts: [],
    };
  }

  // Prefer the most complete candidate as the primary source.
  const weighted = candidates
    .map((c) => {
      const providerBoost =
        c._sourceIds[0] === "goodreads"
          ? 8
          : c._sourceIds[0] === "storygraph"
            ? 6
            : c._sourceIds[0] === "google"
              ? 5
              : 3;
      return { candidate: c, score: scoreBookCandidate(c) + providerBoost };
    })
    .sort((a, b) => b.score - a.score);

  const primary = weighted[0].candidate;
  onProgress?.(`Primary source: ${primary._sourceLabels[0]} ✓`);

  return enrichBookByISBN(primary, settings, onProgress);
}

export function mergeWithConflicts(
  primary: Book,
  goodreads: Book | null,
  secondaries: BookWithSource[],
  settings: BookSearchPluginSettings,
  primarySourceId: string,
): { merged: Book; contributingSources: string[]; conflicts: FieldConflict[] } {
  const contributingSources = new Set<string>();
  const result: Book = { ...primary };
  const conflicts: FieldConflict[] = [];

  const sourcesById: Record<string, { book: Book; label: string }> = {};
  sourcesById["primary"] = {
    book: primary,
    // A source's getBook can return a plain Book without the search labels,
    // so fall back to the source's own name before a generic one.
    label:
      (primary as BookWithSource)._sourceLabels?.[0] ||
      GLOBAL_SEARCH_SOURCE_LABELS[primarySourceId] ||
      "Primary Source",
  };
  if (primarySourceId) {
    sourcesById[primarySourceId] = sourcesById["primary"];
  }

  if (goodreads) {
    sourcesById["goodreads"] = { book: goodreads, label: "Goodreads" };
  }

  secondaries.forEach((sec) => {
    const id = sec._sourceIds?.[0] || sec._sourceLabels?.[0] || "secondary";
    sourcesById[id] = {
      book: sec,
      label:
        sec._sourceLabels?.[0] ||
        GLOBAL_SEARCH_SOURCE_LABELS[id] ||
        "Secondary Source",
    };
  });

  const isNonEmpty = (value: unknown): boolean => {
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  };

  const pickPreferredValue = (
    field: keyof Book,
  ): { value: unknown; sourceLabel?: string; book: Book } | null => {
    const order = settings.fieldSourcePreferences?.[field as string] || [];
    for (const pref of order) {
      const source = sourcesById[pref];
      const val = source?.book?.[field];
      if (isNonEmpty(val)) {
        return { value: val, sourceLabel: source.label, book: source.book };
      }
    }

    // Fallback: first non-empty value from any source, prioritizing primary then Goodreads.
    const fallbackIds = [
      "primary",
      "goodreads",
      "storygraph",
      "google",
      "openlibrary",
    ];
    for (const id of fallbackIds) {
      const source = sourcesById[id];
      const val = source?.book?.[field];
      if (isNonEmpty(val)) {
        return { value: val, sourceLabel: source.label, book: source.book };
      }
    }

    for (const source of Object.values(sourcesById)) {
      const val = source.book?.[field];
      if (isNonEmpty(val)) {
        return { value: val, sourceLabel: source.label, book: source.book };
      }
    }

    return null;
  };

  const fieldsToTrack: { name: keyof Book; label: string }[] = [
    { name: "title", label: "Title" },
    { name: "author", label: "Author" },
    { name: "publisher", label: "Publisher" },
    { name: "publishDate", label: "Publish date" },
    { name: "totalPage", label: "Page count" },
    { name: "categories", label: "Categories" },
  ];

  fieldsToTrack.forEach((field) => {
    const allValues: { value: unknown; source: string }[] = [];

    // Add primary source value
    if (primary[field.name]) {
      allValues.push({
        value: primary[field.name],
        source: sourcesById["primary"].label,
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

    // Dates given at different precision ("1994" and "1994/09/28") agree.
    if (
      field.name === "publishDate" &&
      datesAgree(allValues.map((v) => comparableString(v.value)))
    ) {
      return;
    }

    if (allValues.length > 1) {
      // Check for conflict
      const distinctValues = [
        ...new Set(
          allValues.map((v) => comparableString(v.value).toLowerCase().trim()),
        ),
      ];

      if (distinctValues.length > 1) {
        const preferred = pickPreferredValue(field.name);
        const bestValue =
          preferred?.value ?? getQuorumValue(allValues.map((v) => v.value));
        conflicts.push({
          fieldName: field.name,
          label: field.label,
          values: allValues.map((v) => ({
            ...v,
            isQuorum:
              comparableString(v.value).toLowerCase().trim() ===
              comparableString(bestValue).toLowerCase().trim(),
          })),
          currentBestValue: bestValue,
        });
      }
    }
  });

  // Merge using preferences: pick a winner per field.
  const mergeFields: Array<keyof Book> = [
    "title",
    "subtitle",
    "author",
    "authors",
    "publisher",
    "publishDate",
    "totalPage",
    "categories",
    "category",
    "description",
    "coverUrl",
    "coverSmallUrl",
    "isbn10",
    "isbn13",
    "originalTitle",
    "translator",
    "narrator",
    "asin",
    "format",
    "language",
    "firstPublishDate",
    "moods",
    "pace",
    // Characters and places come from Goodreads and LibraryThing; the rest of
    // LibraryThing's Common Knowledge only from LibraryThing.
    "characters",
    "places",
    "events",
    "firstWords",
    "lastWords",
    "quotes",
    "dedication",
    "blurbers",
    "relatedMovies",
    "originalLanguage",
  ];

  for (const field of mergeFields) {
    const preferred = pickPreferredValue(field);
    if (!preferred) continue;
    (result as unknown as Record<string, unknown>)[field as string] =
      preferred.value;
    if (preferred.sourceLabel) contributingSources.add(preferred.sourceLabel);
  }

  // A person a source credits only as translator or narrator of this edition
  // is not one of its authors, even when another source's librarians listed
  // them as one (Goodreads credits Alicia Dellepiane, the Spanish translator
  // of Harry Potter, as an author; Hardcover and StoryGraph as translator).
  const notAuthors = creditedOnlyAsTranslatorOrNarrator(
    Object.values(sourcesById).map((source) => source.book),
  );
  const authors = (result.authors || []).filter(
    (name) => !notAuthors.some((other) => samePerson(name, other)),
  );
  if (authors.length && authors.length !== (result.authors || []).length) {
    result.authors = authors;
    if (!authors.some((name) => samePerson(name, result.author))) {
      result.author = authors[0];
    }
  }

  // A series and its number only make sense together, so both come from the
  // same source rather than being picked field by field.
  const series = pickPreferredValue("series");
  if (series) {
    result.series = series.book.series;
    result.seriesNumber = series.book.seriesNumber;
    if (series.sourceLabel) contributingSources.add(series.sourceLabel);
  }

  return {
    merged: result,
    contributingSources: Array.from(contributingSources),
    conflicts,
  };
}

/**
 * The translators and narrators that some source credits as such and not as
 * an author. Someone a source credits as both (an author who translated
 * their own book) is not among them.
 */
function creditedOnlyAsTranslatorOrNarrator(books: Book[]): string[] {
  const names: string[] = [];
  for (const book of books) {
    const authors = book.authors?.length ? book.authors : [book.author];
    const others = [book.translator, book.narrator]
      .flatMap((value) => (value || "").split(/\s*[,;]\s*/))
      .filter(Boolean);
    for (const name of others) {
      if (!authors.some((author) => samePerson(author, name))) names.push(name);
    }
  }
  return names;
}

/**
 * Whether dates from several sources say the same thing at the precision
 * each gives: "1994", "1994/09" and "1994-09-28" agree; "1994/01" and
 * "1994/09/28" do not. Anything that is not such a date never agrees.
 */
export function datesAgree(values: string[]): boolean {
  const dates = values.map((v) => v.trim().replace(/-/g, "/")).filter(Boolean);
  if (!dates.every((d) => /^\d{4}(\/\d{2}(\/\d{2})?)?$/.test(d))) return false;
  const longest = dates.reduce((a, b) => (b.length > a.length ? b : a), "");
  return dates.every((d) => d === longest || longest.startsWith(`${d}/`));
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
