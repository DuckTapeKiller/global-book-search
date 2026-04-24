import { App, Modal, Setting, setIcon } from "obsidian";
import { Book } from "@models/book.model";

export class CalibreMultiSelectModal extends Modal {
  private selectedBooks: Set<Book> = new Set();
  private countEl: HTMLElement | null = null;
  private importBtn: HTMLButtonElement | null = null;

  constructor(
    app: App,
    private readonly books: Book[],
    private readonly showCoverImages: boolean,
    private readonly onConfirm: (error: Error | null, books?: Book[]) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("calibre-multi-select-modal");

    // Header
    contentEl.createEl("h2", { text: "Select Books to Import" });

    // Action bar
    const actionBar = contentEl.createDiv({
      cls: "calibre-multi-select-actions",
    });

    const selectAllBtn = actionBar.createEl("button", { text: "Select All" });
    selectAllBtn.addEventListener("click", () => this.selectAll());

    const deselectAllBtn = actionBar.createEl("button", {
      text: "Deselect All",
    });
    deselectAllBtn.addEventListener("click", () => this.deselectAll());

    this.countEl = actionBar.createEl("span", {
      cls: "calibre-multi-select-count",
      text: "0 selected",
    });

    // Book list
    const listContainer = contentEl.createDiv({
      cls: "calibre-multi-select-list",
    });

    this.books.forEach((book) => {
      const item = listContainer.createDiv({
        cls: "calibre-multi-select-item",
      });

      // Checkbox
      const checkbox = item.createEl("input", { type: "checkbox" });
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          this.selectedBooks.add(book);
          item.addClass("is-selected");
        } else {
          this.selectedBooks.delete(book);
          item.removeClass("is-selected");
        }
        this.updateCount();
      });

      // Cover image
      const coverUrl =
        book.coverLargeUrl ||
        book.coverMediumUrl ||
        book.coverSmallUrl ||
        book.coverUrl;
      if (this.showCoverImages && coverUrl) {
        item.createEl("img", {
          cls: "calibre-multi-select-cover",
          attr: {
            src: coverUrl,
            alt: `Cover for ${book.title}`,
          },
        });
      }

      // Text info
      const textContainer = item.createDiv({
        cls: "calibre-multi-select-text",
      });
      textContainer.createEl("div", {
        cls: "calibre-multi-select-title",
        text: book.title,
      });

      const subtitle: string[] = [];
      if (book.author) subtitle.push(book.author);
      if (book.publisher) subtitle.push(book.publisher);
      if (book.publishDate) subtitle.push(`(${book.publishDate})`);

      textContainer.createEl("small", {
        cls: "calibre-multi-select-subtitle",
        text: subtitle.join(", "),
      });
    });

    // Footer buttons
    const footer = contentEl.createDiv({ cls: "calibre-multi-select-footer" });

    const cancelBtn = footer.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });

    this.importBtn = footer.createEl("button", {
      text: "Import 0 Books",
      cls: "mod-cta",
    });
    this.importBtn.disabled = true;
    this.importBtn.addEventListener("click", () => {
      if (this.selectedBooks.size > 0) {
        this.onConfirm(null, Array.from(this.selectedBooks));
        this.close();
      }
    });
  }

  private selectAll(): void {
    this.selectedBooks = new Set(this.books);

    const checkboxes = this.contentEl.querySelectorAll<HTMLInputElement>(
      ".calibre-multi-select-item input[type='checkbox']",
    );
    checkboxes.forEach((cb) => {
      cb.checked = true;
      cb.closest(".calibre-multi-select-item")?.addClass("is-selected");
    });

    this.updateCount();
  }

  private deselectAll(): void {
    this.selectedBooks.clear();

    const checkboxes = this.contentEl.querySelectorAll<HTMLInputElement>(
      ".calibre-multi-select-item input[type='checkbox']",
    );
    checkboxes.forEach((cb) => {
      cb.checked = false;
      cb.closest(".calibre-multi-select-item")?.removeClass("is-selected");
    });

    this.updateCount();
  }

  private updateCount(): void {
    const count = this.selectedBooks.size;

    if (this.countEl) {
      this.countEl.textContent = `${count} selected`;
    }

    if (this.importBtn) {
      this.importBtn.textContent =
        count === 1 ? "Import 1 Book" : `Import ${count} Books`;
      this.importBtn.disabled = count === 0;
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();

    // If no selection was confirmed, treat as cancellation
    if (this.selectedBooks.size === 0) {
      this.onConfirm(new Error("Cancelled request"));
    }
  }
}
