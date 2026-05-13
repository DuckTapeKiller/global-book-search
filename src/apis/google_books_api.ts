import { apiGet, BaseBooksApiImpl } from "@apis/base_api";
import { Book } from "@models/book.model";
import {
  GoogleBooksResponse,
  VolumeInfo,
  Type,
} from "./models/google_books_response";

export class GoogleBooksApi implements BaseBooksApiImpl {
  private static readonly MAX_RESULTS = 40;
  private static readonly PRINT_TYPE = "books";

  constructor(
    private readonly localePreference: string,
    private readonly enableCoverImageEdgeCurl: boolean,
    private readonly apiKey?: string,
  ) {}

  private getLanguageRestriction(local: string): string {
    const locale = local === "default" ? window.moment.locale() : local;
    // Google Books API usually requires 2-letter codes (e.g., 'ar' not 'ar-sa')
    // and ignores regional variants silently.
    return locale.substring(0, 2);
  }

  private buildSearchParams(
    query: string,
    options?: Record<string, string>,
  ): Record<string, string | number> {
    const params: Record<string, string | number> = {
      q: query,
      maxResults: GoogleBooksApi.MAX_RESULTS,
      printType: GoogleBooksApi.PRINT_TYPE,
      langRestrict: this.getLanguageRestriction(
        options?.locale || this.localePreference,
      ),
    };

    if (this.apiKey) {
      params["key"] = this.apiKey;
    }
    return params;
  }

  async getByQuery(
    query: string,
    options?: Record<string, string>,
  ): Promise<Book[]> {
    try {
      const params = this.buildSearchParams(query, options);
      const searchResults = await apiGet<GoogleBooksResponse>(
        "https://www.googleapis.com/books/v1/volumes",
        params,
        this.apiKey ? { "X-goog-api-key": this.apiKey } : undefined,
      );
      if (!searchResults?.totalItems) return [];

      const targetLanguage = this.getLanguageRestriction(
        options?.locale || this.localePreference,
      );
      return searchResults.items
        .filter((item) => {
          // Strict filtering: Only allow books that match the requested 2-letter language code.
          // This fixes the issue where Google returns English books despite langRestrict.
          return item.volumeInfo.language
            ?.toLowerCase()
            .startsWith(targetLanguage.toLowerCase());
        })
        .map(({ volumeInfo }) => this.createBookItem(volumeInfo));
    } catch (error) {
      console.warn(error);
      throw error;
    }
  }

  private extractISBNs(
    industryIdentifiers: VolumeInfo["industryIdentifiers"],
  ): Record<string, string> {
    return (
      industryIdentifiers?.reduce(
        (result, item) => {
          const isbnType = item.type === Type.Isbn10 ? "isbn10" : "isbn13";
          result[isbnType] = item.identifier.trim();
          return result;
        },
        {} as Record<string, string>,
      ) ?? {}
    );
  }

  private extractBasicBookInfo(item: VolumeInfo): Partial<Book> {
    return {
      title: item.title,
      subtitle: item.subtitle,
      author: this.formatList(item.authors),
      authors: item.authors,
      category: this.formatList(item.categories),
      categories: this.formatList(item.categories),
      publisher: item.publisher,
      totalPage: item.pageCount,
      coverUrl: this.setCoverImageEdgeCurl(
        item.imageLinks?.thumbnail ?? "",
        this.enableCoverImageEdgeCurl,
      ),
      coverSmallUrl: this.setCoverImageEdgeCurl(
        item.imageLinks?.smallThumbnail ?? "",
        this.enableCoverImageEdgeCurl,
      ),
      publishDate: item.publishedDate || "",
      description: item.description,
      link: item.canonicalVolumeLink || item.infoLink,
      previewLink: item.previewLink,
    };
  }

  public createBookItem(item: VolumeInfo): Book {
    const book: Book = {
      title: "",
      subtitle: "",
      author: "",
      authors: [],
      category: "",
      categories: "",
      publisher: "",
      publishDate: "",
      totalPage: "",
      coverUrl: "",
      coverSmallUrl: "",
      description: "",
      link: "",
      previewLink: "",
      isbn10: "",
      isbn13: "",
      ...this.extractBasicBookInfo(item),
      ...this.extractISBNs(item.industryIdentifiers),
    };
    return book;
  }

  public formatList(list?: string[]): string {
    return list && list.length > 1
      ? list.map((item) => item.trim()).join(", ")
      : (list?.[0] ?? "");
  }

  private setCoverImageEdgeCurl(url: string, enabled: boolean): string {
    // Edge curl is included in the cover image URL parameters by default,
    // so we need to remove it if it's disabled
    return enabled ? url : url.replace("&edge=curl", "");
  }

  static convertGoogleBookImageURLSize(url: string, zoom: number) {
    return url.replace(/(&zoom)=\d/, `$1=${zoom}`);
  }
}
