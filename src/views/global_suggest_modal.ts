import { App, SuggestModal, Platform } from "obsidian";
import { BookWithSource } from "@apis/global_search";

export class GlobalSuggestModal extends SuggestModal<BookWithSource> {
  private isSelected = false;

  constructor(
    app: App,
    private readonly showCoverImages: boolean,
    private readonly books: BookWithSource[],
    private onChoose: (error: Error | null, result?: BookWithSource) => void,
  ) {
    super(app);
    this.setPlaceholder("Filter results...");
  }

  onOpen() {
    super.onOpen();
  }

  getSuggestions(query: string): BookWithSource[] {
    const lowerQuery = query.toLowerCase();
    return this.books.filter(
      (book) =>
        book.title.toLowerCase().includes(lowerQuery) ||
        book.author.toLowerCase().includes(lowerQuery) ||
        book.publisher?.toLowerCase().includes(lowerQuery),
    );
  }

  renderSuggestion(book: BookWithSource, el: HTMLElement) {
    el.addClass("book-suggestion-item");

    if (this.showCoverImages && book.coverUrl) {
      const img = el.createEl("img", {
        cls: "book-cover-image",
        attr: { src: book.coverUrl, loading: "lazy" },
      });
      img.onerror = () => img.remove();
    }

    const textInfo = el.createDiv({ cls: "book-text-info" });
    textInfo.createDiv({ text: book.title, cls: "book-title" });

    const meta = [];
    if (book.author) meta.push(book.author);
    if (book.publisher) meta.push(book.publisher);
    if (book.publishDate) meta.push(book.publishDate);
    if (book.totalPage) meta.push(`${book.totalPage}p`);

    textInfo.createEl("small", {
      text: meta.join(" · "),
      cls: "book-meta-info",
    });

    const sourceContainer = textInfo.createDiv({ cls: "book-source-badges" });

    if (book._isInVault) {
      sourceContainer.createSpan({
        cls: "book-search-plugin__badge vault-badge",
        text: "In Vault",
      });
    }

    if (book._editions && book._editions.length > 1) {
      sourceContainer.createSpan({
        cls: "book-search-plugin__badge editions-badge",
        text: `${book._editions.length} Editions`,
      });
    }

    book._sourceIds.forEach((id, index) => {
      const label = book._sourceLabels[index] || id;
      sourceContainer.createEl("span", {
        text: label,
        cls: `book-source-badge book-source-badge--${id}`,
      });
    });
  }

  onChooseSuggestion(book: BookWithSource) {
    this.isSelected = true;
    this.onChoose(null, book);
  }

  onClose() {
    if (Platform.isMobile && !this.isSelected) {
      this.onChoose(new Error("Cancelled request"));
    }
  }
}
