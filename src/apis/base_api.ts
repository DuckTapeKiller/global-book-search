import { Book } from "@models/book.model";
import { BookSearchPluginSettings } from "@settings/settings";
import { ServiceProvider } from "@src/constants";
import { httpRequest } from "@utils/http";
import { GoogleBooksApi } from "./google_books_api";
import { GoodreadsApi } from "./goodreads_api";
import { CalibreApi } from "./calibre_api";
import { OpenLibraryApi } from "./open_library_api";
import { StoryGraphApi, storyGraphLogin } from "./storygraph_api";
import { HardcoverApi } from "./hardcover_api";
import { LibraryThingApi } from "./librarything_api";

export interface BaseBooksApiImpl {
  getByQuery(query: string, options?: Record<string, string>): Promise<Book[]>;
  getBook?(book: Book): Promise<Book>;
}

export function factoryServiceProvider(
  settings: BookSearchPluginSettings,
  serviceProviderOverride?: string,
): BaseBooksApiImpl {
  // Fix: Cast the resulting string to the ServiceProvider enum
  const service = (serviceProviderOverride ||
    settings.serviceProvider) as ServiceProvider;

  switch (service) {
    case ServiceProvider.google:
      return new GoogleBooksApi(
        settings.localePreference,
        settings.enableCoverImageEdgeCurl,
        settings.apiKey,
      );
    case ServiceProvider.goodreads:
      return new GoodreadsApi();
    case ServiceProvider.calibre:
      return new CalibreApi(
        settings.calibreServerUrl,
        settings.calibreLibraryId,
      );
    case ServiceProvider.openlibrary:
      return new OpenLibraryApi();
    case ServiceProvider.storygraph:
      return new StoryGraphApi(storyGraphLogin(settings));
    case ServiceProvider.hardcover:
      return new HardcoverApi(
        settings.hardcoverApiToken,
        resolveLocale(settings.localePreference),
      );
    case ServiceProvider.librarything:
      return new LibraryThingApi(
        settings.librarythingApiKey,
        resolveLocale(settings.localePreference),
      );
    default:
      throw new Error("Unsupported service provider.");
  }
}

// The reader's language: an explicit preference if set, otherwise Obsidian's
// own UI/moment locale (so a Spanish Obsidian gets Spanish editions by default).
function resolveLocale(preference: string): string {
  if (preference && preference !== "default") return preference;
  try {
    return window.moment.locale() || "en";
  } catch {
    return "en";
  }
}

/**
 * GET a JSON API and return the parsed body. `httpRequest` already retries
 * rate limits, server errors and network failures (Diagnostics → Retry count),
 * so there is no second retry loop here: the old one multiplied the attempts.
 * An error status is thrown with `status`, never returned as if it were data.
 * `providerId` files the request under its source in the service-performance
 * panel (it was always "http", which hid Google Books there).
 */
export async function apiGet<T>(
  url: string,
  params: Record<string, string | number> = {},
  headers?: Record<string, string>,
  providerId = "http",
): Promise<T> {
  const apiURL = new URL(url);
  appendQueryParams(apiURL, params);

  const res = await httpRequest(
    {
      url: apiURL.href,
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
        ...headers,
      },
    },
    {
      providerId,
      purpose: "apiGet",
      responseType: "json",
      cacheTtlMs: 60_000,
    },
  );

  if (res.status >= 400) {
    throw Object.assign(new Error(`HTTP ${res.status} from ${apiURL.host}`), {
      status: res.status,
    });
  }
  return res.json as T;
}

function appendQueryParams(
  url: URL,
  params: Record<string, string | number>,
): void {
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value.toString());
  });
}
