import { Book } from "@models/book.model";
import { BookSearchPluginSettings } from "@settings/settings";
import { ServiceProvider } from "@src/constants";
import { httpRequest } from "@utils/http";
import { GoogleBooksApi } from "./google_books_api";
import { GoodreadsApi } from "./goodreads_api";
import { CalibreApi } from "./calibre_api";
import { OpenLibraryApi } from "./open_library_api";
import { StoryGraphApi } from "./storygraph_api";

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
      return new StoryGraphApi();
    default:
      throw new Error("Unsupported service provider.");
  }
}

const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function apiGet<T>(
  url: string,
  params: Record<string, string | number> = {},
  headers?: Record<string, string>,
): Promise<T> {
  const apiURL = new URL(url);
  appendQueryParams(apiURL, params);

  let lastError: unknown;

  for (let i = 0; i <= MAX_RETRIES; i++) {
    try {
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
          providerId: "http",
          purpose: "apiGet",
          responseType: "json",
          cacheTtlMs: 60_000,
        },
      );

      return res.json as T;
    } catch (error: unknown) {
      lastError = error;
      const err = error as { status?: number; message?: string };
      const isRetryable =
        !err.status || err.status === 429 || err.status >= 500;
      if (isRetryable && i < MAX_RETRIES) {
        await delay(RETRY_DELAY * (i + 1));
        continue;
      }
      break;
    }
  }

  throw lastError;
}

function appendQueryParams(
  url: URL,
  params: Record<string, string | number>,
): void {
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value.toString());
  });
}
