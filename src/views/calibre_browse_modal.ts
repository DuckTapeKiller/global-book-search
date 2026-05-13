import { App, Modal, Setting, setIcon, Notice } from "obsidian";
import { Book } from "@models/book.model";
import { CalibreApi } from "@apis/calibre_api";

type BrowseMode = "tags" | "series" | "authors";

interface CalibreLibraryInfo {
  tags: string[];
  series: Array<{ name: string; count: number }>;
  authors: string[];
}

export class CalibreBrowseModal extends Modal {
  private currentMode: BrowseMode = "tags";
  private libraryInfo: CalibreLibraryInfo | null = null;
  private selectedFilter: string | null = null;
  private books: Book[] = [];
  private selectedBooks: Set<Book> = new Set();
  private isLoading = false;

  private contentArea: HTMLElement | null = null;
  private importBtn: HTMLButtonElement | null = null;
  private countEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly calibreApi: CalibreApi,
    private readonly showCoverImages: boolean,
    private readonly onConfirm: (error: Error | null, books?: Book[]) => void,
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl, modalEl } = this;
    modalEl.addClass("calibre-browse-modal");

    // Header
    contentEl.createEl("h2", { text: "Browse Calibre Library" });

    // Tab bar
    const tabBar = contentEl.createDiv({ cls: "calibre-browse-tabs" });
    this.createTab(tabBar, "Tags", "tags", "tag");
    this.createTab(tabBar, "Series", "series", "library");
    this.createTab(tabBar, "Authors", "authors", "user");

    // Content area
    this.contentArea = contentEl.createDiv({ cls: "calibre-browse-content" });

    // Footer
    const footer = contentEl.createDiv({ cls: "calibre-browse-footer" });
    this.countEl = footer.createEl("span", {
      cls: "calibre-browse-count",
      text: "0 selected",
    });

    const cancelBtn = footer.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());

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

    // Load library info
    await this.loadLibraryInfo();
  }

  private createTab(
    container: HTMLElement,
    label: string,
    mode: BrowseMode,
    icon: string,
  ): void {
    const tab = container.createEl("button", {
      cls: `calibre-browse-tab ${this.currentMode === mode ? "is-active" : ""}`,
    });
    setIcon(tab, icon);
    tab.createSpan({ text: label });

    tab.addEventListener("click", async () => {
      this.currentMode = mode;
      this.selectedFilter = null;
      this.books = [];
      this.selectedBooks.clear();
      this.updateCount();

      // Update active tab
      container.querySelectorAll(".calibre-browse-tab").forEach((t) => {
        t.removeClass("is-active");
      });
      tab.addClass("is-active");

      await this.renderContent();
    });
  }

  private async loadLibraryInfo(): Promise<void> {
    if (!this.contentArea) return;

    this.contentArea.empty();
    this.contentArea.createEl("p", { text: "Loading library info..." });

    try {
      this.libraryInfo = await this.calibreApi.getLibraryInfo();
      await this.renderContent();
    } catch (error) {
      this.contentArea.empty();
      this.contentArea.createEl("p", {
        cls: "calibre-browse-error",
        text: `Failed to load library: ${error.message}`,
      });
    }
  }

  private async renderContent(): Promise<void> {
    if (!this.contentArea || !this.libraryInfo) return;

    this.contentArea.empty();

    if (this.selectedFilter) {
      // Show books for selected filter
      await this.renderBooks();
    } else {
      // Show filter list
      this.renderFilterList();
    }
  }

  private renderFilterList(): void {
    if (!this.contentArea || !this.libraryInfo) return;

    const list = this.contentArea.createDiv({ cls: "calibre-browse-list" });

    let items: Array<{ name: string; count?: number }> = [];

    switch (this.currentMode) {
      case "tags":
        items = this.libraryInfo.tags.map((t) => ({ name: t }));
        break;
      case "series":
        items = this.libraryInfo.series;
        break;
      case "authors":
        items = this.libraryInfo.authors.map((a) => ({ name: a }));
        break;
    }

    if (items.length === 0) {
      list.createEl("p", { text: `No ${this.currentMode} found in library.` });
      return;
    }

    items.forEach((item) => {
      const row = list.createDiv({ cls: "calibre-browse-filter-item" });
      row.createSpan({ text: item.name });
      if (item.count !== undefined) {
        row.createSpan({
          cls: "calibre-browse-filter-count",
          text: `(${item.count})`,
        });
      }

      row.addEventListener("click", async () => {
        this.selectedFilter = item.name;
        await this.renderContent();
      });
    });
  }

  private async renderBooks(): Promise<void> {
    if (!this.contentArea || !this.selectedFilter) return;

    // Back button
    const backBtn = this.contentArea.createEl("button", {
      cls: "calibre-browse-back",
      text: `← Back to ${this.currentMode}`,
    });
    backBtn.addEventListener("click", async () => {
      this.selectedFilter = null;
      this.books = [];
      await this.renderContent();
    });

    this.contentArea.createEl("h3", { text: this.selectedFilter });

    // Loading state
    const loadingEl = this.contentArea.createEl("p", {
      text: "Loading books...",
    });

    try {
      this.books = await this.calibreApi.getBooksByFilter(
        this.currentMode,
        this.selectedFilter,
      );

      loadingEl.remove();

      if (this.books.length === 0) {
        this.contentArea.createEl("p", { text: "No books found." });
        return;
      }

      // Select all / Deselect all
      const actionBar = this.contentArea.createDiv({
        cls: "calibre-browse-actions",
      });

      const selectAllBtn = actionBar.createEl("button", { text: "Select All" });
      selectAllBtn.addEventListener("click", () => this.selectAll());

      const deselectAllBtn = actionBar.createEl("button", {
        text: "Deselect All",
      });
      deselectAllBtn.addEventListener("click", () => this.deselectAll());

      // Book list
      const list = this.contentArea.createDiv({
        cls: "calibre-browse-book-list",
      });

      this.books.forEach((book) => {
        const item = list.createDiv({ cls: "calibre-browse-book-item" });

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

        const coverUrl = book.coverSmallUrl || book.coverUrl;
        if (this.showCoverImages && coverUrl) {
          item.createEl("img", {
            cls: "calibre-browse-cover",
            attr: { src: coverUrl, alt: book.title },
          });
        }

        const textDiv = item.createDiv({ cls: "calibre-browse-book-text" });
        textDiv.createEl("div", {
          cls: "calibre-browse-book-title",
          text: book.title,
        });
        textDiv.createEl("small", { text: book.author });
      });
    } catch (error) {
      loadingEl.textContent = `Error: ${error.message}`;
    }
  }

  private selectAll(): void {
    this.selectedBooks = new Set(this.books);
    this.contentArea
      ?.querySelectorAll<HTMLInputElement>(
        ".calibre-browse-book-item input[type='checkbox']",
      )
      .forEach((cb) => {
        cb.checked = true;
        cb.closest(".calibre-browse-book-item")?.addClass("is-selected");
      });
    this.updateCount();
  }

  private deselectAll(): void {
    this.selectedBooks.clear();
    this.contentArea
      ?.querySelectorAll<HTMLInputElement>(
        ".calibre-browse-book-item input[type='checkbox']",
      )
      .forEach((cb) => {
        cb.checked = false;
        cb.closest(".calibre-browse-book-item")?.removeClass("is-selected");
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
    if (this.selectedBooks.size === 0) {
      this.onConfirm(new Error("Cancelled request"));
    }
  }
}
